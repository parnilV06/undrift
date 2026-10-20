// Phase 3, Chunk 3.1: Route & HTTP Method Normalization Unit Tests.
// Verifies deterministic route parsing, leading/trailing slash policies, parameter handling,
// query string and fragment exclusion, and case-insensitive HTTP method normalization.

import { describe, expect, it } from "vitest";
import {
  SUPPORTED_HTTP_METHODS,
  formatRoutePattern,
  isRoutePattern,
  isSupportedHttpMethod,
  normalizeHttpMethod,
  normalizeRoute,
  parseHttpMethod,
  parseRouteSegment,
  resolveFetchDefaultMethod
} from "../../packages/core/src/index";
import { areRouteShapesCompatible } from "../../packages/core/src/normalization/route-normalizer";

describe("Phase 3, Chunk 3.1: Route Normalization", () => {
  describe("1. Canonical handling of leading slashes and internal repeated slashes", () => {
    it("normalizes path with single leading slash", () => {
      const pattern = normalizeRoute("/api/users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("normalizes path without leading slash to identical segments", () => {
      const pattern = normalizeRoute("api/users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("normalizes path with multiple redundant leading slashes consistently", () => {
      const pattern = normalizeRoute("///api/users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("normalizes path with Windows backslashes", () => {
      const pattern = normalizeRoute("\\api\\users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("preserves empty internal path segments for repeated internal slashes (LLD Section 9.1 rule 4)", () => {
      const pattern = normalizeRoute("/api//users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "" },
        { kind: "static", value: "users" }
      ]);
    });

    it("preserves multiple consecutive internal empty segments without collapsing them", () => {
      const pattern = normalizeRoute("/api///users");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "" },
        { kind: "static", value: "" },
        { kind: "static", value: "users" }
      ]);
    });
  });

  describe("2. Trailing-slash policy defined in LLD", () => {
    it("records trailingSlash as 'present' when path ends with a slash", () => {
      const pattern = normalizeRoute("/api/users/");
      expect(pattern.trailingSlash).toBe("present");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("records trailingSlash as 'absent' when path does not end with a slash", () => {
      const pattern = normalizeRoute("/api/users");
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
    });

    it("records trailingSlash as 'present' for the root path '/'", () => {
      const pattern = normalizeRoute("/");
      expect(pattern.trailingSlash).toBe("present");
      expect(pattern.segments).toEqual([]);
    });

    it("records trailingSlash as 'absent' for empty path ''", () => {
      const pattern = normalizeRoute("");
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.segments).toEqual([]);
    });

    it("respects explicit trailingSlash option override", () => {
      const patternWithSlash = normalizeRoute("/api/users", { trailingSlash: "present" });
      expect(patternWithSlash.trailingSlash).toBe("present");

      const patternWithoutSlash = normalizeRoute("/api/users/", { trailingSlash: "absent" });
      expect(patternWithoutSlash.trailingSlash).toBe("absent");
    });
  });

  describe("3. Absolute URL extraction and query/fragment exclusion", () => {
    it("extracts pathname from absolute URL and excludes query and fragment", () => {
      const pattern = normalizeRoute("http://api.internal/v1/users?page=1#results");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "v1" },
        { kind: "static", value: "users" }
      ]);
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.queryHandling).toBe("excluded-from-path");
      expect(pattern.rawPath).toBe("http://api.internal/v1/users?page=1#results");
    });

    it("extracts pathname from absolute HTTPS URL with trailing slash before query", () => {
      const pattern = normalizeRoute("https://api.internal/v1/users/?sort=asc#summary");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "v1" },
        { kind: "static", value: "users" }
      ]);
      expect(pattern.trailingSlash).toBe("present");
      expect(pattern.queryHandling).toBe("excluded-from-path");
    });

    it("excludes query and fragment from relative paths", () => {
      const pattern = normalizeRoute("/api/users?active=true&limit=10#section-header");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" }
      ]);
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.queryHandling).toBe("excluded-from-path");
    });

    it("handles root absolute URL cleanly", () => {
      const pattern = normalizeRoute("https://api.internal/");
      expect(pattern.segments).toEqual([]);
      expect(pattern.trailingSlash).toBe("present");
      expect(pattern.queryHandling).toBe("excluded-from-path");
    });
  });

  describe("4. Named Express-style route parameters", () => {
    it("extracts Express-style named parameters", () => {
      const pattern = normalizeRoute("/users/:userId/posts/:postId");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "users" },
        { kind: "parameter", name: "userId" },
        { kind: "static", value: "posts" },
        { kind: "parameter", name: "postId" }
      ]);
    });

    it("preserves optional parameter syntax as unresolved rather than converting to required parameter", () => {
      const pattern = normalizeRoute("/users/:userId?");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "users" },
        { kind: "unresolved", sourceText: ":userId?" }
      ]);
    });

    it("preserves regex-constrained parameter as unresolved with original source text", () => {
      const pattern = normalizeRoute("/users/:id(\\d+)");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "users" },
        { kind: "unresolved", sourceText: ":id(\\d+)" }
      ]);
    });

    it("handles colon parameter without name as anonymous parameter", () => {
      const pattern = normalizeRoute("/users/:");
      expect(pattern.segments).toEqual([{ kind: "static", value: "users" }, { kind: "parameter" }]);
    });
  });

  describe("5. Brace-style route parameters", () => {
    it("extracts OpenAPI/brace-style parameters", () => {
      const pattern = normalizeRoute("/users/{userId}/posts/{postId}");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "users" },
        { kind: "parameter", name: "userId" },
        { kind: "static", value: "posts" },
        { kind: "parameter", name: "postId" }
      ]);
    });

    it("handles empty braces as anonymous parameter", () => {
      const pattern = normalizeRoute("/users/{}");
      expect(pattern.segments).toEqual([{ kind: "static", value: "users" }, { kind: "parameter" }]);
    });
  });

  describe("6. Preservation of static, wildcard, and unresolved/dynamic route segments", () => {
    it("preserves static segments faithfully", () => {
      const seg = parseRouteSegment("orders");
      expect(seg).toEqual({ kind: "static", value: "orders" });
    });

    it("preserves single wildcard segment '*'", () => {
      const pattern = normalizeRoute("/files/*");
      expect(pattern.segments).toEqual([{ kind: "static", value: "files" }, { kind: "wildcard" }]);
    });

    it("preserves named wildcard segment '*filepath'", () => {
      const pattern = normalizeRoute("/files/*filepath");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "files" },
        { kind: "wildcard", name: "filepath" }
      ]);
    });

    it("preserves dynamic template expression segment '${userId}' as unresolved", () => {
      const pattern = normalizeRoute("/api/users/${userId}/profile");
      expect(pattern.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" },
        { kind: "unresolved", sourceText: "${userId}" },
        { kind: "static", value: "profile" }
      ]);
    });
  });

  describe("9. Determinism and idempotence of route normalization", () => {
    it("produces identical output on repeated calls with the same input", () => {
      const input = "https://api.internal:8080/v2/items/:itemId?filter=all#top";
      const result1 = normalizeRoute(input);
      const result2 = normalizeRoute(input);
      expect(result1).toEqual(result2);
    });

    it("returns an identical copy when passed an already-normalized RoutePattern", () => {
      const original = normalizeRoute("/api/v1/orders/:orderId");
      const normalizedAgain = normalizeRoute(original);
      expect(normalizedAgain).toEqual(original);
      // Verify defensive copy (not same array reference)
      expect(normalizedAgain.segments).not.toBe(original.segments);
    });

    it("verifies isRoutePattern type guard correctly", () => {
      const pattern = normalizeRoute("/test");
      expect(isRoutePattern(pattern)).toBe(true);
      expect(isRoutePattern("/test")).toBe(false);
      expect(isRoutePattern(null)).toBe(false);
      expect(isRoutePattern({ segments: [] })).toBe(false);
    });
  });

  describe("10. Empty-path and malformed-input behavior", () => {
    it("handles whitespace-only input cleanly as known empty path", () => {
      const pattern = normalizeRoute("     ");
      expect(pattern.segments).toEqual([]);
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.queryHandling).toBe("excluded-from-path");
      expect(pattern.rawPath).toBe("");
    });

    it("retains known empty path behavior for explicit empty string input", () => {
      const patternEmpty = normalizeRoute("");
      expect(patternEmpty.segments).toEqual([]);
      expect(patternEmpty.trailingSlash).toBe("absent");
      expect(patternEmpty.queryHandling).toBe("excluded-from-path");
      expect(patternEmpty.rawPath).toBe("");
    });

    it("represents null and undefined as unresolved missing inputs rather than known empty paths", () => {
      const patternNull = normalizeRoute(null);
      expect(patternNull.segments).toEqual([{ kind: "unresolved", sourceText: "" }]);
      expect(patternNull.trailingSlash).toBe("unknown");
      expect(patternNull.queryHandling).toBe("unknown");
      expect(patternNull.rawPath).toBe("");

      const patternUndefined = normalizeRoute(undefined);
      expect(patternUndefined.segments).toEqual([{ kind: "unresolved", sourceText: "" }]);
      expect(patternUndefined.trailingSlash).toBe("unknown");
      expect(patternUndefined.queryHandling).toBe("unknown");
      expect(patternUndefined.rawPath).toBe("");
    });

    it("handles non-string numbers as unresolved", () => {
      const pattern = normalizeRoute(12345);
      expect(pattern.segments).toEqual([{ kind: "unresolved", sourceText: "12345" }]);
      expect(pattern.trailingSlash).toBe("unknown");
      expect(pattern.queryHandling).toBe("unknown");
    });

    it("handles malformed absolute URL syntax as unresolved", () => {
      const pattern = normalizeRoute("http://[invalid-url");
      expect(pattern.segments).toEqual([{ kind: "unresolved", sourceText: "http://[invalid-url" }]);
      expect(pattern.trailingSlash).toBe("unknown");
      expect(pattern.queryHandling).toBe("unknown");
    });
  });

  describe("Route Formatting & Structural Compatibility", () => {
    it("formats RoutePattern back to canonical string", () => {
      const pattern = normalizeRoute("/api/users/:userId/posts/{postId}/");
      expect(formatRoutePattern(pattern)).toBe("/api/users/:userId/posts/:postId/");

      const patternRoot = normalizeRoute("/");
      expect(formatRoutePattern(patternRoot)).toBe("/");

      const patternEmpty = normalizeRoute("");
      expect(formatRoutePattern(patternEmpty)).toBe("");
    });

    it("formats RoutePattern with internal empty segments back to repeated slashes", () => {
      const pattern = normalizeRoute("/api//users");
      expect(formatRoutePattern(pattern)).toBe("/api//users");
    });

    it("detects route shape compatibility irrespective of parameter names (LLD Section 10.3)", () => {
      const consumer = normalizeRoute("/users/:id/profile");
      const provider = normalizeRoute("/users/{userId}/profile");
      expect(areRouteShapesCompatible(consumer, provider)).toBe(true);
    });

    it("detects incompatible route shapes when static segments differ", () => {
      const consumer = normalizeRoute("/users/:id/profile");
      const provider = normalizeRoute("/members/:id/profile");
      expect(areRouteShapesCompatible(consumer, provider)).toBe(false);
    });

    it("detects incompatible route shapes when segment counts differ", () => {
      const consumer = normalizeRoute("/users/:id");
      const provider = normalizeRoute("/users/:id/details");
      expect(areRouteShapesCompatible(consumer, provider)).toBe(false);
    });
  });
});

describe("Phase 3, Chunk 3.1: HTTP Method Normalization", () => {
  describe("7. Canonicalization of supported HTTP methods, including lowercase", () => {
    it("canonicalizes all standard methods from uppercase", () => {
      for (const method of SUPPORTED_HTTP_METHODS) {
        expect(normalizeHttpMethod(method)).toBe(method);
      }
    });

    it("canonicalizes lowercase and mixed-case method strings", () => {
      expect(normalizeHttpMethod("get")).toBe("GET");
      expect(normalizeHttpMethod("post")).toBe("POST");
      expect(normalizeHttpMethod("pUt")).toBe("PUT");
      expect(normalizeHttpMethod("patch")).toBe("PATCH");
      expect(normalizeHttpMethod("DELETE")).toBe("DELETE");
      expect(normalizeHttpMethod("options")).toBe("OPTIONS");
      expect(normalizeHttpMethod("Head")).toBe("HEAD");
    });

    it("trims surrounding whitespace from method strings", () => {
      expect(normalizeHttpMethod("   post   ")).toBe("POST");
      expect(normalizeHttpMethod("\tget\n")).toBe("GET");
    });

    it("verifies isSupportedHttpMethod correctly", () => {
      expect(isSupportedHttpMethod("GET")).toBe(true);
      expect(isSupportedHttpMethod("POST")).toBe(true);
      expect(isSupportedHttpMethod("get")).toBe(false); // only canonical uppercase is supported HttpMethod
      expect(isSupportedHttpMethod("CUSTOM")).toBe(false);
    });
  });

  describe("8. Handling of unsupported and missing method values without silently inventing a method", () => {
    it("returns undefined for unsupported methods in normalizeHttpMethod", () => {
      expect(normalizeHttpMethod("CUSTOM")).toBeUndefined();
      expect(normalizeHttpMethod("GRAPHQL")).toBeUndefined();
      expect(normalizeHttpMethod("CONNECT")).toBeUndefined();
      expect(normalizeHttpMethod("TRACE")).toBeUndefined();
    });

    it("returns undefined for missing or empty methods in normalizeHttpMethod", () => {
      expect(normalizeHttpMethod(undefined)).toBeUndefined();
      expect(normalizeHttpMethod(null)).toBeUndefined();
      expect(normalizeHttpMethod("")).toBeUndefined();
      expect(normalizeHttpMethod("   ")).toBeUndefined();
    });

    it("returns detailed classification in parseHttpMethod for supported methods", () => {
      const res = parseHttpMethod("post");
      expect(res).toEqual({
        state: "supported",
        method: "POST",
        rawMethod: "post"
      });
    });

    it("returns detailed classification in parseHttpMethod for unsupported methods", () => {
      const res = parseHttpMethod("GRAPHQL");
      expect(res).toEqual({
        state: "unsupported",
        rawMethod: "GRAPHQL"
      });
      expect(res.method).toBeUndefined();
    });

    it("returns detailed classification in parseHttpMethod for missing/empty methods", () => {
      expect(parseHttpMethod(undefined)).toEqual({ state: "missing" });
      expect(parseHttpMethod(null)).toEqual({ state: "missing" });
      expect(parseHttpMethod("")).toEqual({ state: "missing", rawMethod: "" });
      expect(parseHttpMethod("   ")).toEqual({ state: "missing", rawMethod: "   " });
    });

    it("does not silently convert missing or unsupported methods to GET", () => {
      expect(normalizeHttpMethod("")).not.toBe("GET");
      expect(normalizeHttpMethod(undefined)).not.toBe("GET");
      expect(normalizeHttpMethod("CUSTOM")).not.toBe("GET");
      expect(parseHttpMethod("CUSTOM").method).toBeUndefined();
    });
  });

  describe("Fetch-specific default method behavior (LLD Section 9.2)", () => {
    it("defaults to GET when options does not provide a method", () => {
      const res = resolveFetchDefaultMethod(false);
      expect(res).toEqual({
        state: "supported",
        method: "GET"
      });
    });

    it("normalizes explicit method when options explicitly provides one", () => {
      const res = resolveFetchDefaultMethod(true, "post");
      expect(res).toEqual({
        state: "supported",
        method: "POST",
        rawMethod: "post"
      });
    });

    it("returns missing when options provides empty method expression", () => {
      const res = resolveFetchDefaultMethod(true, undefined);
      expect(res).toEqual({
        state: "missing"
      });
    });

    it("returns unsupported when options provides unknown method", () => {
      const res = resolveFetchDefaultMethod(true, "RPC");
      expect(res).toEqual({
        state: "unsupported",
        rawMethod: "RPC"
      });
    });
  });

  describe("9. Determinism of method normalization", () => {
    it("returns identical result for repeated calls with identical input", () => {
      expect(parseHttpMethod("delete")).toEqual(parseHttpMethod("delete"));
      expect(normalizeHttpMethod("delete")).toEqual(normalizeHttpMethod("delete"));
    });
  });
});
