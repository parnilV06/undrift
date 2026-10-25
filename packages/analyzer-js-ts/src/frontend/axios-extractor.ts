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
import {
  LocalReferenceResolver,
  createLocalReferenceResolver
} from "../project-index/local-reference-resolver";
import {
  createLocalDeclarationIndex,
  type LocalVariableDeclaration
} from "../project-index/local-declaration-index";
import { extractTemplateRoute } from "./template-url-parser";
import { extractObjectFields } from "../shapes/shape-extractor";
import { combineRoutePaths } from "../backend/express-mount-resolver";

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
 * Extracts pathname prefix from an absolute or relative URL string.
 */
function extractPathnameFromUrlString(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      return url.pathname.replace(/\/+$/, "");
    } catch {
      const match = trimmed.match(/^https?:\/\/[^/]+(\/.*)$/);
      return match ? match[1].replace(/\/+$/, "") : "";
    }
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * Extracts static pathname prefix from an expression text (e.g. env fallback or string literal).
 */
function extractPathnameFromExpressionText(exprText: string): string {
  const urlMatches = exprText.matchAll(/['"`](https?:\/\/[^'"`]+|\/[a-zA-Z0-9_/-]+)['"`]/g);
  for (const match of urlMatches) {
    const candidate = match[1];
    const path = extractPathnameFromUrlString(candidate);
    if (path && path !== "/") {
      return path;
    }
  }
  const suffixMatch = exprText.match(/\/([a-zA-Z0-9_-]+)['"`]?$/);
  if (suffixMatch) {
    return "/" + suffixMatch[1];
  }
  return "";
}

/**
 * Discovers Axios client instances created with `axios.create({ baseURL: ... })`.
 * Returns a map from client variable name to its static baseURL pathname prefix.
 */
function discoverAxiosClients(
  root: SyntaxNode,
  documentUri: DocumentUri,
  resolver?: LocalReferenceResolver
): Map<string, string> {
  const clients = new Map<string, string>();

  walkTree(root, (node) => {
    if (node.kind !== "variable_declarator") {
      return;
    }

    const nameNode = node.childForField("name") ?? node.namedChildren()[0];
    const valNode = node.childForField("value") ?? node.namedChildren()[1];

    if (
      !nameNode ||
      nameNode.kind !== "identifier" ||
      !valNode ||
      valNode.kind !== "call_expression"
    ) {
      return;
    }

    const clientName = nameNode.text();
    const callee = valNode.childForField("function") ?? valNode.namedChildren()[0];
    if (!callee || callee.kind !== "member_expression") {
      return;
    }

    const obj = callee.childForField("object") ?? callee.namedChildren()[0];
    const prop = callee.childForField("property") ?? callee.namedChildren()[1];

    if (obj?.text() !== "axios" || prop?.text() !== "create") {
      return;
    }

    // Found `axios.create(...)`
    let basePath = "";
    const args = valNode.childForField("arguments")?.namedChildren() ?? [];
    if (args.length > 0 && args[0].kind === "object") {
      for (const pair of args[0].namedChildren()) {
        if (pair.kind === "pair") {
          const key = pair.childForField("key") ?? pair.namedChildren()[0];
          const val = pair.childForField("value") ?? pair.namedChildren()[1];
          const keyText = key?.text()?.replace(/['"]/g, "");

          if ((keyText === "baseURL" || keyText === "baseUrl") && val) {
            if (val.kind === "string") {
              const rawStr = val.text().slice(1, -1);
              basePath = extractPathnameFromUrlString(rawStr);
            } else if (val.kind === "identifier" && resolver) {
              const identName = val.text();
              const res = resolver.resolveConstant<string>(identName, documentUri, val.range);
              if (res.state === "resolved" && typeof res.value === "string") {
                basePath = extractPathnameFromUrlString(res.value);
              } else {
                const decls = resolver.index
                  .lookupSymbols(identName, documentUri)
                  .filter((d) => d.documentUri === documentUri);
                if (decls.length > 0 && decls[0].kind === "variable") {
                  const init = (decls[0] as LocalVariableDeclaration).initializerText ?? "";
                  basePath = extractPathnameFromExpressionText(init);
                }
              }
            } else if (val.kind === "template_string") {
              basePath = extractPathnameFromExpressionText(val.text());
            }
          }
        }
      }
    }

    clients.set(clientName, basePath);
  });

  return clients;
}

/**
 * Checks if a syntax node represents an Axios method call expression.
 * Matches:
 *  - `axios.<method>(...)`
 *  - `window.axios.<method>(...)`
 *  - `globalThis.axios.<method>(...)`
 *  - `api.<method>(...)` (configured client per LLD Section 7.2)
 *  - configured clients created via `axios.create(...)`
 * Rejects:
 *  - non-HTTP members like `axios.create`, `axios.all`, `axios.isAxiosError`
 *  - unrelated receivers like `console.log`, `router.get`, `app.get`, `client.get`
 */
function checkAxiosCall(
  node: SyntaxNode,
  knownClients?: ReadonlyMap<string, string>
): AxiosCallMatch {
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

    // Direct `api.<method>` or discovered configured client
    if (
      objectNode.kind === "identifier" &&
      (objectNode.text() === "api" || (knownClients && knownClients.has(objectNode.text())))
    ) {
      return {
        matched: true,
        receiver: objectNode.text(),
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
    const extraction = extractTemplateRoute(argNode, documentUri, mapper, "Axios", resolver);
    if (extraction.warning) {
      warnings.push(extraction.warning);
    }
    return extraction.routeValue;
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
        scope: "consumer",
        targetDimension: "route",
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

    // If not resolved as constant, check if it's a locally initialized variable (e.g. let url = '/path?param=...')
    const localDecls = resolver.index
      .lookupSymbols(refName, documentUri)
      .filter((c) => c.documentUri === documentUri);
    if (localDecls.length === 1 && localDecls[0].kind === "variable") {
      const varDecl = localDecls[0] as LocalVariableDeclaration;
      const initText = varDecl.initializerText?.trim();
      if (
        initText &&
        (initText.startsWith('"') || initText.startsWith("'") || initText.startsWith("`"))
      ) {
        const unquoted = initText.slice(1, -1);
        const queryIndex = unquoted.indexOf("?");
        // Only resolve mutable variable if the path is separated from dynamic query parameters
        if (queryIndex > 0) {
          const pathPart = unquoted.slice(0, queryIndex);
          if (pathPart.startsWith("/")) {
            const normalizedPath = pathPart.replace(/\$\{([a-zA-Z0-9_$]+)\}/g, ":$1");
            if (!normalizedPath.includes("${")) {
              const routePattern = parseRoutePattern(normalizedPath);
              const evidence: EvidenceRef = {
                id: `ev-path-${argNode.range.start}`,
                kind: "local-declaration",
                strength: "resolved",
                source: argSpan,
                description: `Resolved local variable '${refName}' with path '${routePattern.rawPath}' (query parameters excluded from route)`
              };

              return {
                state: "known",
                value: routePattern,
                strength: "resolved",
                evidence: [evidence, varDecl.evidence]
              };
            }
          }
        }
      }
    }
  }

  // 4. Dynamic expression (variable, call, binary expression, unresolved reference, etc.)
  const warning: AnalysisWarning = {
    code: "DYNAMIC_ROUTE",
    message: `Dynamic URL expression in Axios call cannot be statically resolved: ${argNode.text()}`,
    source: argSpan,
    analyzerId: "analyzer-js-ts",
    scope: "consumer",
    targetDimension: "route",
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
 * Extracts request body shape from the payload argument (arg 1 in POST/PUT/PATCH).
 */
function extractRequestBody(
  dataNode: SyntaxNode | undefined,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[],
  resolver?: LocalReferenceResolver,
  parsed?: ParsedDocument,
  document?: SourceDocument
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

  // Local identifier resolution e.g. axios.post("/api", registrationData)
  if (dataNode.kind === "identifier") {
    const refName = dataNode.text();
    let resolved = resolver?.resolveObjectLiteral(refName, documentUri, dataNode.range);
    if ((!resolved || resolved.state !== "resolved") && parsed && document) {
      try {
        const localIndex = createLocalDeclarationIndex([{ document, parsed }]);
        const localResolver = createLocalReferenceResolver(localIndex);
        resolved = localResolver.resolveObjectLiteral(refName, documentUri, dataNode.range);
      } catch {
        // ignore
      }
    }

    if (resolved && resolved.state === "resolved") {
      return {
        shape: {
          kind: "object",
          properties: [...resolved.value],
          additionalProperties: "unknown"
        },
        completeness: "complete",
        evidence: resolved.evidence
      };
    }
  }

  // Dynamic variable or unresolved expression e.g. axios.post("/api", payload)
  const warning: AnalysisWarning = {
    code: "PARTIAL_SHAPE",
    message: `Unresolved request payload expression in Axios call: ${dataNode.text()}`,
    source: dataSpan,
    analyzerId: "analyzer-js-ts",
    scope: "consumer",
    targetDimension: "request-shape",
    affectsCompleteness: false
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
  signal?: AbortSignal | LocalReferenceResolver,
  resolver?: LocalReferenceResolver
): AxiosExtractionResult {
  let actualSignal: AbortSignal | undefined;
  let actualResolver = resolver;

  if (signal) {
    if (
      "aborted" in signal ||
      typeof (signal as unknown as AbortSignal).addEventListener === "function"
    ) {
      actualSignal = signal as unknown as AbortSignal;
    } else {
      actualResolver = signal as unknown as LocalReferenceResolver;
    }
  }

  const observations: ApiObservation[] = [];
  const warnings: AnalysisWarning[] = [];
  const mapper = new PositionMapper(document.text, document.uri);
  const clients = discoverAxiosClients(parsed.root, document.uri, actualResolver);

  walkTree(parsed.root, (node) => {
    actualSignal?.throwIfAborted();

    const match = checkAxiosCall(node, clients);
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
        scope: "consumer",
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
        scope: "consumer",
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
    let path = extractPath(args[0], document.uri, mapper, localWarnings, actualResolver);

    // Apply client baseURL prefix if configured on this Axios instance
    const clientBasePath = clients.get(match.receiver);
    if (clientBasePath && clientBasePath !== "/" && path.state === "known" && path.value) {
      const composedRaw = combineRoutePaths(clientBasePath, path.value.rawPath);
      if (composedRaw !== path.value.rawPath) {
        path = {
          ...path,
          value: parseRoutePattern(composedRaw)
        };
      }
    }

    // 3. Request body (for POST, PUT, PATCH: arg 1 is payload data)
    let request: RequestShapeObservation | undefined;
    if (match.httpMethod && BODY_METHODS.has(match.httpMethod) && args.length > 1) {
      const bodyShape = extractRequestBody(
        args[1],
        document.uri,
        mapper,
        localWarnings,
        actualResolver,
        parsed,
        document
      );
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
