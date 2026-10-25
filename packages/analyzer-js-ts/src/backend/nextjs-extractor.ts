// Next.js API route provider extractor as specified in Phase 6 Section 7.
// Extracts server-side API observations from Next.js App Router (app/api/**/route.ts)
// and supported Pages Router (pages/api/**) patterns.

import type {
  AnalysisWarning,
  ApiObservation,
  DocumentUri,
  EvidenceRef,
  HttpMethod,
  ObservationId,
  ParsedDocument,
  RoutePattern,
  RouteSegment,
  SourceDocument,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";

const VALID_HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
]);

export interface NextJsRouteInfo {
  readonly routerKind: "app" | "pages";
  readonly routePattern: RoutePattern;
}

/**
 * Normalizes and analyzes a document URI to determine if it is a Next.js App Router
 * or Pages Router API route file, deriving its structural RoutePattern from the file hierarchy.
 */
export function deriveNextJsRouteInfo(documentUri: DocumentUri): NextJsRouteInfo | undefined {
  const normalizedUri = documentUri.replace(/\\/g, "/");

  // 1. App Router route handlers: (src/)?app/api/.../route.(ts|js|tsx|jsx)
  // or (src/)?app/api/route.(ts|js|tsx|jsx)
  const appMatch = normalizedUri.match(/(?:^|\/)(?:src\/)?app\/api(?:\/(.+?))?\/route\.[jt]sx?$/i);
  if (appMatch) {
    const subPath = appMatch[1]; // e.g. "users" or "users/[id]" or "(auth)/login" or undefined
    const segments: RouteSegment[] = [{ kind: "static", value: "api" }];

    if (subPath) {
      const rawParts = subPath.split("/").filter((p) => p.length > 0);
      for (const part of rawParts) {
        // Strip route groups e.g. (auth), (group)
        if (part.startsWith("(") && part.endsWith(")")) {
          continue;
        }

        // Catch-all segments e.g. [...slug] or [[...slug]]
        if (
          (part.startsWith("[...") && part.endsWith("]")) ||
          (part.startsWith("[[...") && part.endsWith("]]"))
        ) {
          segments.push({ kind: "wildcard" });
          continue;
        }

        // Dynamic parameter segments e.g. [id] or [userId]
        if (part.startsWith("[") && part.endsWith("]")) {
          const paramName = part.slice(1, -1);
          segments.push({ kind: "parameter", name: paramName });
          continue;
        }

        // Static segment
        segments.push({ kind: "static", value: part });
      }
    }

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

    return {
      routerKind: "app",
      routePattern: {
        segments,
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        rawPath
      }
    };
  }

  // 2. Pages Router API routes: (src/)?pages/api/...
  const pagesMatch = normalizedUri.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+?)\.[jt]sx?$/i);
  if (pagesMatch) {
    let subPath = pagesMatch[1]; // e.g. "users" or "posts/[id]" or "index" or "users/index"
    if (subPath === "index") {
      subPath = "";
    } else if (subPath.endsWith("/index")) {
      subPath = subPath.slice(0, -"/index".length);
    }

    const segments: RouteSegment[] = [{ kind: "static", value: "api" }];

    if (subPath.length > 0) {
      const rawParts = subPath.split("/").filter((p) => p.length > 0);
      for (const part of rawParts) {
        // Catch-all segments e.g. [...slug]
        if (
          (part.startsWith("[...") && part.endsWith("]")) ||
          (part.startsWith("[[...") && part.endsWith("]]"))
        ) {
          segments.push({ kind: "wildcard" });
          continue;
        }

        // Dynamic parameter segments e.g. [id]
        if (part.startsWith("[") && part.endsWith("]")) {
          const paramName = part.slice(1, -1);
          segments.push({ kind: "parameter", name: paramName });
          continue;
        }

        segments.push({ kind: "static", value: part });
      }
    }

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

    return {
      routerKind: "pages",
      routePattern: {
        segments,
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        rawPath
      }
    };
  }

  return undefined;
}

/**
 * Result of Next.js route extraction.
 */
export interface NextJsExtractionResult {
  observations: ApiObservation[];
  warnings: AnalysisWarning[];
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
 * Extracts method names from App Router named export statements.
 */
function extractAppRouterMethods(
  parsed: ParsedDocument,
  mapper: PositionMapper,
  documentUri: DocumentUri
): Array<{ method: HttpMethod; span: SourceSpan }> {
  const result: Array<{ method: HttpMethod; span: SourceSpan }> = [];

  for (const topNode of parsed.root.namedChildren()) {
    if (topNode.kind !== "export_statement") {
      continue;
    }

    // Pattern 1: `export async function GET(request) { ... }`
    const decl = topNode.childForField("declaration") ?? topNode.namedChildren()[0];
    if (
      decl &&
      (decl.kind === "function_declaration" || decl.kind === "generator_function_declaration")
    ) {
      const nameNode = decl.childForField("name");
      if (nameNode) {
        const nameUpper = nameNode.text().toUpperCase();
        if (VALID_HTTP_METHODS.has(nameUpper)) {
          const span = mapper.toSourceSpanFromUtf16(
            topNode.range.start,
            topNode.range.end,
            documentUri
          );
          result.push({ method: nameUpper as HttpMethod, span });
        }
      }
      continue;
    }

    // Pattern 2: `export const GET = ...`
    if (decl && (decl.kind === "lexical_declaration" || decl.kind === "variable_declaration")) {
      for (const declarator of decl.namedChildren()) {
        if (declarator.kind === "variable_declarator") {
          const nameNode = declarator.childForField("name") ?? declarator.namedChildren()[0];
          if (nameNode && nameNode.kind === "identifier") {
            const nameUpper = nameNode.text().toUpperCase();
            if (VALID_HTTP_METHODS.has(nameUpper)) {
              const span = mapper.toSourceSpanFromUtf16(
                topNode.range.start,
                topNode.range.end,
                documentUri
              );
              result.push({ method: nameUpper as HttpMethod, span });
            }
          }
        }
      }
      continue;
    }

    // Pattern 3: `export { GET, POST }`
    for (const child of topNode.namedChildren()) {
      if (child.kind === "export_clause") {
        for (const spec of child.namedChildren()) {
          if (spec.kind === "export_specifier") {
            const nameNode = spec.childForField("name") ?? spec.namedChildren()[0];
            if (nameNode) {
              const nameUpper = nameNode.text().toUpperCase();
              if (VALID_HTTP_METHODS.has(nameUpper)) {
                const span = mapper.toSourceSpanFromUtf16(
                  spec.range.start,
                  spec.range.end,
                  documentUri
                );
                result.push({ method: nameUpper as HttpMethod, span });
              }
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * Checks if an expression node accesses `.method` property (e.g. `req.method`).
 */
function isMethodMemberExpression(node: SyntaxNode): boolean {
  if (node.kind === "member_expression") {
    const prop = node.childForField("property") ?? node.namedChildren()[1];
    return prop?.text() === "method";
  }
  return false;
}

/**
 * Extracts method names from Pages Router default handler function.
 */
function extractPagesRouterMethods(
  parsed: ParsedDocument,
  mapper: PositionMapper,
  documentUri: DocumentUri,
  warnings: AnalysisWarning[]
): Array<{ method: HttpMethod; span: SourceSpan }> {
  const result: Array<{ method: HttpMethod; span: SourceSpan }> = [];
  const seenMethods = new Set<HttpMethod>();

  // Find default export statement
  let defaultExportNode: SyntaxNode | undefined;
  for (const topNode of parsed.root.namedChildren()) {
    if (topNode.kind === "export_statement") {
      const isDefault = topNode.children().some((c) => c.text() === "default");
      if (isDefault) {
        defaultExportNode = topNode;
        break;
      }
    }
  }

  if (!defaultExportNode) {
    warnings.push({
      code: "UNSUPPORTED_PATTERN",
      message: `Pages Router API file '${documentUri}' has no default export handler`,
      source: mapper.toSourceSpanFromUtf16(0, Math.min(100, parsed.root.range.end), documentUri),
      analyzerId: "analyzer-js-ts",
      scope: "provider",
      targetDimension: "method",
      affectsCompleteness: true
    });
    return [];
  }

  function unwrapParentheses(node: SyntaxNode): SyntaxNode {
    let curr = node;
    while (curr.kind === "parenthesized_expression") {
      const inner = curr.namedChildren()[0];
      if (!inner) break;
      curr = inner;
    }
    return curr;
  }

  // Traverse handler to find `switch (req.method)` and `if (req.method === '...')`
  walkTree(defaultExportNode, (node) => {
    // 1. switch (req.method)
    if (node.kind === "switch_statement") {
      const rawVal = node.childForField("value") ?? node.namedChildren()[0];
      const valueNode = rawVal ? unwrapParentheses(rawVal) : undefined;
      if (valueNode && isMethodMemberExpression(valueNode)) {
        for (const child of node.namedChildren()) {
          const caseList = child.kind === "switch_body" ? child.namedChildren() : [child];
          for (const caseNode of caseList) {
            if (caseNode.kind === "switch_case") {
              const valChild = caseNode.childForField("value") ?? caseNode.namedChildren()[0];
              if (valChild && valChild.kind === "string") {
                const methodUpper = valChild.text().slice(1, -1).toUpperCase();
                if (VALID_HTTP_METHODS.has(methodUpper)) {
                  const m = methodUpper as HttpMethod;
                  if (!seenMethods.has(m)) {
                    seenMethods.add(m);
                    const span = mapper.toSourceSpanFromUtf16(
                      caseNode.range.start,
                      caseNode.range.end,
                      documentUri
                    );
                    result.push({ method: m, span });
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. if (req.method === '...') or if ('...' === req.method)
    if (node.kind === "if_statement") {
      const rawCond = node.childForField("condition") ?? node.namedChildren()[0];
      const condNode = rawCond ? unwrapParentheses(rawCond) : undefined;
      if (condNode && condNode.kind === "binary_expression") {
        const opNode = condNode.children().find((c) => c.text() === "===" || c.text() === "==");
        if (opNode) {
          const left = condNode.childForField("left") ?? condNode.namedChildren()[0];
          const right = condNode.childForField("right") ?? condNode.namedChildren()[1];

          let methodString: string | undefined;
          if (left && isMethodMemberExpression(left) && right && right.kind === "string") {
            methodString = right.text().slice(1, -1);
          } else if (right && isMethodMemberExpression(right) && left && left.kind === "string") {
            methodString = left.text().slice(1, -1);
          }

          if (methodString) {
            const methodUpper = methodString.toUpperCase();
            if (VALID_HTTP_METHODS.has(methodUpper)) {
              const m = methodUpper as HttpMethod;
              if (!seenMethods.has(m)) {
                seenMethods.add(m);
                const span = mapper.toSourceSpanFromUtf16(
                  condNode.range.start,
                  condNode.range.end,
                  documentUri
                );
                result.push({ method: m, span });
              }
            }
          }
        }
      }
    }
  });

  // If no method dispatch was statically found, report limitation honestly
  if (result.length === 0) {
    const handlerSpan = mapper.toSourceSpanFromUtf16(
      defaultExportNode.range.start,
      defaultExportNode.range.end,
      documentUri
    );
    warnings.push({
      code: "UNSUPPORTED_PATTERN",
      message: `Pages Router API handler does not use statically identifiable req.method dispatch: ${documentUri}`,
      source: handlerSpan,
      analyzerId: "analyzer-js-ts",
      scope: "provider",
      targetDimension: "method",
      affectsCompleteness: true
    });
  }

  return result;
}

/**
 * Extracts Next.js API route observations from a parsed JavaScript or TypeScript document.
 */
export function extractNextJsObservations(
  document: SourceDocument,
  parsed: ParsedDocument,
  signal?: AbortSignal
): NextJsExtractionResult {
  const routeInfo = deriveNextJsRouteInfo(document.uri);
  if (!routeInfo) {
    return { observations: [], warnings: [] };
  }

  signal?.throwIfAborted();

  const observations: ApiObservation[] = [];
  const warnings: AnalysisWarning[] = [];
  const mapper = new PositionMapper(document.text, document.uri);

  if (routeInfo.routerKind === "app") {
    // App Router: named HTTP method exports
    const methods = extractAppRouterMethods(parsed, mapper, document.uri);

    if (methods.length === 0) {
      warnings.push({
        code: "UNSUPPORTED_PATTERN",
        message: `App Router route handler has no statically identifiable HTTP method exports (GET, POST, etc.): ${document.uri}`,
        source: mapper.toSourceSpanFromUtf16(0, Math.min(100, document.text.length), document.uri),
        analyzerId: "analyzer-js-ts",
        scope: "provider",
        targetDimension: "method",
        affectsCompleteness: true
      });
    }

    for (const { method, span } of methods) {
      const observationId: ObservationId = `obs:${document.uri}:${span.range.start}-${span.range.end}`;

      const methodEvidence: EvidenceRef = {
        id: `ev-method-${span.range.start}`,
        kind: "framework-convention",
        strength: "direct",
        source: span,
        description: `Named HTTP method export '${method}' in Next.js App Router route handler`
      };

      const pathEvidence: EvidenceRef = {
        id: `ev-path-${span.range.start}`,
        kind: "framework-convention",
        strength: "direct",
        source: span,
        description: `Route path '${routeInfo.routePattern.rawPath}' derived from App Router file hierarchy`
      };

      const observation: ApiObservation = {
        id: observationId,
        role: "provider",
        languageId: document.languageId,
        framework: "nextjs",
        extractorId: "nextjs-extractor",
        source: [span],
        snapshot: {
          uri: document.uri,
          contentHash: document.contentHash
        },
        endpoint: {
          method: {
            state: "known",
            value: method,
            strength: "direct",
            evidence: [methodEvidence]
          },
          path: {
            state: "known",
            value: routeInfo.routePattern,
            strength: "direct",
            evidence: [pathEvidence]
          },
          responses: [
            {
              statusCode: {
                state: "known",
                value: 200,
                strength: "direct",
                evidence: [
                  {
                    id: `ev-resp-${span.range.start}`,
                    kind: "framework-convention",
                    strength: "direct",
                    source: span,
                    description: "Default Next.js HTTP 200 response"
                  }
                ]
              },
              source: [span]
            }
          ]
        },
        limitations: []
      };

      observations.push(observation);
    }
  } else {
    // Pages Router: switch(req.method) or if(req.method === '...')
    const methods = extractPagesRouterMethods(parsed, mapper, document.uri, warnings);

    for (const { method, span } of methods) {
      const observationId: ObservationId = `obs:${document.uri}:${span.range.start}-${span.range.end}`;

      const methodEvidence: EvidenceRef = {
        id: `ev-method-${span.range.start}`,
        kind: "literal-syntax",
        strength: "inferred",
        source: span,
        description: `Method condition '${method}' in Next.js Pages Router API handler`
      };

      const pathEvidence: EvidenceRef = {
        id: `ev-path-${span.range.start}`,
        kind: "framework-convention",
        strength: "direct",
        source: span,
        description: `Route path '${routeInfo.routePattern.rawPath}' derived from Pages Router file hierarchy`
      };

      const observation: ApiObservation = {
        id: observationId,
        role: "provider",
        languageId: document.languageId,
        framework: "nextjs",
        extractorId: "nextjs-extractor",
        source: [span],
        snapshot: {
          uri: document.uri,
          contentHash: document.contentHash
        },
        endpoint: {
          method: {
            state: "known",
            value: method,
            strength: "inferred",
            evidence: [methodEvidence]
          },
          path: {
            state: "known",
            value: routeInfo.routePattern,
            strength: "direct",
            evidence: [pathEvidence]
          },
          responses: [
            {
              statusCode: {
                state: "known",
                value: 200,
                strength: "direct",
                evidence: [
                  {
                    id: `ev-resp-${span.range.start}`,
                    kind: "framework-convention",
                    strength: "direct",
                    source: span,
                    description: "Default Next.js HTTP 200 response"
                  }
                ]
              },
              source: [span]
            }
          ]
        },
        limitations: []
      };

      observations.push(observation);
    }
  }

  return { observations, warnings };
}

/**
 * Extractor class conforming to extractor module architecture.
 */
export class NextJsExtractor {
  extract(
    document: SourceDocument,
    parsed: ParsedDocument,
    signal?: AbortSignal
  ): NextJsExtractionResult {
    return extractNextJsObservations(document, parsed, signal);
  }
}
