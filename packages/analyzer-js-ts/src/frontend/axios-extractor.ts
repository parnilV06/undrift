// Axios call extractor as specified in LLD.md Section 7.1 and 7.2.
// Extracts client-side API observations from Axios method calls in JavaScript and TypeScript.

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
  PrimitiveTypeName,
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
import type { LocalReferenceResolver } from "../project-index/local-reference-resolver";

const VALID_AXIOS_METHODS: ReadonlyMap<string, HttpMethod> = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"]
]);

// Methods where the second argument is the request payload data
const BODY_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH"]);

interface AxiosCallMatch {
  matched: boolean;
  receiver: string;
  methodName: string;
  httpMethod?: HttpMethod;
  isDynamicMethod?: boolean;
  strength: EvidenceStrength;
}

/**
 * Checks if a syntax node represents an Axios method call expression.
 * Matches:
 *  - `axios.<method>(...)`
 *  - `window.axios.<method>(...)`
 *  - `globalThis.axios.<method>(...)`
 *  - `api.<method>(...)` (configured client per LLD Section 7.2)
 * Rejects:
 *  - non-HTTP members like `axios.create`, `axios.all`, `axios.isAxiosError`
 *  - unrelated receivers like `console.log`, `router.get`, `app.get`, `client.get`
 */
function checkAxiosCall(node: SyntaxNode): AxiosCallMatch {
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
    const httpMethod = VALID_AXIOS_METHODS.get(propText.toLowerCase());

    // Discard non-HTTP methods like create, all, interceptors
    if (!httpMethod) {
      return { matched: false, receiver: "", methodName: "", strength: "direct" };
    }

    // Direct `axios.<method>`
    if (objectNode.kind === "identifier" && objectNode.text() === "axios") {
      return {
        matched: true,
        receiver: "axios",
        methodName: propText,
        httpMethod,
        strength: "direct"
      };
    }

    // Direct `api.<method>` (configured client per LLD Section 7.2)
    if (objectNode.kind === "identifier" && objectNode.text() === "api") {
      return {
        matched: true,
        receiver: "api",
        methodName: propText,
        httpMethod,
        strength: "inferred"
      };
    }

    // Global member: `window.axios.<method>` or `globalThis.axios.<method>`
    if (objectNode.kind === "member_expression") {
      const globObj = objectNode.childForField("object") ?? objectNode.namedChildren()[0];
      const globProp = objectNode.childForField("property") ?? objectNode.namedChildren()[1];

      if (
        (globObj?.text() === "window" || globObj?.text() === "globalThis") &&
        globProp?.text() === "axios"
      ) {
        return {
          matched: true,
          receiver: `${globObj.text()}.axios`,
          methodName: propText,
          httpMethod,
          strength: "direct"
        };
      }
    }
  }

  // 2. Dynamic method dispatch: `axios[methodVar](...)`
  if (fnNode.kind === "subscript_expression") {
    const objectNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
    const indexNode = fnNode.childForField("index") ?? fnNode.namedChildren()[1];

    if (objectNode?.kind === "identifier" && objectNode.text() === "axios" && indexNode) {
      return {
        matched: true,
        receiver: "axios",
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
 * Extracts URL path ObservedValue from the first argument of an Axios call.
 */
function extractPath(
  argNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[],
  resolver?: LocalReferenceResolver
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
      description: `Static URL literal '${routePattern.rawPath}' in Axios call`
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
        description: `Static template URL literal '${routePattern.rawPath}' in Axios call`
      };

      return {
        state: "known",
        value: routePattern,
        strength: "direct",
        evidence: [evidence]
      };
    }

    // Dynamic template string with interpolation e.g. `/api/users/${id}`
    const warning: AnalysisWarning = {
      code: "DYNAMIC_ROUTE",
      message: `Dynamic template string in Axios URL cannot be statically resolved: ${argNode.text()}`,
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
      description: "Dynamic template string URL expression in Axios call"
    };

    return {
      state: "dynamic",
      expression: argNode.text(),
      reason: "Dynamic template string URL interpolation",
      evidence: [evidence]
    };
  }

  // 3. Local constant resolution via resolver for identifier expressions
  if (argNode.kind === "identifier" && resolver) {
    const refName = argNode.text();
    const result = resolver.resolveConstant<string>(refName, documentUri, argNode.range);
    if (result.state === "resolved") {
      if (typeof result.value === "string") {
        const routePattern = parseRoutePattern(result.value);
        return {
          state: "known",
          value: routePattern,
          strength: "resolved",
          evidence: result.evidence
        };
      }

      // Resolved, but not a valid string URL
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: `Resolved constant '${refName}' is not a string URL: ${String(result.value)}`,
        source: argSpan,
        analyzerId: "analyzer-js-ts",
        affectsCompleteness: true
      };
      warnings.push(warning);

      return {
        state: "dynamic",
        expression: refName,
        reason: `Constant '${refName}' resolved to non-string value`,
        evidence: result.evidence
      };
    }
  }

  // 4. Dynamic expression (variable, call, binary expression, unresolved reference, etc.)
  const warning: AnalysisWarning = {
    code: "DYNAMIC_ROUTE",
    message: `Dynamic URL expression in Axios call cannot be statically resolved: ${argNode.text()}`,
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
    description: "Dynamic URL expression in Axios call"
  };

  return {
    state: "dynamic",
    expression: argNode.text(),
    reason: "Dynamic URL expression",
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
      description: `Field '${fieldName}' in request body payload`
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
 * Extracts request body shape from the payload argument (arg 1 in POST/PUT/PATCH).
 */
function extractRequestBody(
  dataNode: SyntaxNode | undefined,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[]
): ShapeObservation | undefined {
  if (!dataNode) {
    return undefined;
  }

  const dataSpan = mapper.toSourceSpanFromUtf16(
    dataNode.range.start,
    dataNode.range.end,
    documentUri
  );

  // Object literal e.g. axios.post("/api", { name: "Alice" })
  if (dataNode.kind === "object") {
    const properties = extractObjectFields(dataNode, documentUri, mapper);

    const evidence: EvidenceRef = {
      id: `ev-body-${dataNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: dataSpan,
      description: "Direct object literal request body in Axios call"
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

  // String literal e.g. axios.post("/api", "raw data")
  if (dataNode.kind === "string") {
    const evidence: EvidenceRef = {
      id: `ev-body-${dataNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: dataSpan,
      description: "Literal string request body in Axios call"
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

  // Dynamic variable or unresolved expression e.g. axios.post("/api", payload)
  const warning: AnalysisWarning = {
    code: "PARTIAL_SHAPE",
    message: `Unresolved request payload expression in Axios call: ${dataNode.text()}`,
    source: dataSpan,
    analyzerId: "analyzer-js-ts",
    affectsCompleteness: true
  };
  warnings.push(warning);

  const evidence: EvidenceRef = {
    id: `ev-body-${dataNode.range.start}`,
    kind: "literal-syntax",
    strength: "inferred",
    source: dataSpan,
    description: "Unresolved payload expression in Axios call"
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
 * Parses a TypeScript type syntax node into a normalized TypeShape.
 */
function parseTypeNode(node: SyntaxNode): TypeShape {
  // Predefined primitive types: string, number, boolean, void, etc.
  if (node.kind === "predefined_type") {
    const text = node.text();
    const primitiveNames: ReadonlySet<string> = new Set([
      "string",
      "number",
      "boolean",
      "bigint",
      "symbol",
      "null",
      "undefined",
      "void",
      "unknown",
      "never"
    ]);

    if (primitiveNames.has(text)) {
      return { kind: "primitive", name: text as PrimitiveTypeName };
    }
    return { kind: "unknown", reason: "complex-type" };
  }

  // Identifier reference: User, Post, Account
  if (node.kind === "type_identifier") {
    return {
      kind: "reference",
      displayName: node.text(),
      resolution: "unresolved"
    };
  }

  // Array type: User[], string[]
  if (node.kind === "array_type") {
    const elemNode = node.namedChildren()[0];
    const elementShape = elemNode
      ? parseTypeNode(elemNode)
      : { kind: "unknown" as const, reason: "not-observed" as const };
    return {
      kind: "array",
      element: elementShape
    };
  }

  // Generic type: Array<User>, Promise<User>, ApiResponse<T>
  if (node.kind === "generic_type") {
    const typeNameNode = node.childForField("name") ?? node.namedChildren()[0];
    const typeArgs = node.childForField("type_arguments") ?? node.namedChildren()[1];

    if (typeNameNode?.text() === "Array" && typeArgs) {
      const firstArg = typeArgs.namedChildren()[0];
      const elementShape = firstArg
        ? parseTypeNode(firstArg)
        : { kind: "unknown" as const, reason: "not-observed" as const };
      return {
        kind: "array",
        element: elementShape
      };
    }

    return {
      kind: "reference",
      displayName: node.text(),
      resolution: "unresolved"
    };
  }

  // Union type: User | null, string | number
  if (node.kind === "union_type") {
    const members = node.namedChildren().map((child) => parseTypeNode(child));
    return {
      kind: "union",
      members
    };
  }

  // Complex or unsupported type
  return {
    kind: "unknown",
    reason: "complex-type"
  };
}

/**
 * Extracts response type annotation from TypeScript generic type arguments on the call expression.
 * e.g. `axios.get<User[]>("/api/users")` -> extracts `User[]` response type.
 */
function extractResponseType(
  callNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper
): ResponseShapeObservation[] {
  const typeArgsNode =
    callNode.childForField("type_arguments") ??
    callNode.namedChildren().find((c) => c.kind === "type_arguments");

  if (!typeArgsNode) {
    return [];
  }

  const typeArgs = typeArgsNode.namedChildren();
  if (typeArgs.length === 0) {
    return [];
  }

  // First type argument is the response payload type T in Axios
  const respTypeNode = typeArgs[0];
  const typeShape = parseTypeNode(respTypeNode);

  const typeSpan = mapper.toSourceSpanFromUtf16(
    typeArgsNode.range.start,
    typeArgsNode.range.end,
    documentUri
  );

  const evidence: EvidenceRef = {
    id: `ev-resp-${typeArgsNode.range.start}`,
    kind: "literal-syntax",
    strength: "direct",
    source: typeSpan,
    description: `Explicit generic response type '<${respTypeNode.text()}>' in Axios call`
  };

  const responseObservation: ResponseShapeObservation = {
    body: {
      shape: typeShape,
      completeness: typeShape.kind === "unknown" ? "partial" : "complete",
      evidence: [evidence]
    },
    source: [typeSpan]
  };

  return [responseObservation];
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
 * Result of Axios extraction containing extracted API observations and analysis warnings.
 */
export interface AxiosExtractionResult {
  observations: ApiObservation[];
  warnings: AnalysisWarning[];
}

/**
 * Extracts standard Axios call observations from a parsed JavaScript or TypeScript document.
 * Follows LLD Section 7.2 extraction rules and emits structured ApiObservation instances.
 */
export function extractAxiosObservations(
  document: SourceDocument,
  parsed: ParsedDocument,
  signal?: AbortSignal,
  resolver?: LocalReferenceResolver
): AxiosExtractionResult {
  const observations: ApiObservation[] = [];
  const warnings: AnalysisWarning[] = [];
  const mapper = new PositionMapper(document.text, document.uri);

  walkTree(parsed.root, (node) => {
    signal?.throwIfAborted();

    const match = checkAxiosCall(node);
    if (!match.matched) {
      return;
    }

    const callSpan = mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, document.uri);

    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];

    // Zero arguments e.g. `axios.get()`
    if (args.length === 0) {
      warnings.push({
        code: "UNSUPPORTED_PATTERN",
        message: `${match.receiver}.${match.methodName}() call without required URL argument cannot be analyzed`,
        source: callSpan,
        analyzerId: "analyzer-js-ts",
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
        message: `Dynamic HTTP method dispatch on Axios call cannot be statically determined: ${match.methodName}`,
        source: callSpan,
        analyzerId: "analyzer-js-ts",
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
            description: "Dynamic HTTP method dispatch on Axios call"
          }
        ]
      };
    } else {
      const methodEvidence: EvidenceRef = {
        id: `ev-method-${node.range.start}`,
        kind: "literal-syntax",
        strength: match.strength,
        source: callSpan,
        description: `HTTP method '${match.httpMethod}' from ${match.receiver}.${match.methodName} call`
      };

      methodValue = {
        state: "known",
        value: match.httpMethod,
        strength: match.strength === "inferred" ? "inferred" : "direct",
        evidence: [methodEvidence]
      };
    }

    // 2. URL Path
    const path = extractPath(args[0], document.uri, mapper, localWarnings, resolver);

    // 3. Request body (for POST, PUT, PATCH: arg 1 is payload data)
    let request: RequestShapeObservation | undefined;
    if (match.httpMethod && BODY_METHODS.has(match.httpMethod) && args.length > 1) {
      const bodyShape = extractRequestBody(args[1], document.uri, mapper, localWarnings);
      if (bodyShape) {
        request = { body: bodyShape };
      }
    }

    // 4. Response type generic (TypeScript)
    const responses = extractResponseType(node, document.uri, mapper);

    // Collect local warnings to document-level warnings
    warnings.push(...localWarnings);

    // 5. Build ApiObservation
    const observationId: ObservationId = `obs:${document.uri}:${node.range.start}-${node.range.end}`;

    const observation: ApiObservation = {
      id: observationId,
      role: "consumer",
      languageId: document.languageId,
      framework: "axios",
      extractorId: "axios-extractor",
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
export class AxiosExtractor {
  constructor(private readonly resolver?: LocalReferenceResolver) {}

  extract(
    document: SourceDocument,
    parsed: ParsedDocument,
    signal?: AbortSignal,
    resolver?: LocalReferenceResolver
  ): AxiosExtractionResult {
    return extractAxiosObservations(document, parsed, signal, resolver ?? this.resolver);
  }
}
