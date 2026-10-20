import { describe, expect, it } from "vitest";
import type {
  ApiObservation,
  ContractRelationship,
  HttpMethod,
  ObservationRole,
  RoutePattern
} from "../../packages/core/src/index";
import {
  areRouteShapesEqual,
  assessTrailingSlashCompatibility,
  ContractMatcher,
  createRelationshipId,
  matchCandidates,
  normalizeHttpMethod,
  normalizeRoute
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.3: Contract Matcher & Relationship Model", () => {
  // Helper to construct realistic ApiObservation fixtures for tests
  function createObservation(
    id: string,
    role: ObservationRole,
    methodStr?: string,
    pathInput?: string | RoutePattern,
    options?: {
      methodConfidence?: "direct" | "resolved" | "inferred" | "unknown";
      pathConfidence?: "direct" | "resolved" | "inferred" | "unknown";
      limitations?: string[];
    }
  ): ApiObservation {
    const normMethod = methodStr ? normalizeHttpMethod(methodStr) : undefined;
    const normPath = typeof pathInput === "string" ? normalizeRoute(pathInput) : pathInput;

    return {
      id,
      role,
      languageId: "typescript",
      extractorId: role === "consumer" ? "fetch-extractor" : "express-extractor",
      source: [
        {
          snapshot: { uri: `file:///${role}/${id}.ts`, contentHash: "hash123" },
          range: {
            start: { line: 10, character: 1 },
            end: { line: 10, character: 25 }
          }
        }
      ],
      snapshot: { uri: `file:///${role}/${id}.ts`, contentHash: "hash123" },
      endpoint: {
        method: normMethod
          ? {
              state: "known",
              value: normMethod,
              strength:
                (options?.methodConfidence as "direct" | "resolved" | "inferred") ?? "direct",
              evidence: [
                {
                  id: `ev-method-${id}`,
                  kind: "explicit-annotation",
                  strength: options?.methodConfidence ?? "direct",
                  source: {
                    uri: `file:///${role}/${id}.ts`,
                    range: { start: 10, end: 15 },
                    start: { line: 10, character: 1 },
                    end: { line: 10, character: 5 }
                  }
                }
              ]
            }
          : {
              state: "unknown",
              reason: "missing or unsupported method",
              evidence: []
            },
        path: normPath
          ? {
              state: "known",
              value: normPath,
              strength: (options?.pathConfidence as "direct" | "resolved" | "inferred") ?? "direct",
              evidence: [
                {
                  id: `ev-path-${id}`,
                  kind: "literal-syntax",
                  strength: options?.pathConfidence ?? "direct",
                  source: {
                    uri: `file:///${role}/${id}.ts`,
                    range: { start: 16, end: 35 },
                    start: { line: 10, character: 7 },
                    end: { line: 10, character: 25 }
                  }
                }
              ]
            }
          : {
              state: "unknown",
              reason: "missing path",
              evidence: []
            }
      },
      limitations: (options?.limitations ?? []).map((msg) => ({
        code: "UNSUPPORTED_SYNTAX",
        message: msg,
        source: {
          snapshot: { uri: `file:///${role}/${id}.ts`, contentHash: "hash123" },
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 10 }
          }
        }
      }))
    };
  }

  // Helper to construct RoutePattern with explicit trailingSlash metadata
  function createRoutePatternWithSlash(
    path: string,
    trailingSlash: "present" | "absent" | "unknown"
  ): RoutePattern {
    const norm = normalizeRoute(path);
    return {
      ...norm,
      trailingSlash
    };
  }

  // --------------------------------------------------------------------------
  // 1. Exact consumer/provider match
  // --------------------------------------------------------------------------
  describe("1. Exact route and method matching", () => {
    it("matches consumer and provider with identical route and method", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);

      const rel = relationships[0];
      expect(rel.id).toBe(createRelationshipId("exact", "c1", "p1"));
      expect(rel.consumerId).toBe("c1");
      expect(rel.providerId).toBe("p1");
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.reasons[0]).toContain("Exact match");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Parameter-name differences at corresponding positions
  // --------------------------------------------------------------------------
  describe("2. Parameter-name independent structural matching", () => {
    it("matches routes when parameter names differ at the same positions (LLD 10.3)", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users/:id");
      const provider = createObservation("p1", "provider", "GET", "/api/users/:userId");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);

      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.consumerId).toBe("c1");
      expect(rel.providerId).toBe("p1");
    });

    it("matches multiple parameter positions regardless of variable naming", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/orgs/:orgId/repos/:repoName");
      const provider = createObservation("p1", "provider", "GET", "/orgs/:id/repos/:name");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);
      expect(relationships[0].matchKind).toBe("exact");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Method conflict on structurally matching route
  // --------------------------------------------------------------------------
  describe("3. Method conflict", () => {
    it("identifies a method conflict when route matches but methods differ", () => {
      const consumer = createObservation("c1", "consumer", "POST", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);

      const rel = relationships[0];
      expect(rel.id).toBe(createRelationshipId("method-conflict", "c1", "p1"));
      expect(rel.consumerId).toBe("c1");
      expect(rel.providerId).toBe("p1");
      expect(rel.matchKind).toBe("method-conflict");
      expect(rel.state).toBe("matched");
      expect(rel.reasons[0]).toContain("Method conflict");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Missing or unsupported methods do not generate method conflict
  // --------------------------------------------------------------------------
  describe("4. Missing or unsupported methods", () => {
    it("does not generate method conflict when consumer method is missing/unsupported", () => {
      const consumer = createObservation("c1", "consumer", undefined, "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      // Should not be classified as a confident method conflict!
      const methodConflicts = relationships.filter((r) => r.matchKind === "method-conflict");
      expect(methodConflicts).toHaveLength(0);

      // Consumer is unmatched because its method is unknown
      const unmatchedConsumer = relationships.find((r) => r.consumerId === "c1");
      expect(unmatchedConsumer?.matchKind).toBe("unmatched");

      // Provider is orphaned because it has no matched consumer
      const orphanedProvider = relationships.find((r) => r.providerId === "p1");
      expect(orphanedProvider?.matchKind).toBe("unmatched");
      expect(orphanedProvider?.state).toBe("orphaned");
    });

    it("does not generate method conflict when provider method is missing", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", undefined, "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const methodConflicts = relationships.filter((r) => r.matchKind === "method-conflict");
      expect(methodConflicts).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Suspected route mismatch (LLD 10.4 - All 7 conditions met)
  // --------------------------------------------------------------------------
  describe("5. Suspected route mismatch (Valid candidate)", () => {
    it("matches when exactly one static segment differs with identical method and compatible parameters", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/user");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);

      const rel = relationships[0];
      expect(rel.id).toBe(createRelationshipId("suspected-route-conflict", "c1", "p1"));
      expect(rel.consumerId).toBe("c1");
      expect(rel.providerId).toBe("p1");
      expect(rel.matchKind).toBe("suspected-route-conflict");
      expect(rel.state).toBe("matched");
      expect(rel.reasons[0]).toContain("Suspected route mismatch");
    });

    it("supports suspected mismatch with matching parameter positions", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/v1/users/:id");
      const provider = createObservation("p1", "provider", "GET", "/api/v2/users/:id");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);
      expect(relationships[0].matchKind).toBe("suspected-route-conflict");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Suspected mismatch rejected when segment counts differ
  // --------------------------------------------------------------------------
  describe("6. Suspected mismatch rejection: segment count mismatch", () => {
    it("rejects suspected route mismatch when segment counts differ", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users/profile");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Suspected mismatch rejected when methods differ
  // --------------------------------------------------------------------------
  describe("7. Suspected mismatch rejection: differing methods", () => {
    it("rejects suspected route mismatch when methods differ", () => {
      const consumer = createObservation("c1", "consumer", "POST", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/user");

      const relationships = matchCandidates([consumer, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Suspected mismatch rejected when dynamic or unresolved segments exist
  // --------------------------------------------------------------------------
  describe("8. Suspected mismatch rejection: unresolved or wildcard segments", () => {
    it("rejects suspected route mismatch when consumer contains an unresolved segment", () => {
      const unresolvedRoute: RoutePattern = {
        rawPath: "/api/[unresolved]",
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        segments: [
          { kind: "static", value: "api" },
          { kind: "unresolved", sourceText: "dynamicVal" }
        ]
      };

      const consumer = createObservation("c1", "consumer", "GET", unresolvedRoute);
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });

    it("rejects suspected route mismatch when path contains a wildcard", () => {
      const wildcardRoute: RoutePattern = {
        rawPath: "/api/*",
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        segments: [
          { kind: "static", value: "api" },
          { kind: "wildcard", name: "rest" }
        ]
      };

      const consumer = createObservation("c1", "consumer", "GET", wildcardRoute);
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Suspected mismatch rejected when more than one static segment differs
  // --------------------------------------------------------------------------
  describe("9. Suspected mismatch rejection: multiple static segment differences", () => {
    it("rejects suspected route mismatch when 2 or more static segments differ", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/v1/accounts");
      const provider = createObservation("p1", "provider", "GET", "/api/v2/users");

      const relationships = matchCandidates([consumer, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Suspected mismatch rejected when multiple competing candidates exist (non-unique)
  // --------------------------------------------------------------------------
  describe("10. Suspected mismatch rejection: mutual uniqueness violation", () => {
    it("rejects suspected route mismatch when provider is not unique for consumer", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider1 = createObservation("p1", "provider", "GET", "/api/user");
      const provider2 = createObservation("p2", "provider", "GET", "/api/members");

      const relationships = matchCandidates([consumer, provider1, provider2]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });

    it("rejects suspected route mismatch when consumer is not unique for provider", () => {
      const consumer1 = createObservation("c1", "consumer", "GET", "/api/users");
      const consumer2 = createObservation("c2", "consumer", "GET", "/api/accounts");
      const provider = createObservation("p1", "provider", "GET", "/api/user");

      const relationships = matchCandidates([consumer1, consumer2, provider]);
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 11. Exact matches take precedence over weaker candidate classifications
  // --------------------------------------------------------------------------
  describe("11. Precedence of exact match over weaker candidates", () => {
    it("suppresses method-conflict and suspected mismatch when consumer has an exact match", () => {
      // Consumer calls GET /api/users
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      // Provider 1: exact match
      const provider1 = createObservation("p1", "provider", "GET", "/api/users");
      // Provider 2: method conflict (POST /api/users)
      const provider2 = createObservation("p2", "provider", "POST", "/api/users");
      // Provider 3: candidate for suspected mismatch (GET /api/user)
      const provider3 = createObservation("p3", "provider", "GET", "/api/user");

      const relationships = matchCandidates([consumer, provider1, provider2, provider3]);

      // Consumer c1 must have EXACTLY ONE relationship, which is the exact match with p1
      const c1Rels = relationships.filter((r) => r.consumerId === "c1");
      expect(c1Rels).toHaveLength(1);
      expect(c1Rels[0].providerId).toBe("p1");
      expect(c1Rels[0].matchKind).toBe("exact");

      // Provider 2 and 3 remain orphaned providers
      const p2Rel = relationships.find((r) => r.providerId === "p2");
      expect(p2Rel?.matchKind).toBe("unmatched");
      expect(p2Rel?.state).toBe("orphaned");

      const p3Rel = relationships.find((r) => r.providerId === "p3");
      expect(p3Rel?.matchKind).toBe("unmatched");
      expect(p3Rel?.state).toBe("orphaned");
    });
  });

  // --------------------------------------------------------------------------
  // 12. Ambiguous consumer/provider candidate set is not arbitrarily resolved
  // --------------------------------------------------------------------------
  describe("12. Ambiguous candidates handling", () => {
    it("marks competing exact providers as ambiguous without arbitrary promotion", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const providerA = createObservation("pA", "provider", "GET", "/api/users");
      const providerB = createObservation("pB", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, providerA, providerB]);

      // Both relationships should be ambiguous and unresolved
      const exactMatches = relationships.filter((r) => r.matchKind === "exact");
      expect(exactMatches).toHaveLength(0);

      const ambiguousRels = relationships.filter((r) => r.matchKind === "ambiguous");
      expect(ambiguousRels).toHaveLength(2);
      expect(ambiguousRels.every((r) => r.state === "unresolved")).toBe(true);

      const pIds = ambiguousRels.map((r) => r.providerId);
      expect(pIds).toContain("pA");
      expect(pIds).toContain("pB");
    });
  });

  // --------------------------------------------------------------------------
  // 13. Unmatched consumer and provider handling
  // --------------------------------------------------------------------------
  describe("13. Unmatched consumer and provider contracts", () => {
    it("creates unmatched discovered relationship for consumer without provider", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/orders");
      const relationships = matchCandidates([consumer]);

      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.consumerId).toBe("c1");
      expect(rel.providerId).toBeUndefined();
      expect(rel.matchKind).toBe("unmatched");
      expect(rel.state).toBe("discovered");
      expect(rel.reasons[0]).toContain("No compatible provider found");
    });

    it("creates unmatched orphaned relationship for provider without consumer", () => {
      const provider = createObservation("p1", "provider", "GET", "/api/analytics");
      const relationships = matchCandidates([provider]);

      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.consumerId).toBeUndefined();
      expect(rel.providerId).toBe("p1");
      expect(rel.matchKind).toBe("unmatched");
      expect(rel.state).toBe("orphaned");
      expect(rel.reasons[0]).toContain("Provider has no known consumer");
    });
  });

  // --------------------------------------------------------------------------
  // 14. Multiple consumers can call the same provider
  // --------------------------------------------------------------------------
  describe("14. Multiple consumers targeting the same provider", () => {
    it("allows multiple distinct consumers to exact-match the same provider", () => {
      const consumerA = createObservation("cA", "consumer", "GET", "/api/users");
      const consumerB = createObservation("cB", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumerA, consumerB, provider]);
      const exactRels = relationships.filter((r) => r.matchKind === "exact");

      expect(exactRels).toHaveLength(2);
      expect(exactRels.map((r) => r.consumerId)).toEqual(["cA", "cB"]);
      expect(exactRels.every((r) => r.providerId === "p1")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 15. Reordering input observations does not cause nondeterminism
  // --------------------------------------------------------------------------
  describe("15. Determinism and order independence", () => {
    it("produces identical relationships regardless of input array ordering", () => {
      const c1 = createObservation("c1", "consumer", "GET", "/api/users");
      const c2 = createObservation("c2", "consumer", "POST", "/api/posts");
      const p1 = createObservation("p1", "provider", "GET", "/api/users");
      const p2 = createObservation("p2", "provider", "POST", "/api/posts");
      const p3 = createObservation("p3", "provider", "DELETE", "/api/orphaned");

      const order1 = [c1, c2, p1, p2, p3];
      const order2 = [p3, p2, c2, p1, c1];
      const order3 = [p1, c1, p3, c2, p2];

      const res1 = matchCandidates(order1);
      const res2 = matchCandidates(order2);
      const res3 = matchCandidates(order3);

      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);
    });
  });

  // --------------------------------------------------------------------------
  // 16. Conservative handling of unresolved paths and incomplete evidence
  // --------------------------------------------------------------------------
  describe("16. Conservative handling of unresolved patterns", () => {
    it("does not match routes when paths contain unresolved segments", () => {
      const unresolvedRoute: RoutePattern = {
        rawPath: "/api/${endpoint}",
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        segments: [
          { kind: "static", value: "api" },
          { kind: "unresolved", sourceText: "${endpoint}" }
        ]
      };

      const consumer = createObservation("c1", "consumer", "GET", unresolvedRoute);
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships.every((r) => r.matchKind !== "exact")).toBe(true);
      expect(relationships.every((r) => r.matchKind !== "suspected-route-conflict")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 17. Empty and single-role observation sets
  // --------------------------------------------------------------------------
  describe("17. Empty and single-role observation sets", () => {
    it("returns empty array for empty observation list", () => {
      expect(matchCandidates([])).toEqual([]);
    });

    it("marks all consumers as unmatched when no providers exist", () => {
      const c1 = createObservation("c1", "consumer", "GET", "/api/1");
      const c2 = createObservation("c2", "consumer", "POST", "/api/2");

      const relationships = matchCandidates([c1, c2]);
      expect(relationships).toHaveLength(2);
      expect(relationships.every((r) => r.matchKind === "unmatched")).toBe(true);
      expect(relationships.every((r) => r.state === "discovered")).toBe(true);
    });

    it("marks all providers as orphaned when no consumers exist", () => {
      const p1 = createObservation("p1", "provider", "GET", "/api/1");
      const p2 = createObservation("p2", "provider", "POST", "/api/2");

      const relationships = matchCandidates([p1, p2]);
      expect(relationships).toHaveLength(2);
      expect(relationships.every((r) => r.matchKind === "unmatched")).toBe(true);
      expect(relationships.every((r) => r.state === "orphaned")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 18. Evidence and observation references consistency
  // --------------------------------------------------------------------------
  describe("18. Evidence and provenance preservation", () => {
    it("attaches source evidence from both consumer and provider", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships).toHaveLength(1);

      const rel = relationships[0];
      expect(rel.evidence.length).toBeGreaterThanOrEqual(2);
      const kinds = rel.evidence.map((e) => e.kind);
      expect(kinds).toContain("explicit-annotation");
      expect(kinds).toContain("literal-syntax");

      const ids = rel.evidence.map((e) => e.id);
      expect(ids).toContain("ev-method-c1");
      expect(ids).toContain("ev-path-c1");
      expect(ids).toContain("ev-method-p1");
      expect(ids).toContain("ev-path-p1");
    });

    it("preserves limitations from both observations", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users", {
        limitations: ["Consumer dynamic header unresolved"]
      });
      const provider = createObservation("p1", "provider", "GET", "/api/users", {
        limitations: ["Provider middleware skipped"]
      });

      const relationships = matchCandidates([consumer, provider]);
      expect(relationships[0].limitations).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // 19. areRouteShapesEqual helper directly
  // --------------------------------------------------------------------------
  describe("19. areRouteShapesEqual direct evaluation", () => {
    it("returns true for identical static routes", () => {
      const r1 = normalizeRoute("/api/users");
      const r2 = normalizeRoute("/api/users");
      expect(areRouteShapesEqual(r1, r2)).toBe(true);
    });

    it("returns true for matching parameter positions with different names", () => {
      const r1 = normalizeRoute("/api/users/:id");
      const r2 = normalizeRoute("/api/users/:userId");
      expect(areRouteShapesEqual(r1, r2)).toBe(true);
    });

    it("returns false for different segment counts", () => {
      const r1 = normalizeRoute("/api/users");
      const r2 = normalizeRoute("/api/users/profile");
      expect(areRouteShapesEqual(r1, r2)).toBe(false);
    });

    it("returns false when a static segment differs", () => {
      const r1 = normalizeRoute("/api/v1/users");
      const r2 = normalizeRoute("/api/v2/users");
      expect(areRouteShapesEqual(r1, r2)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 20. ContractMatcher class instantiation
  // --------------------------------------------------------------------------
  describe("20. ContractMatcher class API", () => {
    it("supports class instantiation and match() call", () => {
      const matcher = new ContractMatcher();
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const result = matcher.match([consumer, provider]);
      expect(result).toHaveLength(1);
      expect(result[0].matchKind).toBe("exact");
    });
  });

  // --------------------------------------------------------------------------
  // 21. Trailing-slash semantics and uncertainty preservation (LLD 9.1 Rule 8)
  // --------------------------------------------------------------------------
  describe("21. Trailing-slash semantics and uncertainty preservation", () => {
    it("reports no trailing-slash difference when both sides have trailingSlash: 'present'", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.reasons).toEqual([
        "Exact match on normalized HTTP method and route pattern shape"
      ]);
      expect(rel.limitations).toHaveLength(0);
      expect(rel.findingIds).toHaveLength(0);
    });

    it("reports no trailing-slash difference when both sides have trailingSlash: 'absent'", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.reasons).toEqual([
        "Exact match on normalized HTTP method and route pattern shape"
      ]);
      expect(rel.limitations).toHaveLength(0);
    });

    it("records known trailing-slash difference when present vs absent", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.reasons).toHaveLength(2);
      expect(rel.reasons[0]).toContain("Exact match");
      expect(rel.reasons[1]).toBe(
        "Known trailing-slash difference: consumer path trailing slash is 'present', but provider path trailing slash is 'absent'"
      );
      expect(rel.limitations).toHaveLength(0);
      expect(rel.findingIds).toHaveLength(0);
    });

    it("records known trailing-slash difference when absent vs present (reverse)", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.reasons[1]).toBe(
        "Known trailing-slash difference: consumer path trailing slash is 'absent', but provider path trailing slash is 'present'"
      );
      expect(rel.limitations).toHaveLength(0);
    });

    it("preserves unresolved trailing-slash uncertainty when present vs unknown", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");
      expect(rel.reasons[1]).toBe(
        "Trailing-slash compatibility is unresolved: consumer path trailing slash is 'present', provider path trailing slash is 'unknown'"
      );
      expect(rel.limitations).toHaveLength(1);
      expect(rel.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
      expect(rel.limitations[0].message).toContain("Trailing-slash compatibility is unresolved");
      expect(rel.findingIds).toHaveLength(0);
    });

    it("preserves unresolved trailing-slash uncertainty when unknown vs present (reverse)", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.reasons[1]).toBe(
        "Trailing-slash compatibility is unresolved: consumer path trailing slash is 'unknown', provider path trailing slash is 'present'"
      );
      expect(rel.limitations).toHaveLength(1);
      expect(rel.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("preserves unresolved trailing-slash uncertainty when absent vs unknown", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.reasons[1]).toBe(
        "Trailing-slash compatibility is unresolved: consumer path trailing slash is 'absent', provider path trailing slash is 'unknown'"
      );
      expect(rel.limitations).toHaveLength(1);
      expect(rel.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("does not assume equal unknown states prove compatibility when both are unknown", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.reasons[1]).toBe(
        "Trailing-slash compatibility is unresolved: both consumer and provider have unknown trailing-slash metadata"
      );
      expect(rel.limitations).toHaveLength(1);
      expect(rel.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("records trailing-slash difference in method-conflict relationships", () => {
      const c = createObservation(
        "c1",
        "consumer",
        "POST",
        createRoutePatternWithSlash("/api/users", "present")
      );
      const p = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "absent")
      );

      const relationships = matchCandidates([c, p]);
      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("method-conflict");
      expect(rel.reasons[0]).toContain("Method conflict");
      expect(rel.reasons[1]).toContain("Known trailing-slash difference");
    });

    it("preserves trailing-slash uncertainty across input reordering", () => {
      const c1 = createObservation(
        "c1",
        "consumer",
        "GET",
        createRoutePatternWithSlash("/api/users", "present")
      );
      const p1 = createObservation(
        "p1",
        "provider",
        "GET",
        createRoutePatternWithSlash("/api/users", "unknown")
      );
      const c2 = createObservation(
        "c2",
        "consumer",
        "POST",
        createRoutePatternWithSlash("/api/items", "absent")
      );
      const p2 = createObservation(
        "p2",
        "provider",
        "POST",
        createRoutePatternWithSlash("/api/items", "present")
      );

      const res1 = matchCandidates([c1, p1, c2, p2]);
      const res2 = matchCandidates([p2, c2, p1, c1]);

      expect(res1).toEqual(res2);
      expect(res1).toHaveLength(2);
      expect(res1[0].reasons[1]).toMatch(/trailing-slash/i);
      expect(res1[1].reasons[1]).toMatch(/trailing-slash/i);
    });
  });

  // --------------------------------------------------------------------------
  // 22. Missing or unknown path observations
  // --------------------------------------------------------------------------
  describe("22. Missing or unknown path observations", () => {
    it("does not produce exact match when consumer path observation is missing/unknown", () => {
      const consumer = createObservation("c1", "consumer", "GET", undefined);
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const exactMatches = relationships.filter((r) => r.matchKind === "exact");
      expect(exactMatches).toHaveLength(0);

      const cRel = relationships.find((r) => r.consumerId === "c1");
      expect(cRel?.matchKind).toBe("unmatched");
      expect(cRel?.state).toBe("discovered");
      expect(cRel?.reasons[0]).toBe("No compatible provider found in analyzed scope");

      const pRel = relationships.find((r) => r.providerId === "p1");
      expect(pRel?.matchKind).toBe("unmatched");
      expect(pRel?.state).toBe("orphaned");
    });

    it("does not produce exact match when provider path observation is missing/unknown", () => {
      const consumer = createObservation("c1", "consumer", "GET", "/api/users");
      const provider = createObservation("p1", "provider", "GET", undefined);

      const relationships = matchCandidates([consumer, provider]);
      const exactMatches = relationships.filter((r) => r.matchKind === "exact");
      expect(exactMatches).toHaveLength(0);

      const cRel = relationships.find((r) => r.consumerId === "c1");
      expect(cRel?.matchKind).toBe("unmatched");
      expect(cRel?.state).toBe("discovered");

      const pRel = relationships.find((r) => r.providerId === "p1");
      expect(pRel?.matchKind).toBe("unmatched");
      expect(pRel?.state).toBe("orphaned");
    });

    it("does not produce method conflict when path is missing even if methods differ", () => {
      const consumer = createObservation("c1", "consumer", "POST", undefined);
      const provider = createObservation("p1", "provider", "GET", "/api/users");

      const relationships = matchCandidates([consumer, provider]);
      const methodConflicts = relationships.filter((r) => r.matchKind === "method-conflict");
      expect(methodConflicts).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 23. assessTrailingSlashCompatibility direct unit tests
  // --------------------------------------------------------------------------
  describe("23. assessTrailingSlashCompatibility direct evaluation", () => {
    it("returns empty reasons and limitations for identical known trailing slash", () => {
      const r1 = createRoutePatternWithSlash("/api/users", "present");
      const r2 = createRoutePatternWithSlash("/api/users", "present");
      expect(assessTrailingSlashCompatibility(r1, r2)).toEqual({
        reasons: [],
        limitations: []
      });

      const r3 = createRoutePatternWithSlash("/api/users", "absent");
      const r4 = createRoutePatternWithSlash("/api/users", "absent");
      expect(assessTrailingSlashCompatibility(r3, r4)).toEqual({
        reasons: [],
        limitations: []
      });
    });

    it("returns explicit reason for present vs absent", () => {
      const r1 = createRoutePatternWithSlash("/api/users", "present");
      const r2 = createRoutePatternWithSlash("/api/users", "absent");
      const res = assessTrailingSlashCompatibility(r1, r2);
      expect(res.reasons).toHaveLength(1);
      expect(res.reasons[0]).toContain("Known trailing-slash difference");
      expect(res.limitations).toHaveLength(0);
    });

    it("returns unresolved warning for unknown trailing slash", () => {
      const r1 = createRoutePatternWithSlash("/api/users", "present");
      const r2 = createRoutePatternWithSlash("/api/users", "unknown");
      const res = assessTrailingSlashCompatibility(r1, r2);
      expect(res.reasons[0]).toContain("Trailing-slash compatibility is unresolved");
      expect(res.limitations).toHaveLength(1);
      expect(res.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });
  });
});
