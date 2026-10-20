// Route normalization as specified in LLD.md Section 4.5 and Section 9.1.
// Converts supported route evidence and path strings into canonical RoutePattern representations,
// distinguishing static segments, parameters, wildcards, and unresolved expressions.

import type { RoutePattern, RouteSegment } from "../domain/observation";

/**
 * Options controlling route normalization behavior.
 */
export interface RouteNormalizationOptions {
  /**
   * Explicit trailing slash policy override.
   * If omitted, the observed trailing slash presence in the input is preserved.
   */
  readonly trailingSlash?: "present" | "absent";
}

/**
 * Type guard verifying if an unknown value satisfies the RoutePattern contract.
 */
export function isRoutePattern(value: unknown): value is RoutePattern {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.segments) &&
    typeof candidate.trailingSlash === "string" &&
    typeof candidate.queryHandling === "string" &&
    typeof candidate.rawPath === "string"
  );
}

/**
 * Parses an individual route segment string into a canonical RouteSegment.
 *
 * Distinguishes:
 * - Express-style parameters (`:id`, `:userId`)
 * - Brace-style parameters (`{id}`, `{userId}`)
 * - Wildcards (`*`, `*path`, `*splat`)
 * - Dynamic / unresolved template expressions (`${userId}`)
 * - Express optional parameters (`:id?`) -> preserved as unresolved
 * - Regex-constrained parameters (`:id(\\d+)`) -> preserved as unresolved
 * - Ordinary static path segments (`users`, `api`)
 */
export function parseRouteSegment(rawSegment: string): RouteSegment {
  const trimmed = rawSegment.trim();

  // 1. Unresolved / dynamic expressions (e.g., template placeholder ${id})
  if (trimmed.includes("${") && trimmed.includes("}")) {
    return {
      kind: "unresolved",
      sourceText: trimmed
    };
  }

  // 2. Wildcard segments: '*', '*name', or '*splat'
  if (trimmed === "*") {
    return { kind: "wildcard" };
  }
  if (trimmed.startsWith("*") && trimmed.length > 1) {
    return {
      kind: "wildcard",
      name: trimmed.slice(1)
    };
  }

  // 3. Express-style parameter segments: ':id', ':userId', ':id?', ':id(\\d+)'
  if (trimmed.startsWith(":")) {
    // 3a. Optional parameters (e.g. ':id?') cannot be modeled by RouteSegment without optionality loss;
    // preserve as unresolved to avoid treating as an ordinary required parameter
    if (trimmed.endsWith("?")) {
      return {
        kind: "unresolved",
        sourceText: trimmed
      };
    }

    // 3b. Regex-constrained parameters (e.g. ':id(\\d+)') are unsupported and must not be
    // stripped to unconstrained parameters; preserve as unresolved
    if (trimmed.includes("(") && trimmed.includes(")")) {
      return {
        kind: "unresolved",
        sourceText: trimmed
      };
    }

    const paramName = trimmed.slice(1).trim();
    return paramName.length > 0 ? { kind: "parameter", name: paramName } : { kind: "parameter" };
  }

  // 4. Brace-style parameter segments: '{id}', '{userId}'
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.endsWith("?") || inner.includes(":") || inner.includes("(")) {
      return {
        kind: "unresolved",
        sourceText: trimmed
      };
    }
    return inner.length > 0 ? { kind: "parameter", name: inner } : { kind: "parameter" };
  }

  // 5. Default static segment (including empty string "" for internal repeated slashes)
  return {
    kind: "static",
    value: trimmed
  };
}

/**
 * Normalizes a raw route path string or absolute URL into a canonical RoutePattern.
 *
 * Rules (LLD.md Section 9.1):
 * 1. Trims surrounding whitespace from literal path strings.
 * 2. Extracts pathnames from absolute URLs with URL parser; excludes query string and fragment.
 * 3. Excludes query strings from relative route paths when present.
 * 4. Normalizes path separators (replaces backslashes) and leading slashes without removing meaningful segments.
 * 5. Represents supported route parameter syntaxes (:id, {id}) as parameter segments.
 * 6. Preserves wildcard and unresolved segments explicitly.
 * 7. Records trailing slash policy explicitly ('present' | 'absent' | 'unknown').
 * 8. Preserves internal empty segments resulting from repeated slashes (e.g. /api//users).
 * 9. Never singularizes/pluralizes or renames segments by heuristic.
 *
 * @param rawPath Raw path string, absolute URL, or unknown input.
 * @param options Optional normalization options (e.g. trailing slash override).
 * @returns Canonical RoutePattern representation.
 */
export function normalizeRoute(
  rawPath: unknown,
  options?: RouteNormalizationOptions
): RoutePattern {
  // If already a valid RoutePattern, return a clean structural copy
  if (isRoutePattern(rawPath)) {
    return {
      segments: rawPath.segments.map((seg) => ({ ...seg })),
      trailingSlash: options?.trailingSlash ?? rawPath.trailingSlash,
      queryHandling: rawPath.queryHandling,
      rawPath: rawPath.rawPath
    };
  }

  // Handle missing input (null or undefined) as unresolved
  if (rawPath === undefined || rawPath === null) {
    return {
      segments: [{ kind: "unresolved", sourceText: "" }],
      trailingSlash: "unknown",
      queryHandling: "unknown",
      rawPath: ""
    };
  }

  // Handle other non-string input (e.g. number or unsupported object) as unresolved
  if (typeof rawPath !== "string") {
    const rawStr = String(rawPath);
    return {
      segments: [{ kind: "unresolved", sourceText: rawStr }],
      trailingSlash: "unknown",
      queryHandling: "unknown",
      rawPath: rawStr
    };
  }

  const trimmed = rawPath.trim();
  // Explicitly supplied empty string represents a known empty path
  if (trimmed === "") {
    return {
      segments: [],
      trailingSlash: options?.trailingSlash ?? "absent",
      queryHandling: "excluded-from-path",
      rawPath: ""
    };
  }

  let pathname = trimmed;
  let queryHandling: "excluded-from-path" | "unknown" = "excluded-from-path";

  // Check if rawPath is an absolute URL with scheme (e.g. http://, https://)
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (isAbsoluteUrl) {
    try {
      const parsedUrl = new URL(trimmed);
      pathname = parsedUrl.pathname;
      queryHandling = "excluded-from-path";
    } catch {
      // Malformed absolute URL syntax
      return {
        segments: [{ kind: "unresolved", sourceText: trimmed }],
        trailingSlash: "unknown",
        queryHandling: "unknown",
        rawPath: trimmed
      };
    }
  } else {
    // Relative path: exclude query string and fragment if present
    const hIdx = pathname.indexOf("#");
    let qIdx = pathname.indexOf("?");

    // Distinguish an Express optional parameter modifier (e.g. '/:id?' at end of segment)
    // from a real query string delimiter '?'
    if (qIdx !== -1) {
      const lastSlash = pathname.lastIndexOf("/", qIdx);
      const segmentBeforeQ = pathname.slice(lastSlash + 1, qIdx);
      const isParamModifier =
        segmentBeforeQ.startsWith(":") &&
        (qIdx === pathname.length - 1 || pathname[qIdx + 1] === "/");
      if (isParamModifier) {
        // Look for any subsequent '?' that is an actual query string delimiter
        qIdx = pathname.indexOf("?", qIdx + 1);
      }
    }

    let cutIdx = -1;
    if (qIdx !== -1 && hIdx !== -1) {
      cutIdx = Math.min(qIdx, hIdx);
    } else if (qIdx !== -1) {
      cutIdx = qIdx;
    } else if (hIdx !== -1) {
      cutIdx = hIdx;
    }

    if (cutIdx !== -1) {
      pathname = pathname.substring(0, cutIdx);
      queryHandling = "excluded-from-path";
    }
  }

  // Normalize path separators (replace backslashes with slashes, preserving regex escapes inside parentheses)
  let inParen = false;
  let normalizedSeparators = "";
  for (let i = 0; i < pathname.length; i++) {
    const char = pathname[i];
    if (char === "(") {
      inParen = true;
      normalizedSeparators += char;
    } else if (char === ")") {
      inParen = false;
      normalizedSeparators += char;
    } else if (char === "\\" && !inParen) {
      normalizedSeparators += "/";
    } else {
      normalizedSeparators += char;
    }
  }
  pathname = normalizedSeparators;

  // Determine trailing slash presence from the cleaned pathname before stripping slashes
  const hasTrailingSlash = pathname.length > 0 && pathname.endsWith("/");
  const trailingSlashState: "present" | "absent" =
    options?.trailingSlash ?? (hasTrailingSlash ? "present" : "absent");

  // Normalize leading and trailing slashes while preserving internal empty segments:
  // 1. Strip leading slashes consistently (e.g. "///api" -> "api", "/api" -> "api")
  let corePath = pathname.replace(/^\/+/, "");
  // 2. Strip trailing slashes consistently (trailing slash recorded in trailingSlashState)
  corePath = corePath.replace(/\/+$/, "");

  let segments: RouteSegment[];
  if (corePath === "") {
    segments = [];
  } else {
    // Split by '/' without dropping empty segments, preserving internal empty path segments
    const rawSegments = corePath.split("/");
    segments = rawSegments.map((s) => parseRouteSegment(s));
  }

  return {
    segments,
    trailingSlash: trailingSlashState,
    queryHandling,
    rawPath: trimmed
  };
}

/**
 * Reconstructs a canonical formatted route path string from a RoutePattern.
 *
 * @param pattern The RoutePattern to format.
 * @returns Normalized route path string (e.g. '/api/users/:id' or '/').
 */
export function formatRoutePattern(pattern: RoutePattern): string {
  if (pattern.segments.length === 0) {
    return pattern.trailingSlash === "present" ? "/" : "";
  }

  const formattedSegments = pattern.segments.map((seg) => {
    switch (seg.kind) {
      case "static":
        return seg.value;
      case "parameter":
        return seg.name ? `:${seg.name}` : ":_";
      case "wildcard":
        return seg.name ? `*${seg.name}` : "*";
      case "unresolved":
        return seg.sourceText;
    }
  });

  const path = "/" + formattedSegments.join("/");
  return pattern.trailingSlash === "present" ? `${path}/` : path;
}

/**
 * Compares two RoutePatterns for structural route-shape equivalence as specified in LLD.md Section 10.3.
 *
 * Two paths have the same route shape if all static segments match exactly, parameter positions
 * align (regardless of parameter variable names), and wildcards align.
 *
 * @param a First RoutePattern.
 * @param b Second RoutePattern.
 * @returns True if route shapes are structurally compatible.
 */
export function areRouteShapesCompatible(a: RoutePattern, b: RoutePattern): boolean {
  if (a.segments.length !== b.segments.length) {
    return false;
  }

  for (let i = 0; i < a.segments.length; i++) {
    const segA = a.segments[i];
    const segB = b.segments[i];

    if (segA.kind !== segB.kind) {
      return false;
    }

    if (segA.kind === "static" && segB.kind === "static") {
      if (segA.value !== segB.value) {
        return false;
      }
    } else if (segA.kind === "unresolved" && segB.kind === "unresolved") {
      if (segA.sourceText !== segB.sourceText) {
        return false;
      }
    }
    // Parameters and wildcards match structurally regardless of local variable name differences
  }

  return true;
}
