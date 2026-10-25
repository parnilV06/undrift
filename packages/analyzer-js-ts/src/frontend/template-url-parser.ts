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
    rawPath: pathPart
  };
}

/**
 * Analyzes a template_string syntax node and extracts a RoutePattern if the pathname
 * is static or uses single-segment parameter interpolations.
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

  const pathEndOffset = queryOffset >= 0 ? queryOffset : rawText.length - 1;
  const pathRawText = rawText.slice(1, pathEndOffset);

  // 3. Find substitutions that occur in the path portion (before '?')
  const pathSubstitutions = substitutions.filter(
    (sub) => sub.range.start < argNode.range.start + pathEndOffset
  );

  // If NO substitutions exist in the path portion, the pathname is completely static!
  // e.g. `/api/posts?page=${page}&limit=10`
  if (pathSubstitutions.length === 0) {
    const routePattern = parseRawPathToPattern(pathRawText);
    const evidence: EvidenceRef = {
      id: `ev-path-${argNode.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: argSpan,
      description: `Static URL literal '${routePattern.rawPath}' with dynamic query parameters in ${frameworkName} call`
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
