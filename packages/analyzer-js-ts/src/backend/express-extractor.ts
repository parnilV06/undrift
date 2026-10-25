// Express route extractor as specified in LLD.md Section 7.1 and 7.3.
// Extracts backend provider API observations from Express route declarations in JavaScript and TypeScript.

import type {
  AnalysisWarning,
  ApiObservation,
  DocumentUri,
  EvidenceRef,
  EvidenceStrength,
  FieldShape,
  HttpMethod,
  ObservationId,
  ObservedValue,
  ParsedDocument,
  RequestShapeObservation,
  ResponseShapeObservation,
  RoutePattern,
  RouteSegment,
  ShapeObservation,
  SourceDocument,
  SourceSpan,
  SyntaxNode,
  TypeShape
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import {
  ExpressMountRegistry,
  type ExpressMountInfo,
  combineRoutePaths
} from "./express-mount-resolver";

const VALID_EXPRESS_METHODS: ReadonlyMap<string, HttpMethod> = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"]
]);

interface ExpressCallMatch {
  matched: boolean;
  receiver: string;
  methodName: string;
  httpMethod?: HttpMethod;
  isDynamicMethod?: boolean;
  strength: EvidenceStrength;
  methodNode?: SyntaxNode;
  routePathNode?: SyntaxNode;
}

/**
 * Traces a call expression chain to locate an originating router.route(path) or app.route(path) call.
 */
function findRouteCall(
  callExpr: SyntaxNode
): { receiver: string; pathNode?: SyntaxNode } | undefined {
  const fn = callExpr.childForField("function") ?? callExpr.namedChildren()[0];
  if (!fn || fn.kind !== "member_expression") {
    return undefined;
  }
  const prop = fn.childForField("property") ?? fn.namedChildren()[1];
  const obj = fn.childForField("object") ?? fn.namedChildren()[0];
  if (!prop || !obj) {
    return undefined;
  }

  // Case A: Root route() call e.g. router.route('/api/posts')
  if (prop.text() === "route") {
    let receiver = "";
    if (obj.kind === "identifier") {
      const name = obj.text();
      if (name === "router" || name === "app" || name === "server") {
        receiver = name;
      }
    } else if (obj.kind === "member_expression") {
      const subProp = obj.childForField("property") ?? obj.namedChildren()[1];
      if (subProp?.text() === "router" || subProp?.text() === "app") {
        receiver = obj.text();
      }
    }
    if (receiver) {
      const argsNode = callExpr.childForField("arguments");
      const pathNode = argsNode ? argsNode.namedChildren()[0] : undefined;
      return { receiver, pathNode };
    }
  }

  // Case B: Chained method e.g. router.route(path).post(...).get(...)
  const propLower = prop.text().toLowerCase();
  if (VALID_EXPRESS_METHODS.has(propLower) && obj.kind === "call_expression") {
    return findRouteCall(obj);
  }

  return undefined;
}

/**
 * Checks if a syntax node represents an Express route registration call.
 * Matches:
 *  - `app.<method>(path, ...handlers)`
 *  - `router.<method>(path, ...handlers)`
 *  - `server.<method>(path, ...handlers)`
 *  - `router.route(path).<method>(...handlers)`
 * Rejects:
 *  - non-HTTP members like `app.use`, `app.listen`, `app.set`, `router.use`
 *  - setting getter `app.get("env")` with 1 argument not starting with `/`
 *  - unrelated receivers like `console.log`, `axios.get`, `myMap.get`, `db.get`
 */
function checkExpressRouteCall(node: SyntaxNode): ExpressCallMatch {
  if (node.kind !== "call_expression") {
    return { matched: false, receiver: "", methodName: "", strength: "direct" };
  }

  const fnNode = node.childForField("function") ?? node.namedChildren()[0];
  if (!fnNode) {
    return { matched: false, receiver: "", methodName: "", strength: "direct" };
  }

  // 1. Direct member expression: receiver.method(...)
  if (fnNode.kind === "member_expression") {
    const objectNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
    const propNode = fnNode.childForField("property") ?? fnNode.namedChildren()[1];

    if (!objectNode || !propNode) {
      return { matched: false, receiver: "", methodName: "", strength: "direct" };
    }

    const propText = propNode.text();
    const httpMethod = VALID_EXPRESS_METHODS.get(propText.toLowerCase());

    // Discard non-HTTP methods like use, listen, set, param
    if (!httpMethod) {
      return { matched: false, receiver: "", methodName: "", strength: "direct" };
    }

    let receiverName = "";
    let routePathNode: SyntaxNode | undefined;

    if (objectNode.kind === "identifier") {
      const name = objectNode.text();
      if (name === "app" || name === "router" || name === "server") {
        receiverName = name;
      }
    } else if (objectNode.kind === "member_expression") {
      const subProp = objectNode.childForField("property") ?? objectNode.namedChildren()[1];
      if (subProp?.text() === "app" || subProp?.text() === "router") {
        receiverName = objectNode.text();
      }
    } else if (objectNode.kind === "call_expression") {
      const routeCall = findRouteCall(objectNode);
      if (routeCall) {
        receiverName = routeCall.receiver;
        routePathNode = routeCall.pathNode;
      }
    }

    if (!receiverName) {
      return { matched: false, receiver: "", methodName: "", strength: "direct" };
    }

    // Distinguish Express setting lookup e.g. `app.get('env')` from route registration
    // If only 1 argument and it's a string literal not starting with "/", it's a setting lookup
    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];
    if (args.length === 1 && args[0].kind === "string") {
      const rawText = args[0].text().slice(1, -1);
      if (!rawText.startsWith("/") && !rawText.startsWith("*")) {
        return { matched: false, receiver: "", methodName: "", strength: "direct" };
      }
    }

    return {
      matched: true,
      receiver: receiverName,
      methodName: propText,
      httpMethod,
      strength: "direct",
      methodNode: propNode,
      routePathNode
    };
  }

  // 2. Dynamic method dispatch: `app[methodVar](path, ...)`
  if (fnNode.kind === "subscript_expression") {
    const objectNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
    const indexNode = fnNode.childForField("index") ?? fnNode.namedChildren()[1];

    if (
      objectNode?.kind === "identifier" &&
      (objectNode.text() === "app" || objectNode.text() === "router") &&
      indexNode
    ) {
      return {
        matched: true,
        receiver: objectNode.text(),
        methodName: indexNode.text(),
        isDynamicMethod: true,
        strength: "inferred"
      };
    }
  }

  return { matched: false, receiver: "", methodName: "", strength: "direct" };
}

/**
 * Parses raw path string into structural RoutePattern.
 */
function parseRoutePattern(rawUrl: string): RoutePattern {
  const queryIndex = rawUrl.indexOf("?");
  const pathPart = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  const trailingSlash = pathPart.length > 1 && pathPart.endsWith("/") ? "present" : "absent";
  const queryHandling = "excluded-from-path";

  const rawSegments = pathPart.split("/").filter((seg) => seg.length > 0);
  const segments: RouteSegment[] = rawSegments.map((seg) => {
    if (seg.startsWith(":") && seg.length > 1) {
      return { kind: "parameter", name: seg.slice(1) };
    }
    if (seg === "*") {
      return { kind: "wildcard" };
    }
    return { kind: "static", value: seg };
  });

  return {
    segments,
    trailingSlash,
    queryHandling,
    rawPath: pathPart
  };
}

/**
 * Extracts URL path ObservedValue from the first argument of an Express route declaration.
 */
function extractPath(
  argNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[]
): ObservedValue<RoutePattern> {
  const argSpan = mapper.toSourceSpanFromUtf16(argNode.range.start, argNode.range.end, documentUri);

  // 1. Literal string e.g. "/api/users"
  if (argNode.kind === "string") {
    const raw = argNode.text();
    const unquoted = raw.slice(1, -1);
    const routePattern = parseRoutePattern(unquoted);

    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: argSpan,
      description: `Static route path '${routePattern.rawPath}' in Express route declaration`
    };

    return {
      state: "known",
      value: routePattern,
      strength: "direct",
      evidence: [evidence]
    };
  }

  // 2. Template string literal
  if (argNode.kind === "template_string") {
    const hasSubstitutions = argNode
      .namedChildren()
      .some((child) => child.kind === "template_substitution");

    if (!hasSubstitutions) {
      // Static template literal without substitutions e.g. `/api/users`
      const raw = argNode.text();
      const unquoted = raw.slice(1, -1);
      const routePattern = parseRoutePattern(unquoted);

      const evidence: EvidenceRef = {
        id: `ev-path-${argNode.range.start}`,
        kind: "literal-syntax",
        strength: "direct",
        source: argSpan,
        description: `Static template route path '${routePattern.rawPath}' in Express route declaration`
      };

      return {
        state: "known",
        value: routePattern,
        strength: "direct",
        evidence: [evidence]
      };
    }

    // Dynamic template string with interpolation e.g. `/api/${version}/users`
    const warning: AnalysisWarning = {
      code: "DYNAMIC_ROUTE",
      message: `Dynamic template string in Express route path cannot be statically resolved: ${argNode.text()}`,
      source: argSpan,
      analyzerId: "analyzer-js-ts",
      affectsCompleteness: true
    };
    warnings.push(warning);

    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "inferred",
      source: argSpan,
      description: "Dynamic template string in Express route path"
    };

    return {
      state: "dynamic",
      expression: argNode.text(),
      reason: "Dynamic template string route interpolation",
      evidence: [evidence]
    };
  }

  // 3. Dynamic expression (variable, call, binary expression, etc.)
  const warning: AnalysisWarning = {
    code: "DYNAMIC_ROUTE",
    message: `Dynamic route path in Express route declaration cannot be statically resolved: ${argNode.text()}`,
    source: argSpan,
    analyzerId: "analyzer-js-ts",
    affectsCompleteness: true
  };
  warnings.push(warning);

  const evidence: EvidenceRef = {
    id: `ev-path-${argNode.range.start}`,
    kind: "literal-syntax",
    strength: "inferred",
    source: argSpan,
    description: "Dynamic route path in Express route declaration"
  };

  return {
    state: "dynamic",
    expression: argNode.text(),
    reason: "Dynamic route path expression",
    evidence: [evidence]
  };
}

/**
 * Extracts properties from an object literal syntax node into a FieldShape array.
 */
function extractObjectFields(
  objectNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper
): FieldShape[] {
  const fields: FieldShape[] = [];

  for (const child of objectNode.namedChildren()) {
    if (child.kind === "shorthand_property_identifier") {
      const fieldName = child.text();
      const fieldSpan = mapper.toSourceSpanFromUtf16(
        child.range.start,
        child.range.end,
        documentUri
      );
      const fieldEvidence: EvidenceRef = {
        id: `ev-field-${child.range.start}`,
        kind: "literal-syntax",
        strength: "direct",
        source: fieldSpan,
        description: `Field '${fieldName}' in response body payload`
      };
      fields.push({
        name: fieldName,
        type: { kind: "unknown", reason: "unresolved-reference" },
        presence: "required",
        nullable: "unknown",
        evidence: [fieldEvidence]
      });
      continue;
    }

    if (child.kind !== "pair") {
      continue;
    }

    const keyNode = child.childForField("key") ?? child.namedChildren()[0];
    const valNode = child.childForField("value") ?? child.namedChildren()[1];

    if (!keyNode || !valNode) {
      continue;
    }

    let fieldName = keyNode.text();
    if (keyNode.kind === "string") {
      fieldName = fieldName.slice(1, -1);
    }

    const fieldSpan = mapper.toSourceSpanFromUtf16(child.range.start, child.range.end, documentUri);

    const fieldEvidence: EvidenceRef = {
      id: `ev-field-${child.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: fieldSpan,
      description: `Field '${fieldName}' in response body payload`
    };

    let fieldType: TypeShape;
    let nullable: "yes" | "no" | "unknown" = "no";

    if (valNode.kind === "string") {
      fieldType = { kind: "literal", value: valNode.text().slice(1, -1) };
    } else if (valNode.kind === "number") {
      fieldType = { kind: "literal", value: Number(valNode.text()) };
    } else if (valNode.kind === "true") {
      fieldType = { kind: "literal", value: true };
    } else if (valNode.kind === "false") {
      fieldType = { kind: "literal", value: false };
    } else if (valNode.kind === "null") {
      fieldType = { kind: "literal", value: null };
      nullable = "yes";
    } else if (valNode.kind === "array") {
      fieldType = { kind: "array", element: { kind: "unknown", reason: "not-observed" } };
    } else if (valNode.kind === "object") {
      fieldType = {
        kind: "object",
        properties: extractObjectFields(valNode, documentUri, mapper),
        additionalProperties: "unknown"
      };
    } else {
      fieldType = { kind: "unknown", reason: "dynamic-expression" };
    }

    fields.push({
      name: fieldName,
      type: fieldType,
      presence: "required",
      nullable,
      evidence: [fieldEvidence]
    });
  }

  return fields;
}

/**
 * Creates ShapeObservation from a response body value node in res.json(...) or res.send(...).
 */
function extractResponseBodyShape(
  bodyNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[]
): ShapeObservation {
  const bodySpan = mapper.toSourceSpanFromUtf16(
    bodyNode.range.start,
    bodyNode.range.end,
    documentUri
  );

  // Object literal e.g. res.json({ id: 1, name: "Alice" })
  if (bodyNode.kind === "object") {
    const properties = extractObjectFields(bodyNode, documentUri, mapper);

    const evidence: EvidenceRef = {
      id: `ev-body-${bodyNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: bodySpan,
      description: "Direct object literal response body in Express handler"
    };

    return {
      shape: {
        kind: "object",
        properties,
        additionalProperties: "unknown"
      },
      completeness: "complete",
      evidence: [evidence]
    };
  }

  // String literal e.g. res.send("OK")
  if (bodyNode.kind === "string") {
    const evidence: EvidenceRef = {
      id: `ev-body-${bodyNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: bodySpan,
      description: "Literal string response body in Express handler"
    };

    return {
      shape: {
        kind: "primitive",
        name: "string"
      },
      completeness: "complete",
      evidence: [evidence]
    };
  }

  // Number literal e.g. res.send(200)
  if (bodyNode.kind === "number") {
    const evidence: EvidenceRef = {
      id: `ev-body-${bodyNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: bodySpan,
      description: "Literal number response body in Express handler"
    };

    return {
      shape: {
        kind: "primitive",
        name: "number"
      },
      completeness: "complete",
      evidence: [evidence]
    };
  }

  // Array literal e.g. res.json([{ id: 1, name: "Alice" }])
  if (bodyNode.kind === "array") {
    const evidence: EvidenceRef = {
      id: `ev-body-${bodyNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: bodySpan,
      description: "Array literal response body in Express handler"
    };

    const elements = bodyNode.namedChildren();
    let elementShape: TypeShape = { kind: "unknown", reason: "not-observed" };
    if (elements.length > 0 && elements[0].kind === "object") {
      elementShape = {
        kind: "object",
        properties: extractObjectFields(elements[0], documentUri, mapper),
        additionalProperties: "unknown"
      };
    }

    return {
      shape: {
        kind: "array",
        element: elementShape
      },
      completeness: "complete",
      evidence: [evidence]
    };
  }

  // Variable or dynamic expression e.g. res.json(users)
  const warning: AnalysisWarning = {
    code: "PARTIAL_SHAPE",
    message: `Unresolved response body payload expression in Express handler: ${bodyNode.text()}`,
    source: bodySpan,
    analyzerId: "analyzer-js-ts",
    scope: "provider",
    targetDimension: "response-shape",
    affectsCompleteness: false
  };
  warnings.push(warning);

  const evidence: EvidenceRef = {
    id: `ev-body-${bodyNode.range.start}`,
    kind: "literal-syntax",
    strength: "inferred",
    source: bodySpan,
    description: "Unresolved response body expression in Express handler"
  };

  return {
    shape: {
      kind: "unknown",
      reason: "unresolved-reference"
    },
    completeness: "partial",
    evidence: [evidence]
  };
}

/**
 * Inspects a route handler function node (arrow function or function expression)
 * to extract explicit response status codes and body shapes.
 * Supports:
 *  - direct `res.json(body)`
 *  - direct `res.send(body)`
 *  - chained `res.status(code).json(body)`
 *  - chained `res.status(code).send(body)`
 *  - `res.sendStatus(code)`
 */
function extractHandlerResponses(
  handlerNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[]
): ResponseShapeObservation[] {
  const responses: ResponseShapeObservation[] = [];

  walkTree(handlerNode, (node) => {
    if (node.kind !== "call_expression") {
      return;
    }

    const fnNode = node.childForField("function") ?? node.namedChildren()[0];
    if (!fnNode || fnNode.kind !== "member_expression") {
      return;
    }

    const objectNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
    const propNode = fnNode.childForField("property") ?? fnNode.namedChildren()[1];

    if (!objectNode || !propNode) {
      return;
    }

    const method = propNode.text();
    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];
    const callSpan = mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, documentUri);

    // Case 1: Chained `res.status(code).json(body)` or `res.status(code).send(body)`
    if ((method === "json" || method === "send") && objectNode.kind === "call_expression") {
      const subFn = objectNode.childForField("function") ?? objectNode.namedChildren()[0];
      if (subFn && subFn.kind === "member_expression") {
        const subObj = subFn.childForField("object") ?? subFn.namedChildren()[0];
        const subProp = subFn.childForField("property") ?? subFn.namedChildren()[1];

        if (subProp?.text() === "status") {
          const subArgs = objectNode.childForField("arguments")?.namedChildren() ?? [];
          let statusCodeObs: ObservedValue<number> | undefined;

          if (subArgs.length > 0 && subArgs[0].kind === "number") {
            const codeVal = Number(subArgs[0].text());
            const statusSpan = mapper.toSourceSpanFromUtf16(
              subArgs[0].range.start,
              subArgs[0].range.end,
              documentUri
            );
            statusCodeObs = {
              state: "known",
              value: codeVal,
              strength: "direct",
              evidence: [
                {
                  id: `ev-status-${subArgs[0].range.start}`,
                  kind: "literal-syntax",
                  strength: "direct",
                  source: statusSpan,
                  description: `Explicit HTTP status code ${codeVal} in res.status()`
                }
              ]
            };
          }

          let bodyShape: ShapeObservation | undefined;
          if (args.length > 0) {
            bodyShape = extractResponseBodyShape(args[0], documentUri, mapper, warnings);
          }

          responses.push({
            statusCode: statusCodeObs,
            body: bodyShape,
            source: [callSpan]
          });
          return;
        }
      }
    }

    // Case 2: Direct `res.json(body)` or `res.send(body)`
    if (method === "json" || method === "send") {
      let isResObject = false;
      if (objectNode.kind === "identifier") {
        isResObject = objectNode.text() === "res" || objectNode.text() === "response";
      }

      if (isResObject) {
        // Default status code 200 by Express framework convention
        const defaultStatus: ObservedValue<number> = {
          state: "known",
          value: 200,
          strength: "direct",
          evidence: [
            {
              id: `ev-status-${node.range.start}`,
              kind: "framework-convention",
              strength: "direct",
              source: callSpan,
              description: "Default HTTP status code 200 for direct res.json()/res.send()"
            }
          ]
        };

        let bodyShape: ShapeObservation | undefined;
        if (args.length > 0) {
          bodyShape = extractResponseBodyShape(args[0], documentUri, mapper, warnings);
        }

        responses.push({
          statusCode: defaultStatus,
          body: bodyShape,
          source: [callSpan]
        });
        return;
      }
    }

    // Case 3: `res.sendStatus(code)`
    if (method === "sendStatus") {
      let isResObject = false;
      if (objectNode.kind === "identifier") {
        isResObject = objectNode.text() === "res" || objectNode.text() === "response";
      }

      if (isResObject && args.length > 0 && args[0].kind === "number") {
        const codeVal = Number(args[0].text());
        const statusSpan = mapper.toSourceSpanFromUtf16(
          args[0].range.start,
          args[0].range.end,
          documentUri
        );
        responses.push({
          statusCode: {
            state: "known",
            value: codeVal,
            strength: "direct",
            evidence: [
              {
                id: `ev-status-${args[0].range.start}`,
                kind: "literal-syntax",
                strength: "direct",
                source: statusSpan,
                description: `Explicit HTTP status code ${codeVal} in res.sendStatus()`
              }
            ]
          },
          source: [callSpan]
        });
      }
    }
  });

  return responses;
}

/**
 * Creates path parameters ShapeObservation from RoutePattern segments.
 */
function createPathParametersShape(
  routePattern: RoutePattern,
  sourceSpan: SourceSpan
): ShapeObservation | undefined {
  const paramSegments = routePattern.segments.filter(
    (s): s is { kind: "parameter"; name: string } => s.kind === "parameter" && !!s.name
  );

  if (paramSegments.length === 0) {
    return undefined;
  }

  const properties: FieldShape[] = paramSegments.map((param) => ({
    name: param.name,
    type: { kind: "primitive", name: "string" },
    presence: "required",
    nullable: "no",
    evidence: [
      {
        id: `ev-param-${param.name}`,
        kind: "literal-syntax",
        strength: "direct",
        source: sourceSpan,
        description: `Path parameter ':${param.name}' in route pattern`
      }
    ]
  }));

  return {
    shape: {
      kind: "object",
      properties,
      additionalProperties: "forbidden"
    },
    completeness: "complete",
    evidence: [
      {
        id: `ev-pathparams-${sourceSpan.range.start}`,
        kind: "literal-syntax",
        strength: "direct",
        source: sourceSpan,
        description: "Path parameters extracted from Express route pattern"
      }
    ]
  };
}

/**
 * Traverses syntax node tree recursively using pre-order depth-first search.
 */
function walkTree(node: SyntaxNode, visitor: (node: SyntaxNode) => void): void {
  visitor(node);
  for (const child of node.namedChildren()) {
    walkTree(child, visitor);
  }
}

/**
 * Result of Express extraction containing extracted provider observations and analysis warnings.
 */
export interface ExpressExtractionResult {
  observations: ApiObservation[];
  warnings: AnalysisWarning[];
}

/**
 * Extracts Express route declarations from a parsed JavaScript or TypeScript document.
 * Follows LLD Section 7.3 extraction rules and emits structured ApiObservation instances with role: "provider".
 */
export function extractExpressObservations(
  document: SourceDocument,
  parsed: ParsedDocument,
  signal?: AbortSignal,
  mountRegistry?: ExpressMountRegistry
): ExpressExtractionResult {
  const observations: ApiObservation[] = [];
  const warnings: AnalysisWarning[] = [];
  const mapper = new PositionMapper(document.text, document.uri);

  walkTree(parsed.root, (node) => {
    signal?.throwIfAborted();

    const match = checkExpressRouteCall(node);
    if (!match.matched) {
      return;
    }

    const callSpan = mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, document.uri);

    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];

    let pathArgNode: SyntaxNode | undefined;
    let handlerArgs: readonly SyntaxNode[] = [];

    if (match.routePathNode) {
      pathArgNode = match.routePathNode;
      handlerArgs = args;
    } else {
      if (args.length === 0) {
        warnings.push({
          code: "UNSUPPORTED_PATTERN",
          message: `${match.receiver}.${match.methodName}() route declaration without required path argument cannot be analyzed`,
          source: callSpan,
          analyzerId: "analyzer-js-ts",
          scope: "provider",
          targetDimension: "route",
          affectsCompleteness: true
        });
        return;
      }
      pathArgNode = args[0];
      handlerArgs = args.slice(1);
    }

    if (!pathArgNode) {
      warnings.push({
        code: "UNSUPPORTED_PATTERN",
        message: `${match.receiver}.${match.methodName}() route declaration without required path argument cannot be analyzed`,
        source: callSpan,
        analyzerId: "analyzer-js-ts",
        scope: "provider",
        targetDimension: "route",
        affectsCompleteness: true
      });
      return;
    }

    const localWarnings: AnalysisWarning[] = [];

    // 1. Method
    let methodValue: ObservedValue<HttpMethod>;
    if (match.isDynamicMethod || !match.httpMethod) {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: `Dynamic HTTP method dispatch on Express route declaration cannot be statically determined: ${match.methodName}`,
        source: callSpan,
        analyzerId: "analyzer-js-ts",
        scope: "provider",
        targetDimension: "method",
        affectsCompleteness: true
      };
      localWarnings.push(warning);

      methodValue = {
        state: "dynamic",
        expression: match.methodName,
        reason: "Dynamic HTTP method dispatch",
        evidence: [
          {
            id: `ev-method-${node.range.start}`,
            kind: "literal-syntax",
            strength: "inferred",
            source: callSpan,
            description: "Dynamic HTTP method dispatch on Express route declaration"
          }
        ]
      };
    } else {
      const methodSpan = match.methodNode
        ? mapper.toSourceSpanFromUtf16(
            match.methodNode.range.start,
            match.methodNode.range.end,
            document.uri
          )
        : callSpan;

      const methodEvidence: EvidenceRef = {
        id: `ev-method-${node.range.start}`,
        kind: "literal-syntax",
        strength: match.strength,
        source: methodSpan,
        description: `HTTP method '${match.httpMethod}' from ${match.receiver}.${match.methodName}() route declaration`
      };

      methodValue = {
        state: "known",
        value: match.httpMethod,
        strength: match.strength === "inferred" ? "inferred" : "direct",
        evidence: [methodEvidence]
      };
    }

    // 2. Route Path
    const path = extractPath(pathArgNode, document.uri, mapper, localWarnings);

    // 3. Inspect Handlers for Response Shapes
    const responses: ResponseShapeObservation[] = [];
    for (const handlerArg of handlerArgs) {
      if (
        handlerArg.kind === "arrow_function" ||
        handlerArg.kind === "function_expression" ||
        handlerArg.kind === "function"
      ) {
        const handlerResponses = extractHandlerResponses(
          handlerArg,
          document.uri,
          mapper,
          localWarnings
        );
        responses.push(...handlerResponses);
      }
    }

    // Collect local warnings to document warnings
    warnings.push(...localWarnings);

    // 4. Determine applicable mount prefixes (from ExpressMountRegistry if present)
    let applicableMounts: Array<{ prefix: string; mount: ExpressMountInfo }> = [];
    if (mountRegistry && match.receiver !== "app") {
      const docMounts = mountRegistry.getMountsForDocument(document.uri);
      const localMounts = mountRegistry.getMountsForLocalRouter(document.uri, match.receiver);
      applicableMounts = docMounts.length > 0 ? docMounts : localMounts;
    }

    if (applicableMounts.length > 0 && path.state === "known") {
      for (const { prefix, mount } of applicableMounts) {
        if (mount.isDynamic) {
          const dynamicWarn: AnalysisWarning = {
            code: "DYNAMIC_ROUTE",
            message:
              mount.dynamicReason ??
              "Dynamic Express router mount prefix cannot be statically resolved",
            source: callSpan,
            analyzerId: "analyzer-js-ts",
            scope: "provider",
            targetDimension: "route",
            affectsCompleteness: true
          };
          warnings.push(dynamicWarn);

          observations.push({
            id: `obs:${document.uri}:${node.range.start}-${node.range.end}`,
            role: "provider",
            languageId: document.languageId,
            framework: "express",
            extractorId: "express-extractor",
            source: [callSpan],
            snapshot: {
              uri: document.uri,
              contentHash: document.contentHash
            },
            endpoint: {
              method: methodValue,
              path: {
                state: "dynamic",
                expression: mount.dynamicReason ?? "Dynamic mount prefix",
                reason: "Dynamic Express router mount prefix",
                evidence: [
                  {
                    id: `ev-mount-dynamic-${node.range.start}`,
                    kind: "framework-convention",
                    strength: "inferred",
                    source: mount.sourceSpan,
                    description: "Dynamic mount prefix in Express app.use()"
                  }
                ]
              },
              request: undefined,
              responses
            },
            limitations: [dynamicWarn]
          });
          continue;
        }

        const effectiveRawPath = combineRoutePaths(prefix, path.value.rawPath);
        const effectiveRoutePattern = parseRoutePattern(effectiveRawPath);
        const mountEvidence: EvidenceRef = {
          id: `ev-mount-${node.range.start}`,
          kind: "framework-convention",
          strength: "direct",
          source: mount.sourceSpan,
          description: `Express router mounted with prefix '${prefix}' in ${mount.mountingDocUri}`
        };

        const effectivePath: ObservedValue<RoutePattern> = {
          state: "known",
          value: effectiveRoutePattern,
          strength: path.strength,
          evidence: [...path.evidence, mountEvidence]
        };

        const effectivePathParams = createPathParametersShape(effectiveRoutePattern, callSpan);
        const effectiveRequest: RequestShapeObservation | undefined = effectivePathParams
          ? { pathParams: effectivePathParams }
          : undefined;

        const effectiveObsId: ObservationId =
          applicableMounts.length > 1
            ? `obs:${document.uri}:${node.range.start}-${node.range.end}:${effectiveRawPath}`
            : `obs:${document.uri}:${node.range.start}-${node.range.end}`;

        observations.push({
          id: effectiveObsId,
          role: "provider",
          languageId: document.languageId,
          framework: "express",
          extractorId: "express-extractor",
          source: [callSpan],
          snapshot: {
            uri: document.uri,
            contentHash: document.contentHash
          },
          endpoint: {
            method: methodValue,
            path: effectivePath,
            request: effectiveRequest,
            responses
          },
          limitations: localWarnings
        });
      }
      return;
    }

    // Default: direct route without mount prefix
    let request: RequestShapeObservation | undefined;
    if (path.state === "known") {
      const pathParams = createPathParametersShape(path.value, callSpan);
      if (pathParams) {
        request = { pathParams };
      }
    }

    const observationId: ObservationId = `obs:${document.uri}:${node.range.start}-${node.range.end}`;

    const observation: ApiObservation = {
      id: observationId,
      role: "provider",
      languageId: document.languageId,
      framework: "express",
      extractorId: "express-extractor",
      source: [callSpan],
      snapshot: {
        uri: document.uri,
        contentHash: document.contentHash
      },
      endpoint: {
        method: methodValue,
        path,
        request,
        responses
      },
      limitations: localWarnings
    };

    observations.push(observation);
  });

  return { observations, warnings };
}

/**
 * Extractor class conforming to extractor module architecture.
 */
export class ExpressExtractor {
  constructor(private readonly mountRegistry?: ExpressMountRegistry) {}

  extract(
    document: SourceDocument,
    parsed: ParsedDocument,
    signal?: AbortSignal,
    mountRegistry?: ExpressMountRegistry
  ): ExpressExtractionResult {
    return extractExpressObservations(
      document,
      parsed,
      signal,
      mountRegistry ?? this.mountRegistry
    );
  }
}
