// Template URL parser extracting static, parameterized, and dynamic route patterns
// from template literal expressions in JavaScript and TypeScript client calls (Axios and fetch).
// Conforms strictly to Phase 6 Section 5 requirements.

import type {
  AnalysisWarning,
  DocumentUri,
  EvidenceRef,
  ObservedValue,
  RoutePattern,
  RouteSegment,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import type { LocalReferenceResolver } from "../project-index/local-reference-resolver";
import type { LocalVariableDeclaration } from "../project-index/local-declaration-index";

export interface TemplateRouteExtraction {
  readonly routeValue: ObservedValue<RoutePattern>;
  readonly warning?: AnalysisWarning;
}

/**
 * Parses raw path string into structural RoutePattern.
 */
function parseRawPathToPattern(rawPath: string): RoutePattern {
  const queryIndex = rawPath.indexOf("?");
  const pathPart = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath;
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
    rawPath: pathPart.startsWith("/") ? pathPart : "/" + pathPart
  };
}

/**
 * Analyzes a template_string syntax node and extracts a RoutePattern if the pathname
 * is static, uses base URL interpolation, or uses single-segment parameter interpolations.
 */
export function extractTemplateRoute(
  argNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  frameworkName: "Axios" | "fetch",
  resolver?: LocalReferenceResolver
): TemplateRouteExtraction {
  const argSpan = mapper.toSourceSpanFromUtf16(argNode.range.start, argNode.range.end, documentUri);
  const rawText = argNode.text();

  // Find all template_substitution child nodes
  const substitutions = argNode
    .namedChildren()
    .filter((child) => child.kind === "template_substitution");

  // 1. Static template literal without substitutions e.g. `/api/users`
  if (substitutions.length === 0) {
    const unquoted = rawText.slice(1, -1);
    const routePattern = parseRawPathToPattern(unquoted);

    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: argSpan,
      description: `Static template URL literal '${routePattern.rawPath}' in ${frameworkName} call`
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

  // 2. Locate the first query '?' in literal text outside of substitutions
  let queryOffset = -1;
  for (let i = 1; i < rawText.length - 1; i++) {
    const absPos = argNode.range.start + i;
    const isInsideSub = substitutions.some(
      (sub) => absPos >= sub.range.start && absPos < sub.range.end
    );
    if (!isInsideSub && rawText[i] === "?") {
      queryOffset = i;
      break;
    }
  }

  // 2b. If no literal '?' found, check if a trailing substitution builds query parameters
  // e.g. `${buildQueryString(params)}` or trailing query generator
  let trailingQueryBuilderFound = false;
  if (queryOffset === -1 && substitutions.length > 0) {
    const lastSub = substitutions[substitutions.length - 1];
    const textAfter = rawText.slice(lastSub.range.end - argNode.range.start, -1);
    if (!textAfter.includes("/")) {
      const subExpr = lastSub.childForField("expression") ?? lastSub.namedChildren()[0];
      const exprText = subExpr?.text() ?? "";
      const textBefore = rawText.slice(0, lastSub.range.start - argNode.range.start);

      const isQueryBuilder =
        /(?:query|search|param|qs)/i.test(exprText) ||
        textBefore.endsWith("?") ||
        textBefore.endsWith("&");

      if (isQueryBuilder) {
        queryOffset = lastSub.range.start - argNode.range.start;
        trailingQueryBuilderFound = true;
      }
    }
  }

  const pathEndOffset = queryOffset >= 0 ? queryOffset : rawText.length - 1;
  let pathRawText = rawText.slice(1, pathEndOffset);

  // 2c. Inspect if the template starts with a base URL interpolation e.g. `${API_BASE_URL}/api/...`
  let baseSub: SyntaxNode | undefined;
  let baseUrlPrefix = "";

  if (substitutions.length > 0 && substitutions[0].range.start === argNode.range.start + 1) {
    const firstSub = substitutions[0];
    const exprNode = firstSub.childForField("expression") ?? firstSub.namedChildren()[0];
    const exprText = exprNode?.text() ?? "";

    const isBaseUrlIdent =
      /(?:base_?url|api_?url|server_?url|backend_?url|host|origin)/i.test(exprText) ||
      exprText.startsWith("process.env.") ||
      exprText.startsWith("import.meta.env.");

    if (isBaseUrlIdent) {
      baseSub = firstSub;

      // Attempt constant resolution if resolver available
      if (resolver && exprNode?.kind === "identifier") {
        const res = resolver.resolveConstant<string>(exprText, documentUri, exprNode.range);
        if (res.state === "resolved" && typeof res.value === "string") {
          try {
            if (res.value.startsWith("http://") || res.value.startsWith("https://")) {
              const parsedUrl = new URL(res.value);
              baseUrlPrefix = parsedUrl.pathname.replace(/\/+$/, "");
            } else {
              baseUrlPrefix = res.value.replace(/\/+$/, "");
            }
          } catch {
            baseUrlPrefix = res.value.replace(/\/+$/, "");
          }
        } else {
          // If not statically fully resolved (e.g. dynamic port or host interpolation like `http://localhost:${PORT}/api`),
          // recover the static pathname prefix from the declaration initializer
          let initText: string | undefined;
          const decl = "declaration" in res ? res.declaration : undefined;
          if (decl && decl.kind === "variable") {
            initText = (decl as LocalVariableDeclaration).initializerText?.trim();
          } else {
            const localCandidates = resolver.index
              .lookupSymbols(exprText, documentUri)
              .filter((c) => c.documentUri === documentUri && c.kind === "variable");
            if (localCandidates.length === 1) {
              initText = (localCandidates[0] as LocalVariableDeclaration).initializerText?.trim();
            }
          }

          if (initText) {
            // Check for scheme and authority followed by static path e.g. `http://localhost:${PORT}/api`
            const urlPathMatch = initText.match(
              /(?:https?:)?\/\/[^/`'"]*\/([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)/
            );
            if (urlPathMatch && urlPathMatch[1]) {
              baseUrlPrefix = "/" + urlPathMatch[1];
            } else {
              // Check for static relative path e.g. '/api' or "/api/v1"
              const relPathMatch = initText.match(
                /(?:^|['"`])(\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)['"`]/
              );
              if (relPathMatch && relPathMatch[1]) {
                baseUrlPrefix = relPathMatch[1];
              }
            }
          }
        }
      }

      // Cut the base URL substitution out of pathRawText
      const subEndRel = firstSub.range.end - argNode.range.start - 1;
      pathRawText = pathRawText.slice(subEndRel);

      if (baseUrlPrefix && baseUrlPrefix !== "/" && !pathRawText.startsWith(baseUrlPrefix)) {
        pathRawText =
          baseUrlPrefix + (pathRawText.startsWith("/") ? pathRawText : "/" + pathRawText);
      }
    }
  }

  // 3. Find substitutions that occur in the path portion (excluding baseSub and trailing query builder)
  const pathSubstitutions = substitutions.filter((sub) => {
    if (baseSub && sub.range.start === baseSub.range.start) return false;
    return sub.range.start < argNode.range.start + pathEndOffset;
  });

  // If NO substitutions exist in the path portion, the pathname is completely static!
  // e.g. `/api/posts?page=${page}&limit=10` or `${API_BASE_URL}/api/transactions${buildQueryString(params)}`
  if (pathSubstitutions.length === 0) {
    const routePattern = parseRawPathToPattern(pathRawText);
    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: baseSub ? "inferred" : "direct",
      source: argSpan,
      description: baseSub
        ? `Static template URL literal '${routePattern.rawPath}' with base URL interpolation in ${frameworkName} call`
        : `Static URL literal '${routePattern.rawPath}' with dynamic query parameters in ${frameworkName} call`
    };

    return {
      routeValue: {
        state: "known",
        value: routePattern,
        strength: baseSub ? "inferred" : "direct",
        evidence: [evidence]
      }
    };
  }

  // 4. Inspect substitutions in the path portion segment-by-segment
  // Check if every path substitution occupies a complete segment and is an identifier
  const rawSegments = pathRawText.split("/").filter((s) => s.length > 0);
  const segments: RouteSegment[] = [];
  let isDynamicAmbiguous = false;
  let dynamicReason = "";

  for (const segText of rawSegments) {
    if (!segText.includes("${")) {
      // Pure static segment
      if (segText.startsWith(":") && segText.length > 1) {
        segments.push({ kind: "parameter", name: segText.slice(1) });
      } else if (segText === "*") {
        segments.push({ kind: "wildcard" });
      } else {
        segments.push({ kind: "static", value: segText });
      }
      continue;
    }

    // Segment contains substitution: must be an exact complete substitution `${...}`
    if (!segText.startsWith("${") || !segText.endsWith("}")) {
      isDynamicAmbiguous = true;
      dynamicReason = `Partial segment template interpolation '${segText}' cannot be safely normalized`;
      break;
    }

    // Find the corresponding template_substitution node
    const matchingSub = pathSubstitutions.find((sub) => sub.text() === segText);
    if (!matchingSub) {
      isDynamicAmbiguous = true;
      dynamicReason = `Unmatched substitution for segment '${segText}'`;
      break;
    }

    const exprNode = matchingSub.childForField("expression") ?? matchingSub.namedChildren()[0];
    if (!exprNode) {
      isDynamicAmbiguous = true;
      dynamicReason = `Empty substitution for segment '${segText}'`;
      break;
    }

    // If the expression is an identifier, check if it can be resolved or treated as parameter
    if (exprNode.kind === "identifier") {
      const identName = exprNode.text();

      // Check if constant resolver can resolve it to a static string
      if (resolver) {
        const res = resolver.resolveConstant<string>(identName, documentUri, exprNode.range);
        if (res.state === "resolved" && typeof res.value === "string") {
          if (!res.value.includes("/")) {
            segments.push({ kind: "static", value: res.value });
            continue;
          }
        }
      }

      // Conservative parameter segment representation
      segments.push({ kind: "parameter", name: identName });
      continue;
    }

    // Non-identifier expression (function call, binary expression, ternary, etc.)
    isDynamicAmbiguous = true;
    dynamicReason = `Dynamic expression '${exprNode.text()}' in template string URL might represent multiple path segments`;
    break;
  }

  if (isDynamicAmbiguous) {
    const warning: AnalysisWarning = {
      code: "DYNAMIC_ROUTE",
      message: `Dynamic template string in ${frameworkName} URL cannot be statically resolved: ${rawText}`,
      source: argSpan,
      analyzerId: "analyzer-js-ts",
      scope: "consumer",
      targetDimension: "route",
      affectsCompleteness: true
    };

    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "inferred",
      source: argSpan,
      description: `Dynamic template string URL expression in ${frameworkName} call`
    };

    return {
      routeValue: {
        state: "dynamic",
        expression: rawText,
        reason: dynamicReason || "Dynamic template string URL interpolation",
        evidence: [evidence]
      },
      warning
    };
  }

  // Successfully extracted parameterized RoutePattern!
  const trailingSlash = pathRawText.length > 1 && pathRawText.endsWith("/") ? "present" : "absent";
  const rawPath =
    "/" +
    segments
      .map((s) =>
        s.kind === "parameter"
          ? `:${s.name}`
          : s.kind === "wildcard"
            ? "*"
            : s.kind === "static"
              ? s.value
              : s.sourceText
      )
      .join("/");

  const routePattern: RoutePattern = {
    segments,
    trailingSlash,
    queryHandling: "excluded-from-path",
    rawPath
  };

  const evidence: EvidenceRef = {
    id: `ev-path-${argNode.range.start}`,
    kind: "literal-syntax",
    strength: "inferred",
    source: argSpan,
    description: `Parameterized template string URL '${routePattern.rawPath}' in ${frameworkName} call`
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
