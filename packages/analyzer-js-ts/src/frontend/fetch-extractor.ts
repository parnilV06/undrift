// Standard fetch() call extractor as specified in LLD.md Section 7.1 and 7.2.
// Extracts client-side API observations from standard fetch calls in JavaScript and TypeScript.

import type {
  AnalysisWarning,
  ApiObservation,
  DocumentUri,
  EvidenceRef,
  FieldShape,
  HttpMethod,
  ObservationId,
  ObservedValue,
  ParsedDocument,
  RequestShapeObservation,
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
import {
  findEnclosingFunction,
  resolveRouteHelperCallsites,
  type ResolvedHelperRoute,
  type RouteHelperResolution
} from "./route-helper-resolver";
import {
  analyzeWrapperCallsites,
  extractFormDataFields,
  extractObjectFields,
  extractTypeFields,
  findEnclosingParameter,
  isFormDataNode,
  isMultipartHeaders
} from "../shapes/shape-extractor";

const VALID_HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
]);

/**
 * Checks if a syntax node represents a standard fetch() call expression.
 * Matches:
 *  - direct `fetch(...)` calls
 *  - `window.fetch(...)`
 *  - `globalThis.fetch(...)`
 * Ignores:
 *  - custom client member calls like `axios.get(...)`, `api.fetch(...)`, `client.fetch(...)`
 *  - different function names like `fetcher(...)`
 */
const FETCH_HELPER_NAMES: ReadonlySet<string> = new Set(["request"]);

function isFetchCall(node: SyntaxNode): boolean {
  if (node.kind !== "call_expression") {
    return false;
  }

  const fnNode = node.childForField("function") ?? node.namedChildren()[0];
  if (!fnNode) {
    return false;
  }

  // 1. Direct fetch(...) call
  if (fnNode.kind === "identifier" && fnNode.text() === "fetch") {
    return true;
  }

  // 2. window.fetch(...) or globalThis.fetch(...)
  if (fnNode.kind === "member_expression") {
    const objectNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
    const propertyNode = fnNode.childForField("property") ?? fnNode.namedChildren()[1];

    if (
      propertyNode?.text() === "fetch" &&
      (objectNode?.text() === "window" || objectNode?.text() === "globalThis")
    ) {
      return true;
    }
  }

  // 3. Client fetch wrappers e.g. request('/api/...', { method: 'POST' })
  if (fnNode.kind === "identifier" && FETCH_HELPER_NAMES.has(fnNode.text())) {
    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];
    if (args.length > 0) {
      const firstArg = args[0];
      // Check if first arg looks like a URL/route string or template
      if (firstArg.kind === "string" || firstArg.kind === "template_string") {
        const text = firstArg.text().slice(1, -1);
        if (text.startsWith("/") || text.startsWith("http://") || text.startsWith("https://")) {
          return true;
        }
      }
      // Check if second arg has options object
      if (args.length > 1 && args[1].kind === "object") {
        return true;
      }
      // Check if first arg is an identifier named like a URL or route
      if (firstArg.kind === "identifier") {
        const argText = firstArg.text().toLowerCase();
        if (
          argText.includes("url") ||
          argText.includes("path") ||
          argText.includes("endpoint") ||
          (args.length > 1 && args[1].kind === "object")
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks if a variable identifier is a formal parameter of its enclosing function.
 */
function isEnclosingFunctionParameter(node: SyntaxNode, paramName: string): boolean {
  let curr: SyntaxNode | undefined = node.parent();
  while (curr) {
    if (
      curr.kind === "function_declaration" ||
      curr.kind === "function_expression" ||
      curr.kind === "arrow_function" ||
      curr.kind === "method_definition"
    ) {
      const paramsNode =
        curr.childForField("parameters") ??
        curr.namedChildren().find((c) => c.kind === "formal_parameters");
      if (paramsNode) {
        for (const p of paramsNode.namedChildren()) {
          let idName: string | undefined;
          if (p.kind === "identifier") {
            idName = p.text();
          } else if (p.kind === "required_parameter" || p.kind === "optional_parameter") {
            const patternNode = p.childForField("pattern") ?? p.namedChildren()[0];
            if (patternNode && patternNode.kind === "identifier") {
              idName = patternNode.text();
            }
          }
          if (idName === paramName) {
            return true;
          }
        }
      }
      break;
    }
    curr = curr.parent();
  }
  return false;
}

/**
 * Parses raw path string into structural RoutePattern.
 */
function parseRoutePattern(rawUrl: string): RoutePattern {
  const queryIndex = rawUrl.indexOf("?");
  const pathPart = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  const trailingSlash = pathPart.length > 1 && pathPart.endsWith("/") ? "present" : "absent";
  const queryHandling = queryIndex >= 0 ? "excluded-from-path" : "excluded-from-path";

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

interface ExtractedPathResult {
  readonly routeValue: ObservedValue<RoutePattern>;
  readonly helperResolution?: RouteHelperResolution;
}

/**
 * Extracts the URL path ObservedValue from the first argument of fetch().
 */
function extractPath(
  argNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[],
  resolver?: LocalReferenceResolver,
  rootNode?: SyntaxNode
): ExtractedPathResult {
  const argSpan = mapper.toSourceSpanFromUtf16(argNode.range.start, argNode.range.end, documentUri);

  // 1. Literal string e.g. "/api/users" or '/api/users'
  if (argNode.kind === "string") {
    const raw = argNode.text();
    const unquoted = raw.slice(1, -1);
    const routePattern = parseRoutePattern(unquoted);

    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: argSpan,
      description: `Static URL literal '${routePattern.rawPath}' in fetch call`
    };

    return {
      routeValue: {
        state: "known",
        value: routePattern,
        strength: "direct",
        evidence: [evidence]
      }
    };
  }

  // 2. Template string literal (supports static, dynamic query, and parameter interpolations)
  if (argNode.kind === "template_string") {
    const extraction = extractTemplateRoute(
      argNode,
      documentUri,
      mapper,
      "fetch",
      resolver,
      rootNode
    );
    if (extraction.warning) {
      warnings.push(extraction.warning);
    }
    return {
      routeValue: extraction.routeValue,
      helperResolution: extraction.helperResolution
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
          routeValue: {
            state: "known",
            value: routePattern,
            strength: "resolved",
            evidence: result.evidence
          }
        };
      }

      // Resolved, but not a valid string URL
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: `Resolved constant '${refName}' is not a string URL: ${String(result.value)}`,
        source: argSpan,
        analyzerId: "analyzer-js-ts",
        affectsCompleteness: true,
        scope: "consumer",
        targetDimension: "route"
      };
      warnings.push(warning);

      return {
        routeValue: {
          state: "dynamic",
          expression: refName,
          reason: `Constant '${refName}' resolved to non-string value`,
          evidence: result.evidence
        }
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
        const subStart = initText.startsWith("`") ? unquoted.indexOf("${") : -1;
        let pathPart: string | undefined;
        if (queryIndex > 0 && (subStart === -1 || queryIndex < subStart)) {
          pathPart = unquoted.slice(0, queryIndex);
        } else if (subStart > 0) {
          const subExpr = unquoted.slice(subStart + 2);
          if (/(?:query|search|param|qs)/i.test(subExpr) || subExpr.includes("?")) {
            pathPart = unquoted.slice(0, subStart);
          }
        } else if (queryIndex > 0) {
          pathPart = unquoted.slice(0, queryIndex);
        }
        // Only resolve mutable variable if the path is separated from dynamic query parameters
        if (pathPart && pathPart.startsWith("/")) {
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
              routeValue: {
                state: "known",
                value: routePattern,
                strength: "resolved",
                evidence: [evidence, varDecl.evidence]
              }
            };
          }
        }
      }
    }
  }

  // Phase 6.3 Task 3.1: Bounded callsite resolution for direct parameter forwarding e.g. fetch(url) or fetch(path)
  if (argNode.kind === "identifier" && rootNode) {
    const enclosingFn = findEnclosingFunction(argNode, rootNode);
    const param = enclosingFn?.params.find((p) => p.name === argNode.text());
    if (
      enclosingFn &&
      !enclosingFn.isExported &&
      enclosingFn.isModuleScope &&
      enclosingFn.fnName &&
      param
    ) {
      const fnName = enclosingFn.fnName;
      const fnNode = enclosingFn.fnNode;
      const callsitesResult = resolveRouteHelperCallsites(
        rootNode,
        fnName,
        param.index,
        param.name,
        fnNode,
        documentUri,
        mapper,
        resolver
      );

      if (callsitesResult.status === "resolved") {
        const resolvedRoutes: ResolvedHelperRoute[] = [];
        for (const cs of callsitesResult.resolvedCallsites) {
          const routePattern = parseRoutePattern(cs.staticValue);
          const evidence: EvidenceRef = {
            id: `ev-path-${argNode.range.start}-${cs.callNode.range.start}`,
            kind: "local-declaration",
            strength: "resolved",
            source: cs.callSpan,
            description: `Resolved URL '${routePattern.rawPath}' from helper call to '${fnName}' in fetch call`
          };

          resolvedRoutes.push({
            routeValue: {
              state: "known",
              value: routePattern,
              strength: "resolved",
              evidence: [evidence, ...cs.evidence]
            },
            callNode: cs.callNode,
            callSpan: cs.callSpan,
            staticValue: cs.staticValue
          });
        }

        return {
          routeValue: resolvedRoutes[0].routeValue,
          helperResolution: {
            status: "resolved",
            resolvedRoutes,
            dynamicRoutes: []
          }
        };
      }
    }
  }

  // 3b. Binary expression string concatenation: e.g. '/api/posts/' + postId
  if (argNode.kind === "binary_expression") {
    const left = argNode.childForField("left");
    const right = argNode.childForField("right");
    const op = argNode.children().find((c) => c.text() === "+");
    if (op && left && right) {
      if (left.kind === "string" && right.kind === "identifier") {
        const leftVal = left.text().slice(1, -1);
        if (leftVal.startsWith("/") || leftVal.length > 0) {
          const identName = right.text();
          if (rootNode) {
            const enclosingFn = findEnclosingFunction(argNode, rootNode);
            const param = enclosingFn?.params.find((p) => p.name === identName);
            if (
              enclosingFn &&
              !enclosingFn.isExported &&
              enclosingFn.isModuleScope &&
              enclosingFn.fnName &&
              param
            ) {
              const fnName = enclosingFn.fnName;
              const fnNode = enclosingFn.fnNode;
              const callsitesResult = resolveRouteHelperCallsites(
                rootNode,
                fnName,
                param.index,
                param.name,
                fnNode,
                documentUri,
                mapper,
                resolver
              );
              if (callsitesResult.status === "resolved") {
                const resolvedRoutes: ResolvedHelperRoute[] = [];
                for (const cs of callsitesResult.resolvedCallsites) {
                  const combined = leftVal.endsWith("/")
                    ? leftVal + cs.staticValue
                    : leftVal + "/" + cs.staticValue;
                  const routePattern = parseRoutePattern(combined);
                  const evidence: EvidenceRef = {
                    id: `ev-path-${argNode.range.start}-${cs.callNode.range.start}`,
                    kind: "local-declaration",
                    strength: "resolved",
                    source: cs.callSpan,
                    description: `Resolved URL '${routePattern.rawPath}' from helper call to '${fnName}' in fetch call`
                  };
                  resolvedRoutes.push({
                    routeValue: {
                      state: "known",
                      value: routePattern,
                      strength: "resolved",
                      evidence: [evidence, ...cs.evidence]
                    },
                    callNode: cs.callNode,
                    callSpan: cs.callSpan,
                    staticValue: cs.staticValue
                  });
                }
                return {
                  routeValue: resolvedRoutes[0].routeValue,
                  helperResolution: {
                    status: "resolved",
                    resolvedRoutes,
                    dynamicRoutes: []
                  }
                };
              }
            }
          }

          // Standard single-segment resource parameter representation:
          const combined = leftVal.endsWith("/")
            ? leftVal + ":" + identName
            : leftVal + "/:" + identName;
          const routePattern = parseRoutePattern(combined);
          const evidence: EvidenceRef = {
            id: `ev-path-${argNode.range.start}`,
            kind: "literal-syntax",
            strength: "inferred",
            source: argSpan,
            description: `Concatenated URL path with parameter '${identName}' in fetch call`
          };
          return {
            routeValue: {
              state: "known",
              value: routePattern,
              strength: "inferred",
              evidence: [evidence]
            }
          };
        }
      }
    }
  }

  // 4. Dynamic expression (variable, call, binary expression, unresolved reference, etc.)
  const isParamForwarding =
    argNode.kind === "identifier" && isEnclosingFunctionParameter(argNode, argNode.text());

  const warning: AnalysisWarning = {
    code: "DYNAMIC_ROUTE",
    message: isParamForwarding
      ? `Dynamic URL parameter forwarded in helper function; individual endpoints are analyzed at wrapper callsites: ${argNode.text()}`
      : `Dynamic URL expression in fetch call cannot be statically resolved: ${argNode.text()}`,
    source: argSpan,
    analyzerId: "analyzer-js-ts",
    affectsCompleteness: !isParamForwarding,
    scope: "consumer",
    targetDimension: "route"
  };
  warnings.push(warning);

  const evidence: EvidenceRef = {
    id: `ev-path-${argNode.range.start}`,
    kind: "literal-syntax",
    strength: "inferred",
    source: argSpan,
    description: `Dynamic URL expression in fetch call`
  };

  return {
    routeValue: {
      state: "dynamic",
      expression: argNode.text(),
      reason: "Dynamic URL expression",
      evidence: [evidence]
    }
  };
}

/**
 * Extracts HTTP method and request shape options from the second argument of fetch().
 */
function extractOptions(
  optionsNode: SyntaxNode | undefined,
  callSpan: SourceSpan,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[],
  resolver?: LocalReferenceResolver,
  parsed?: ParsedDocument,
  document?: SourceDocument
): {
  method: ObservedValue<HttpMethod>;
  request?: RequestShapeObservation;
} {
  // If no options argument supplied, default to GET per standard fetch specification
  if (!optionsNode) {
    const evidence: EvidenceRef = {
      id: `ev-method-${callSpan.range.start}`,
      kind: "framework-convention",
      strength: "direct",
      source: callSpan,
      description: "Default GET method for standard fetch call"
    };

    return {
      method: {
        state: "known",
        value: "GET",
        strength: "direct",
        evidence: [evidence]
      }
    };
  }

  const optionsSpan = mapper.toSourceSpanFromUtf16(
    optionsNode.range.start,
    optionsNode.range.end,
    documentUri
  );

  // If options is not an object literal (e.g. identifier or call expression)
  if (optionsNode.kind !== "object") {
    const isParamForwarding =
      optionsNode.kind === "identifier" &&
      isEnclosingFunctionParameter(optionsNode, optionsNode.text());

    const warning: AnalysisWarning = {
      code: "UNSUPPORTED_PATTERN",
      message: isParamForwarding
        ? `Dynamic options parameter forwarded in helper function; method and payload are analyzed at wrapper callsites: ${optionsNode.text()}`
        : `Non-object options argument in fetch call cannot be statically resolved: ${optionsNode.text()}`,
      source: optionsSpan,
      analyzerId: "analyzer-js-ts",
      affectsCompleteness: !isParamForwarding,
      scope: "consumer",
      targetDimension: "method"
    };
    warnings.push(warning);

    const evidence: EvidenceRef = {
      id: `ev-method-${optionsNode.range.start}`,
      kind: "literal-syntax",
      strength: "inferred",
      source: optionsSpan,
      description: `Dynamic options argument in fetch call`
    };

    return {
      method: {
        state: "dynamic",
        expression: optionsNode.text(),
        reason: "Dynamic options argument",
        evidence: [evidence]
      }
    };
  }

  // Scan properties of object literal
  let methodValue: ObservedValue<HttpMethod> | undefined;
  let bodyShape: ShapeObservation | undefined;

  let isMultipartHint = false;
  for (const child of optionsNode.namedChildren()) {
    if (child.kind === "pair") {
      const k = child.childForField("key") ?? child.namedChildren()[0];
      const v = child.childForField("value") ?? child.namedChildren()[1];
      let kText = k?.text() ?? "";
      if (k?.kind === "string") {
        kText = kText.slice(1, -1);
      }
      if (kText.toLowerCase() === "headers" && v) {
        if (isMultipartHeaders(v)) {
          isMultipartHint = true;
        }
      }
    }
  }

  for (const child of optionsNode.namedChildren()) {
    if (child.kind !== "pair") {
      continue;
    }

    const keyNode = child.childForField("key") ?? child.namedChildren()[0];
    const valNode = child.childForField("value") ?? child.namedChildren()[1];

    if (!keyNode || !valNode) {
      continue;
    }

    let keyText = keyNode.text();
    if (keyNode.kind === "string") {
      keyText = keyText.slice(1, -1);
    }

    const propSpan = mapper.toSourceSpanFromUtf16(child.range.start, child.range.end, documentUri);

    // 1. method property
    if (keyText.toLowerCase() === "method") {
      if (valNode.kind === "string") {
        const rawMethod = valNode.text().slice(1, -1).toUpperCase();

        if (VALID_HTTP_METHODS.has(rawMethod)) {
          const valSpan = mapper.toSourceSpanFromUtf16(
            valNode.range.start,
            valNode.range.end,
            documentUri
          );
          const evidence: EvidenceRef = {
            id: `ev-method-${child.range.start}`,
            kind: "literal-syntax",
            strength: "direct",
            source: valSpan,
            description: `Explicit HTTP method '${rawMethod}' in fetch options`
          };

          methodValue = {
            state: "known",
            value: rawMethod as HttpMethod,
            strength: "direct",
            evidence: [evidence]
          };
        } else {
          const warning: AnalysisWarning = {
            code: "UNSUPPORTED_PATTERN",
            message: `Unsupported or invalid HTTP method in fetch options: '${rawMethod}'`,
            source: propSpan,
            analyzerId: "analyzer-js-ts",
            affectsCompleteness: true,
            scope: "consumer",
            targetDimension: "method"
          };
          warnings.push(warning);

          const evidence: EvidenceRef = {
            id: `ev-method-${child.range.start}`,
            kind: "literal-syntax",
            strength: "inferred",
            source: propSpan,
            description: `Unsupported HTTP method '${rawMethod}' in fetch options`
          };

          methodValue = {
            state: "unknown",
            reason: `Unsupported HTTP method '${rawMethod}'`,
            evidence: [evidence]
          };
        }
      } else {
        const warning: AnalysisWarning = {
          code: "UNSUPPORTED_PATTERN",
          message: `Dynamic HTTP method expression in fetch options cannot be statically determined: ${valNode.text()}`,
          source: propSpan,
          analyzerId: "analyzer-js-ts",
          affectsCompleteness: true,
          scope: "consumer",
          targetDimension: "method"
        };
        warnings.push(warning);

        const evidence: EvidenceRef = {
          id: `ev-method-${child.range.start}`,
          kind: "literal-syntax",
          strength: "inferred",
          source: propSpan,
          description: `Dynamic HTTP method expression in fetch options`
        };

        methodValue = {
          state: "dynamic",
          expression: valNode.text(),
          reason: "Dynamic HTTP method expression",
          evidence: [evidence]
        };
      }
    }

    // 2. body property
    if (keyText.toLowerCase() === "body") {
      const bodySpan = mapper.toSourceSpanFromUtf16(
        valNode.range.start,
        valNode.range.end,
        documentUri
      );

      // JSON.stringify(...) call
      if (valNode.kind === "call_expression") {
        const fnNode = valNode.childForField("function") ?? valNode.namedChildren()[0];

        if (fnNode?.text() === "JSON.stringify") {
          const jsonArgs = valNode.childForField("arguments")?.namedChildren() ?? [];

          if (jsonArgs.length > 0 && jsonArgs[0].kind === "object") {
            const properties = extractObjectFields(jsonArgs[0], documentUri, mapper, resolver);

            const evidence: EvidenceRef = {
              id: `ev-body-${valNode.range.start}`,
              kind: "literal-syntax",
              strength: "direct",
              source: bodySpan,
              description: "JSON.stringify object literal request body"
            };

            bodyShape = {
              shape: {
                kind: "object",
                properties,
                additionalProperties: "unknown"
              },
              completeness: "complete",
              evidence: [evidence]
            };
          } else if (jsonArgs.length > 0 && jsonArgs[0].kind === "identifier") {
            const identName = jsonArgs[0].text();
            let resolved = resolver?.resolveObjectLiteral(
              identName,
              documentUri,
              jsonArgs[0].range
            );
            if ((!resolved || resolved.state !== "resolved") && parsed && document) {
              try {
                const localIndex = createLocalDeclarationIndex([{ document, parsed }]);
                const localResolver = createLocalReferenceResolver(localIndex);
                resolved = localResolver.resolveObjectLiteral(
                  identName,
                  documentUri,
                  jsonArgs[0].range
                );
              } catch {
                // ignore
              }
            }

            if (resolved && resolved.state === "resolved" && resolved.value) {
              bodyShape = {
                shape: {
                  kind: "object",
                  properties: [...resolved.value],
                  additionalProperties: "unknown"
                },
                completeness: "complete",
                evidence: resolved.evidence
              };
            } else {
              // Try function parameter type annotation (inline object_type or type_identifier)
              let typeMatched = false;
              const paramInfo = findEnclosingParameter(jsonArgs[0], identName);
              if (paramInfo?.innerTypeNode) {
                const innerNode = paramInfo.innerTypeNode;
                if (innerNode.kind === "object_type") {
                  const properties = extractTypeFields(innerNode, documentUri, mapper);
                  const evidence: EvidenceRef = {
                    id: `ev-body-${valNode.range.start}`,
                    kind: "explicit-annotation",
                    strength: "direct",
                    source: mapper.toSourceSpanFromUtf16(
                      paramInfo.paramNode.range.start,
                      paramInfo.paramNode.range.end,
                      documentUri
                    ),
                    description: `Request payload typed with inline object type for parameter '${identName}'`
                  };
                  bodyShape = {
                    shape: {
                      kind: "object",
                      properties,
                      additionalProperties: "unknown"
                    },
                    completeness: "complete",
                    evidence: [evidence]
                  };
                  typeMatched = true;
                } else if (innerNode.kind === "type_identifier") {
                  const typeName = innerNode.text();
                  let typeRes = resolver?.resolveObjectLiteral(typeName, documentUri);
                  if ((!typeRes || typeRes.state !== "resolved") && parsed && document) {
                    try {
                      const localIndex = createLocalDeclarationIndex([{ document, parsed }]);
                      const localResolver = createLocalReferenceResolver(localIndex);
                      typeRes = localResolver.resolveObjectLiteral(typeName, documentUri);
                    } catch {
                      // ignore
                    }
                  }
                  if (typeRes && typeRes.state === "resolved" && typeRes.value) {
                    bodyShape = {
                      shape: {
                        kind: "object",
                        properties: [...typeRes.value],
                        additionalProperties: "unknown"
                      },
                      completeness: "complete",
                      evidence: typeRes.evidence
                    };
                    typeMatched = true;
                  }
                }
              }

              // Try wrapper callsites
              if (!typeMatched && paramInfo?.fnName && parsed) {
                const callRes = analyzeWrapperCallsites(
                  parsed.root,
                  paramInfo.fnName,
                  paramInfo.paramIndex,
                  documentUri,
                  mapper,
                  resolver
                );
                if (callRes.status === "resolved" && callRes.properties) {
                  bodyShape = {
                    shape: {
                      kind: "object",
                      properties: callRes.properties,
                      additionalProperties: "unknown"
                    },
                    completeness: "complete",
                    evidence: callRes.evidence ?? [
                      {
                        id: `ev-body-${valNode.range.start}`,
                        kind: "local-declaration",
                        strength: "inferred",
                        source: bodySpan,
                        description: `Resolved wrapper payload from consistent callsites for '${identName}'`
                      }
                    ]
                  };
                  typeMatched = true;
                }
              }

              if (!typeMatched) {
                const isMultipart =
                  isMultipartHint || isFormDataNode(jsonArgs[0], resolver, documentUri);
                const warningMsg = isMultipart
                  ? `Multipart form data payload cannot be fully statically inferred: ${valNode.text()}`
                  : `Non-literal payload in JSON.stringify body cannot be statically resolved: ${valNode.text()}`;

                const warning: AnalysisWarning = {
                  code: "PARTIAL_SHAPE",
                  message: warningMsg,
                  source: bodySpan,
                  analyzerId: "analyzer-js-ts",
                  affectsCompleteness: false,
                  scope: "consumer",
                  targetDimension: "request-shape"
                };
                warnings.push(warning);

                const evidence: EvidenceRef = {
                  id: `ev-body-${valNode.range.start}`,
                  kind: "literal-syntax",
                  strength: "inferred",
                  source: bodySpan,
                  description: isMultipart
                    ? `Multipart form data payload in fetch call`
                    : "Unresolved payload expression in JSON.stringify body"
                };

                bodyShape = {
                  shape: {
                    kind: "unknown",
                    reason: isMultipart ? "dynamic-expression" : "unresolved-reference"
                  },
                  completeness: "partial",
                  evidence: [evidence]
                };
              }
            }
          } else {
            const warning: AnalysisWarning = {
              code: "PARTIAL_SHAPE",
              message: `Non-literal payload in JSON.stringify body cannot be statically resolved: ${valNode.text()}`,
              source: bodySpan,
              analyzerId: "analyzer-js-ts",
              affectsCompleteness: false,
              scope: "consumer",
              targetDimension: "request-shape"
            };
            warnings.push(warning);

            const evidence: EvidenceRef = {
              id: `ev-body-${valNode.range.start}`,
              kind: "literal-syntax",
              strength: "inferred",
              source: bodySpan,
              description: "Unresolved payload expression in JSON.stringify body"
            };

            bodyShape = {
              shape: {
                kind: "unknown",
                reason: "unresolved-reference"
              },
              completeness: "partial",
              evidence: [evidence]
            };
          }
        } else {
          const warning: AnalysisWarning = {
            code: "UNSUPPORTED_PATTERN",
            message: `Unsupported body serialization call in fetch options: ${valNode.text()}`,
            source: bodySpan,
            analyzerId: "analyzer-js-ts",
            affectsCompleteness: false,
            scope: "consumer",
            targetDimension: "request-shape"
          };
          warnings.push(warning);

          const evidence: EvidenceRef = {
            id: `ev-body-${valNode.range.start}`,
            kind: "literal-syntax",
            strength: "inferred",
            source: bodySpan,
            description: "Unsupported body serialization expression"
          };

          bodyShape = {
            shape: {
              kind: "unknown",
              reason: "unsupported-syntax"
            },
            completeness: "partial",
            evidence: [evidence]
          };
        }
      } else if (valNode.kind === "string") {
        const evidence: EvidenceRef = {
          id: `ev-body-${valNode.range.start}`,
          kind: "literal-syntax",
          strength: "direct",
          source: bodySpan,
          description: "Literal string request body"
        };

        bodyShape = {
          shape: {
            kind: "primitive",
            name: "string"
          },
          completeness: "complete",
          evidence: [evidence]
        };
      } else {
        // Direct body expression (e.g. body: formData, body: payload, body: new FormData())
        const isMultipart = isMultipartHint || isFormDataNode(valNode, resolver, documentUri);
        if (isMultipart) {
          const enclosingParam =
            valNode.kind === "identifier"
              ? findEnclosingParameter(valNode, valNode.text())
              : undefined;
          const searchScope = enclosingParam?.fnNode ?? parsed?.root ?? valNode;
          const formFields = extractFormDataFields(
            searchScope,
            valNode.text(),
            documentUri,
            mapper
          );

          if (formFields.length > 0) {
            bodyShape = {
              shape: {
                kind: "object",
                properties: formFields,
                additionalProperties: "unknown"
              },
              completeness: "complete",
              evidence: formFields.flatMap((f) => f.evidence)
            };
          } else {
            const warning: AnalysisWarning = {
              code: "PARTIAL_SHAPE",
              message: `Multipart form data payload cannot be fully statically inferred: ${valNode.text()}`,
              source: bodySpan,
              analyzerId: "analyzer-js-ts",
              affectsCompleteness: false,
              scope: "consumer",
              targetDimension: "request-shape"
            };
            warnings.push(warning);

            const evidence: EvidenceRef = {
              id: `ev-body-${valNode.range.start}`,
              kind: "literal-syntax",
              strength: "inferred",
              source: bodySpan,
              description: `Multipart form data payload in fetch call: ${valNode.text()}`
            };

            bodyShape = {
              shape: {
                kind: "unknown",
                reason: "dynamic-expression"
              },
              completeness: "partial",
              evidence: [evidence]
            };
          }
        } else if (valNode.kind === "identifier") {
          const refName = valNode.text();
          let resolved = resolver?.resolveObjectLiteral(refName, documentUri, valNode.range);
          if ((!resolved || resolved.state !== "resolved") && parsed && document) {
            try {
              const localIndex = createLocalDeclarationIndex([{ document, parsed }]);
              const localResolver = createLocalReferenceResolver(localIndex);
              resolved = localResolver.resolveObjectLiteral(refName, documentUri, valNode.range);
            } catch {
              // ignore
            }
          }

          if (resolved && resolved.state === "resolved" && resolved.value) {
            bodyShape = {
              shape: {
                kind: "object",
                properties: [...resolved.value],
                additionalProperties: "unknown"
              },
              completeness: "complete",
              evidence: resolved.evidence
            };
          } else {
            const warning: AnalysisWarning = {
              code: "PARTIAL_SHAPE",
              message: `Unsupported request body expression in fetch options: ${valNode.text()}`,
              source: bodySpan,
              analyzerId: "analyzer-js-ts",
              affectsCompleteness: false,
              scope: "consumer",
              targetDimension: "request-shape"
            };
            warnings.push(warning);

            const evidence: EvidenceRef = {
              id: `ev-body-${valNode.range.start}`,
              kind: "literal-syntax",
              strength: "inferred",
              source: bodySpan,
              description: "Unsupported request body expression"
            };

            bodyShape = {
              shape: {
                kind: "unknown",
                reason: "unsupported-syntax"
              },
              completeness: "partial",
              evidence: [evidence]
            };
          }
        } else {
          const warning: AnalysisWarning = {
            code: "PARTIAL_SHAPE",
            message: `Unsupported request body expression in fetch options: ${valNode.text()}`,
            source: bodySpan,
            analyzerId: "analyzer-js-ts",
            affectsCompleteness: false,
            scope: "consumer",
            targetDimension: "request-shape"
          };
          warnings.push(warning);

          const evidence: EvidenceRef = {
            id: `ev-body-${valNode.range.start}`,
            kind: "literal-syntax",
            strength: "inferred",
            source: bodySpan,
            description: "Unsupported request body expression"
          };

          bodyShape = {
            shape: {
              kind: "unknown",
              reason: "unsupported-syntax"
            },
            completeness: "partial",
            evidence: [evidence]
          };
        }
      }
    }
  }

  // If method property was not present in options object, default to GET
  if (!methodValue) {
    const evidence: EvidenceRef = {
      id: `ev-method-${optionsSpan.range.start}`,
      kind: "framework-convention",
      strength: "direct",
      source: optionsSpan,
      description: "Default GET method for fetch options without method key"
    };

    methodValue = {
      state: "known",
      value: "GET",
      strength: "direct",
      evidence: [evidence]
    };
  }

  const request: RequestShapeObservation | undefined = bodyShape ? { body: bodyShape } : undefined;

  return { method: methodValue, request };
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
 * Result of fetch extraction containing extracted API observations and any analysis warnings.
 */
export interface FetchExtractionResult {
  observations: ApiObservation[];
  warnings: AnalysisWarning[];
}

/**
 * Extracts standard fetch() observations from a parsed JavaScript or TypeScript document.
 * Follows LLD Section 7.2 extraction rules and emits structured ApiObservation instances.
 */
export function extractFetchObservations(
  document: SourceDocument,
  parsed: ParsedDocument,
  signal?: AbortSignal,
  resolver?: LocalReferenceResolver
): FetchExtractionResult {
  const observations: ApiObservation[] = [];
  const warnings: AnalysisWarning[] = [];
  const mapper = new PositionMapper(document.text, document.uri);

  walkTree(parsed.root, (node) => {
    signal?.throwIfAborted();

    if (!isFetchCall(node)) {
      return;
    }

    const callSpan = mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, document.uri);

    const argsNode = node.childForField("arguments");
    const args = argsNode ? argsNode.namedChildren() : [];

    // Zero arguments: fetch()
    if (args.length === 0) {
      warnings.push({
        code: "UNSUPPORTED_PATTERN",
        message: "fetch() call without required URL argument cannot be analyzed",
        source: callSpan,
        analyzerId: "analyzer-js-ts",
        affectsCompleteness: true,
        scope: "consumer",
        targetDimension: "route"
      });
      return;
    }

    const localWarnings: AnalysisWarning[] = [];

    // 1. Extract URL path
    const pathResult = extractPath(
      args[0],
      document.uri,
      mapper,
      localWarnings,
      resolver,
      parsed.root
    );
    const { routeValue: path, helperResolution } = pathResult;

    // 2. Extract options (method, request body)
    const optionsNode = args.length > 1 ? args[1] : undefined;
    const { method, request } = extractOptions(
      optionsNode,
      callSpan,
      document.uri,
      mapper,
      localWarnings,
      resolver,
      parsed,
      document
    );

    // Collect local warnings to document warnings
    warnings.push(...localWarnings);

    // Phase 6.3 Task 3: If helper resolution resolved one or more static callsites:
    if (helperResolution && helperResolution.status === "resolved") {
      for (const resRoute of helperResolution.resolvedRoutes) {
        const observationId: ObservationId = `obs:${document.uri}:${resRoute.callNode.range.start}-${resRoute.callNode.range.end}`;
        const observation: ApiObservation = {
          id: observationId,
          role: "consumer",
          languageId: document.languageId,
          framework: "fetch",
          extractorId: "fetch-extractor",
          source: [resRoute.callSpan, callSpan],
          snapshot: {
            uri: document.uri,
            contentHash: document.contentHash
          },
          endpoint: {
            method,
            path: resRoute.routeValue,
            request,
            responses: []
          },
          limitations: localWarnings
        };
        observations.push(observation);
      }
      return;
    }

    if (helperResolution && helperResolution.status === "mixed") {
      for (const resRoute of helperResolution.resolvedRoutes) {
        const observationId: ObservationId = `obs:${document.uri}:${resRoute.callNode.range.start}-${resRoute.callNode.range.end}`;
        const observation: ApiObservation = {
          id: observationId,
          role: "consumer",
          languageId: document.languageId,
          framework: "fetch",
          extractorId: "fetch-extractor",
          source: [resRoute.callSpan, callSpan],
          snapshot: {
            uri: document.uri,
            contentHash: document.contentHash
          },
          endpoint: {
            method,
            path: resRoute.routeValue,
            request,
            responses: []
          },
          limitations: localWarnings
        };
        observations.push(observation);
      }

      for (const dynRoute of helperResolution.dynamicRoutes) {
        const dynCallSpan = dynRoute.callSpan ?? callSpan;
        const dynId: ObservationId = dynRoute.callNode
          ? `obs:${document.uri}:${dynRoute.callNode.range.start}-${dynRoute.callNode.range.end}`
          : `obs:${document.uri}:${node.range.start}-${node.range.end}`;
        const dynObs: ApiObservation = {
          id: dynId,
          role: "consumer",
          languageId: document.languageId,
          framework: "fetch",
          extractorId: "fetch-extractor",
          source: [dynCallSpan, callSpan],
          snapshot: {
            uri: document.uri,
            contentHash: document.contentHash
          },
          endpoint: {
            method,
            path: dynRoute.routeValue,
            request,
            responses: []
          },
          limitations: [...localWarnings, dynRoute.warning]
        };
        observations.push(dynObs);
        warnings.push(dynRoute.warning);
      }
      return;
    }

    // 3. Build standard ApiObservation
    const observationId: ObservationId = `obs:${document.uri}:${node.range.start}-${node.range.end}`;

    const observation: ApiObservation = {
      id: observationId,
      role: "consumer",
      languageId: document.languageId,
      framework: "fetch",
      extractorId: "fetch-extractor",
      source: [callSpan],
      snapshot: {
        uri: document.uri,
        contentHash: document.contentHash
      },
      endpoint: {
        method,
        path,
        request,
        responses: []
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
export class FetchExtractor {
  constructor(private readonly resolver?: LocalReferenceResolver) {}

  extract(
    document: SourceDocument,
    parsed: ParsedDocument,
    signal?: AbortSignal,
    resolver?: LocalReferenceResolver
  ): FetchExtractionResult {
    return extractFetchObservations(document, parsed, signal, resolver ?? this.resolver);
  }
}
