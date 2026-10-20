// Canonical HTTP method normalization as specified in LLD.md Section 9.2.
// Provides deterministic normalization of HTTP method strings to the canonical HttpMethod union,
// preserving distinctions between recognized, unsupported, and missing methods.

import type { HttpMethod } from "../domain/types";

/**
 * Master catalog of supported HTTP methods as defined in LLD.md Section 4.1 and Section 9.2.
 */
export const SUPPORTED_HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
] as const;

const SUPPORTED_HTTP_METHODS_SET: ReadonlySet<string> = new Set(SUPPORTED_HTTP_METHODS);

/**
 * Classification of an HTTP method normalization result.
 * - supported: input matches a known canonical HttpMethod (case-insensitively).
 * - unsupported: input is a non-empty string that is not among the supported HTTP methods.
 * - missing: input is null, undefined, empty, or non-string without method information.
 */
export type MethodNormalizationState = "supported" | "unsupported" | "missing";

/**
 * Detailed outcome of an HTTP method normalization attempt.
 */
export interface MethodNormalizationResult {
  /** Classification of the normalization result. */
  readonly state: MethodNormalizationState;
  /** Normalized canonical method when state is 'supported'. */
  readonly method?: HttpMethod;
  /** Original raw string input when available. */
  readonly rawMethod?: string;
}

/**
 * Type guard verifying if a value is a supported canonical HttpMethod.
 */
export function isSupportedHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === "string" && SUPPORTED_HTTP_METHODS_SET.has(value);
}

/**
 * Parses and classifies an HTTP method input string case-insensitively.
 *
 * Distinguishes supported methods from unsupported values (e.g. 'GRAPHQL', 'CUSTOM')
 * and missing values (null, undefined, empty string) without silently inventing a method.
 *
 * @param rawMethod The input method string, or undefined/null.
 * @returns Detailed normalization result capturing state and canonical method if valid.
 */
export function parseHttpMethod(rawMethod: unknown): MethodNormalizationResult {
  if (rawMethod === undefined || rawMethod === null) {
    return { state: "missing" };
  }

  if (typeof rawMethod !== "string") {
    return {
      state: "unsupported",
      rawMethod: String(rawMethod)
    };
  }

  const trimmed = rawMethod.trim();
  if (trimmed === "") {
    return { state: "missing", rawMethod };
  }

  const uppercase = trimmed.toUpperCase();
  if (isSupportedHttpMethod(uppercase)) {
    return {
      state: "supported",
      method: uppercase,
      rawMethod
    };
  }

  return {
    state: "unsupported",
    rawMethod
  };
}

/**
 * Normalizes an HTTP method string to a canonical HttpMethod, or returns undefined
 * if the method is unsupported, missing, or malformed.
 *
 * Note: Does NOT silently convert missing or unsupported methods to 'GET'.
 *
 * @param rawMethod The raw input method string.
 * @returns Canonical HttpMethod if supported, or undefined.
 */
export function normalizeHttpMethod(rawMethod: unknown): HttpMethod | undefined {
  const result = parseHttpMethod(rawMethod);
  return result.state === "supported" ? result.method : undefined;
}

/**
 * Resolves the effective HTTP method for a fetch() call expression.
 *
 * In standard Fetch semantics (LLD.md Section 9.2), fetch(url) without an options
 * object or with an options object that does not specify 'method' defaults to GET.
 * When options explicitly provides a method expression, standard normalization applies.
 *
 * @param optionsMethodProvided Whether the caller explicitly provided a method in options.
 * @param explicitMethod The value of the explicitly provided method, if any.
 * @returns Normalization result reflecting fetch-specific default GET or the explicit method.
 */
export function resolveFetchDefaultMethod(
  optionsMethodProvided: boolean,
  explicitMethod?: unknown
): MethodNormalizationResult {
  if (!optionsMethodProvided) {
    return {
      state: "supported",
      method: "GET"
    };
  }

  return parseHttpMethod(explicitMethod);
}
