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
import type { LocalReferenceResolver } from "../project-index/local-reference-resolver";

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

/**
 * Extracts the URL path ObservedValue from the first argument of fetch().
 */
function extractPath(
  argNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[],
  resolver?: LocalReferenceResolver
): ObservedValue<RoutePattern> {
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
        description: `Static template URL literal '${routePattern.rawPath}' in fetch call`
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
      message: `Dynamic template string in fetch URL cannot be statically resolved: ${argNode.text()}`,
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
      description: `Dynamic template string URL expression in fetch call`
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
    message: `Dynamic URL expression in fetch call cannot be statically resolved: ${argNode.text()}`,
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
    description: `Dynamic URL expression in fetch call`
  };

  return {
    state: "dynamic",
    expression: argNode.text(),
    reason: "Dynamic URL expression",
    evidence: [evidence]
  };
}

/**
 * Extracts properties from an object literal syntax node into FieldShape array.
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
 * Extracts HTTP method and request shape options from the second argument of fetch().
 */
function extractOptions(
  optionsNode: SyntaxNode | undefined,
  callSpan: SourceSpan,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  warnings: AnalysisWarning[]
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
    const warning: AnalysisWarning = {
      code: "UNSUPPORTED_PATTERN",
      message: `Non-object options argument in fetch call cannot be statically resolved: ${optionsNode.text()}`,
      source: optionsSpan,
      analyzerId: "analyzer-js-ts",
      affectsCompleteness: true
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
          const evidence: EvidenceRef = {
            id: `ev-method-${child.range.start}`,
            kind: "literal-syntax",
            strength: "direct",
            source: propSpan,
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
            affectsCompleteness: true
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
          affectsCompleteness: true
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
            const properties = extractObjectFields(jsonArgs[0], documentUri, mapper);

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
          } else {
            const warning: AnalysisWarning = {
              code: "PARTIAL_SHAPE",
              message: `Non-literal payload in JSON.stringify body cannot be statically resolved: ${valNode.text()}`,
              source: bodySpan,
              analyzerId: "analyzer-js-ts",
              affectsCompleteness: true
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
            affectsCompleteness: true
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
        const warning: AnalysisWarning = {
          code: "UNSUPPORTED_PATTERN",
          message: `Unsupported request body expression in fetch options: ${valNode.text()}`,
          source: bodySpan,
          analyzerId: "analyzer-js-ts",
          affectsCompleteness: true
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
        affectsCompleteness: true
      });
      return;
    }

    const localWarnings: AnalysisWarning[] = [];

    // 1. Extract URL path
    const path = extractPath(args[0], document.uri, mapper, localWarnings, resolver);

    // 2. Extract options (method, request body)
    const optionsNode = args.length > 1 ? args[1] : undefined;
    const { method, request } = extractOptions(
      optionsNode,
      callSpan,
      document.uri,
      mapper,
      localWarnings
    );

    // Collect local warnings to document warnings
    warnings.push(...localWarnings);

    // 3. Build ApiObservation
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
