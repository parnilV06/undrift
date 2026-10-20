import { describe, expect, it } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisWarning,
  ApiObservation,
  Finding,
  HttpMethod,
  ObservationRole,
  RoutePattern,
  SourceSpan
} from "../../packages/core/src/index";
import {
  createFindingId,
  createRelationshipId,
  evaluateMethodConflictRule,
  evaluateMissingProviderRule,
  evaluateNoKnownConsumerRule,
  evaluateProtocolRules,
  evaluateRules,
  evaluateSuspectedRouteMismatchRule,
  matchCandidates,
  normalizeHttpMethod,
  normalizeRoute,
  PROTOCOL_RULE_IDS,
  resolveScopeCompleteness,
  RuleEngine
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.5: Endpoint Existence & Protocol Drift Rules", () => {
  // Helper to build realistic ApiObservation fixtures
  function createObs(
    id: string,
    role: ObservationRole,
    methodStr?: string,
    pathInput?: string | RoutePattern,
    options?: {
      line?: number;
      methodState?: "known" | "unknown";
      pathState?: "known" | "unknown";
      limitations?: AnalysisWarning[];
    }
  ): ApiObservation {
    const line = options?.line ?? 10;
    const normMethod = methodStr ? normalizeHttpMethod(methodStr) : undefined;
    const normPath = typeof pathInput === "string" ? normalizeRoute(pathInput) : pathInput;

    const span: SourceSpan = {
      uri: `file:///${role}/${id}.ts`,
      range: { start: 100, end: 150 },
      start: { line, character: 1 },
      end: { line, character: 25 }
    };

    return {
      id,
      role,
      languageId: "typescript",
      extractorId: role === "consumer" ? "fetch-extractor" : "express-extractor",
      source: [span],
      snapshot: { uri: `file:///${role}/${id}.ts`, contentHash: "hash123" },
      endpoint: {
        method:
          normMethod && options?.methodState !== "unknown"
            ? {
                state: "known",
                value: normMethod,
                strength: "direct",
                evidence: [
                  {
                    id: `ev-m-${id}`,
                    kind: "explicit-annotation",
                    strength: "direct",
                    source: span
                  }
                ]
              }
            : {
                state: "unknown",
                reason: "missing or unresolved method",
                evidence: []
              },
        path:
          normPath && options?.pathState !== "unknown"
            ? {
                state: "known",
                value: normPath,
                strength: "direct",
                evidence: [
                  {
                    id: `ev-p-${id}`,
                    kind: "literal-syntax",
                    strength: "direct",
                    source: span
                  }
                ]
              }
            : {
                state: "unknown",
                reason: "missing or unresolved route",
                evidence: []
              }
      },
      limitations: options?.limitations ?? []
    };
  }

  // --------------------------------------------------------------------------
  // 1. UND100: Missing Provider
  // --------------------------------------------------------------------------
  describe("1. UND100: Missing Provider", () => {
    it("1. generates UND100 for a known consumer with no provider in sufficiently complete scope", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/users");
      const findings = evaluateProtocolRules({
        observations: [consumer],
        context: { backendScanComplete: true }
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.ruleId).toBe(PROTOCOL_RULE_IDS.UND100);
      expect(f.category).toBe("existence");
      expect(f.severity).toBe("warning");
      expect(f.state).toBe("active");
      expect(f.title).toBe("No compatible provider found");
      expect(f.summary).toContain("No compatible provider found in the analyzed scope");
      expect(f.summary).toContain("GET /api/users");
      expect(f.expected).toBe("GET /api/users");
      expect(f.observed).toBeUndefined();
      expect(f.observationIds).toEqual(["c1"]);
      expect(f.sourceLocations).toHaveLength(1);
      expect(f.structuredExplanation?.headline).toBe(
        "No compatible provider found in the analyzed scope"
      );
    });

    it("2. suppresses duplicate UND100 for a consumer already explained by UND120 (method conflict)", () => {
      const consumer = createObs("c1", "consumer", "POST", "/api/users");
      const provider = createObs("p1", "provider", "GET", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true }
      });

      // Should emit UND120 (method conflict) but NOT UND100
      const und100 = findings.filter((f) => f.ruleId === "UND100");
      const und120 = findings.filter((f) => f.ruleId === "UND120");

      expect(und120).toHaveLength(1);
      expect(und100).toHaveLength(0);
      expect(und120[0].severity).toBe("error");
    });

    it("3. suppresses duplicate UND100 for a consumer already explained by UND130 (suspected route mismatch)", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/user");
      const provider = createObs("p1", "provider", "GET", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true }
      });

      // Should emit UND130 but NOT UND100
      const und100 = findings.filter((f) => f.ruleId === "UND100");
      const und130 = findings.filter((f) => f.ruleId === "UND130");

      expect(und130).toHaveLength(1);
      expect(und100).toHaveLength(0);
      expect(und130[0].severity).toBe("warning");
    });

    it("4. does not claim missing provider when backend coverage is incomplete", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/users");

      // Incomplete via explicit flag
      const findingsExplicit = evaluateProtocolRules({
        observations: [consumer],
        context: { backendScanComplete: false }
      });
      expect(findingsExplicit).toHaveLength(0);

      // Incomplete via coverage summary
      const coverage: AnalysisCoverageSummary = {
        complete: false,
        filesScanned: 5,
        filesWithWarnings: 2,
        unresolvedPatterns: 1,
        warnings: []
      };
      const findingsSummary = evaluateProtocolRules({
        observations: [consumer],
        context: { coverage }
      });
      expect(findingsSummary).toHaveLength(0);
    });

    it("5. does not emit false UND100 for unknown methods, unresolved routes, or ambiguous candidates", () => {
      // 5a. Consumer with unknown method
      const unknownMethodConsumer = createObs("c-unknown-m", "consumer", undefined, "/api/users", {
        methodState: "unknown"
      });
      expect(
        evaluateProtocolRules({
          observations: [unknownMethodConsumer],
          context: { backendScanComplete: true }
        })
      ).toHaveLength(0);

      // 5b. Consumer with unresolved dynamic route
      const unresolvedRoute = normalizeRoute("/api/${entity}");
      const unresolvedRouteConsumer = createObs(
        "c-unresolved-r",
        "consumer",
        "GET",
        unresolvedRoute
      );
      expect(
        evaluateProtocolRules({
          observations: [unresolvedRouteConsumer],
          context: { backendScanComplete: true }
        })
      ).toHaveLength(0);

      // 5c. Consumer with ambiguous provider candidates
      const consumerAmbiguous = createObs("c-ambig", "consumer", "GET", "/api/items");
      const provider1 = createObs("p1", "provider", "GET", "/api/items");
      const provider2 = createObs("p2", "provider", "GET", "/api/items");

      const findings = evaluateProtocolRules({
        observations: [consumerAmbiguous, provider1, provider2],
        context: { backendScanComplete: true }
      });
      // Ambiguous candidate must not emit confident missing provider
      expect(findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    });

    it("6. preserves correct consumer evidence, reason, finding ID, and explanation", () => {
      const consumer = createObs("c-evidence", "consumer", "DELETE", "/api/orders/:id");
      const findings = evaluateProtocolRules({
        observations: [consumer],
        context: { backendScanComplete: true }
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.id).toMatch(/^find:UND100:[a-f0-9]{16}$/);
      expect(f.sourceLocations[0].uri).toBe("file:///consumer/c-evidence.ts");
      expect(f.explanation).toContain("DELETE /api/orders/:id");
      expect(f.structuredExplanation?.suggestedNextSteps.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. UND110: Provider with No Known Consumer
  // --------------------------------------------------------------------------
  describe("2. UND110: Provider with No Known Consumer", () => {
    it("7. generates UND110 for a known provider with no consumer under complete coverage", () => {
      const provider = createObs("p1", "provider", "GET", "/api/health");
      const findings = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: true }
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.ruleId).toBe(PROTOCOL_RULE_IDS.UND110);
      expect(f.category).toBe("existence");
      expect(f.severity).toBe("info");
      expect(f.state).toBe("active");
      expect(f.title).toBe("Provider has no known consumer");
      expect(f.summary).toContain("No known consumer found in the analyzed scope");
      expect(f.summary).toContain("GET /api/health");
      expect(f.expected).toBeUndefined();
      expect(f.observed).toBe("GET /api/health");
      expect(f.observationIds).toEqual(["p1"]);
    });

    it("8. does not overclaim beyond the analyzed workspace scope", () => {
      const provider = createObs("p1", "provider", "GET", "/api/public/data");
      const findings = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: true }
      });

      expect(findings).toHaveLength(1);
      const explanation = findings[0].explanation;
      expect(explanation).toContain("External consumers, dynamic callers");
      expect(findings[0].structuredExplanation?.possibleImpact).toContain(
        "if it is intended for external clients, this notice can be safely ignored"
      );
    });

    it("9. behaves conservatively for unknown provider routes/methods and incomplete coverage", () => {
      // 9a. Incomplete coverage suppresses UND110
      const provider = createObs("p1", "provider", "GET", "/api/health");
      const findingsIncomplete = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: false }
      });
      expect(findingsIncomplete).toHaveLength(0);

      // 9b. Unknown route suppresses UND110
      const unresolvedRoute = normalizeRoute("/dynamic/${part}");
      const providerDynamicRoute = createObs("p2", "provider", "GET", unresolvedRoute);
      expect(
        evaluateProtocolRules({
          observations: [providerDynamicRoute],
          context: { consumerScanComplete: true }
        })
      ).toHaveLength(0);

      // 9c. Unknown method suppresses UND110
      const providerUnknownMethod = createObs("p3", "provider", undefined, "/api/health", {
        methodState: "unknown"
      });
      expect(
        evaluateProtocolRules({
          observations: [providerUnknownMethod],
          context: { consumerScanComplete: true }
        })
      ).toHaveLength(0);
    });

    it("10. preserves provider evidence, reason, finding ID, and explanation", () => {
      const provider = createObs("p-evidence", "provider", "PUT", "/api/settings");
      const findings = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: true }
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.id).toMatch(/^find:UND110:[a-f0-9]{16}$/);
      expect(f.sourceLocations[0].uri).toBe("file:///provider/p-evidence.ts");
      expect(f.structuredExplanation?.suggestedNextSteps.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. UND120: HTTP Method Conflict
  // --------------------------------------------------------------------------
  describe("3. UND120: HTTP Method Conflict", () => {
    it("11. generates UND120 error for conflicting known methods on the same structural route", () => {
      const consumer = createObs("c1", "consumer", "POST", "/api/users/:id");
      const provider = createObs("p1", "provider", "GET", "/api/users/:id");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.ruleId).toBe(PROTOCOL_RULE_IDS.UND120);
      expect(f.category).toBe("route");
      expect(f.severity).toBe("error");
      expect(f.expected).toBe("POST");
      expect(f.observed).toBe("GET");
      expect(f.observationIds).toEqual(["c1", "p1"]);
      expect(f.relationshipId).toBe("rel:method-conflict:c1:p1");
      expect(f.sourceLocations).toHaveLength(2);
      expect(f.summary).toContain(
        "Consumer calls POST on '/api/users/:id', but provider accepts GET"
      );
    });

    it("12. does not produce UND120 when method observation is missing or unresolved", () => {
      const consumer = createObs("c1", "consumer", undefined, "/api/users", {
        methodState: "unknown"
      });
      const provider = createObs("p1", "provider", "GET", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });
      expect(findings.filter((f) => f.ruleId === "UND120")).toHaveLength(0);
    });

    it("13. does not produce UND120 when method is unsupported", () => {
      const consumer = createObs("c1", "consumer", "CUSTOM_VERB", "/api/users");
      const provider = createObs("p1", "provider", "GET", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });
      expect(findings.filter((f) => f.ruleId === "UND120")).toHaveLength(0);
    });

    it("14. ambiguous competing candidates do not generate confident method-conflict finding", () => {
      const consumer = createObs("c1", "consumer", "POST", "/api/users");
      const provider1 = createObs("p1", "provider", "GET", "/api/users");
      const provider2 = createObs("p2", "provider", "DELETE", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider1, provider2]
      });
      // Ambiguous multiple conflicting providers must not produce confident UND120
      expect(findings.filter((f) => f.ruleId === "UND120")).toHaveLength(0);
    });

    it("15. a more specific UND120 finding suppresses duplicate UND100 for that consumer", () => {
      const consumer = createObs("c1", "consumer", "PATCH", "/api/profile");
      const provider = createObs("p1", "provider", "GET", "/api/profile");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true }
      });

      expect(findings.filter((f) => f.ruleId === "UND120")).toHaveLength(1);
      expect(findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. UND130: Suspected Route Mismatch
  // --------------------------------------------------------------------------
  describe("4. UND130: Suspected Route Mismatch", () => {
    it("16. generates UND130 warning for a valid suspected route mismatch from the matcher", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/user");
      const provider = createObs("p1", "provider", "GET", "/api/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.ruleId).toBe(PROTOCOL_RULE_IDS.UND130);
      expect(f.category).toBe("route");
      expect(f.severity).toBe("warning");
      expect(f.evidenceStrength).toBe("inferred");
      expect(f.expected).toBe("/api/user");
      expect(f.observed).toBe("/api/users");
      expect(f.observationIds).toEqual(["c1", "p1"]);
      expect(f.relationshipId).toBe("rel:suspected-route-conflict:c1:p1");
    });

    it("17. does not generate UND130 when candidate fails the 7-condition matcher policy", () => {
      // Differing by 2 static segments: /v1/user vs /v2/users -> Not suspected
      const consumer = createObs("c1", "consumer", "GET", "/v1/user");
      const provider = createObs("p1", "provider", "GET", "/v2/users");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });
      expect(findings.filter((f) => f.ruleId === "UND130")).toHaveLength(0);
    });

    it("18. ambiguous candidates remain ambiguous and do not generate UND130", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/account");
      const provider1 = createObs("p1", "provider", "GET", "/api/accounts");
      const provider2 = createObs("p2", "provider", "GET", "/api/accounting");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider1, provider2]
      });
      // Multiple candidates violate mutual uniqueness -> No UND130
      expect(findings.filter((f) => f.ruleId === "UND130")).toHaveLength(0);
    });

    it("19. preserves trailing-slash differences and limitations in suspected route mismatch", () => {
      const consumer = createObs("c1", "consumer", "GET", "/api/user/"); // trailingSlash: present
      const provider = createObs("p1", "provider", "GET", "/api/users"); // trailingSlash: absent

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.ruleId).toBe("UND130");
      // Finding explanation or limitations preserve trailing slash context
      expect(f.explanation).toContain("/api/user/");
      expect(f.explanation).toContain("/api/users");
    });

    it("20. suspected route mismatch suppresses duplicate UND100 for that consumer", () => {
      const consumer = createObs("c1", "consumer", "POST", "/api/organization");
      const provider = createObs("p1", "provider", "POST", "/api/organizations");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true }
      });

      expect(findings.filter((f) => f.ruleId === "UND130")).toHaveLength(1);
      expect(findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Identity, Determinism & Integration
  // --------------------------------------------------------------------------
  describe("5. Identity, Determinism & Integration", () => {
    it("21. reordering observations does not change FindingIds or result contents", () => {
      const c1 = createObs("c1", "consumer", "GET", "/api/missing");
      const p1 = createObs("p1", "provider", "POST", "/api/v2/orphaned");
      const c2 = createObs("c2", "consumer", "PUT", "/api/items");
      const p2 = createObs("p2", "provider", "PATCH", "/api/items");

      const findingsOrderA = evaluateProtocolRules({
        observations: [c1, p1, c2, p2],
        context: { backendScanComplete: true, consumerScanComplete: true }
      });

      const findingsOrderB = evaluateProtocolRules({
        observations: [p2, c2, p1, c1],
        context: { backendScanComplete: true, consumerScanComplete: true }
      });

      expect(findingsOrderA).toHaveLength(3); // UND100 (c1), UND110 (p1), UND120 (c2:p2)
      expect(findingsOrderA.map((f) => f.id)).toEqual(findingsOrderB.map((f) => f.id));
    });

    it("22. shifting source line numbers does not change FindingId", () => {
      const consumerLine10 = createObs("c1", "consumer", "GET", "/api/missing", { line: 10 });
      const consumerLine250 = createObs("c1", "consumer", "GET", "/api/missing", { line: 250 });

      const findingsA = evaluateProtocolRules({
        observations: [consumerLine10],
        context: { backendScanComplete: true }
      });

      const findingsB = evaluateProtocolRules({
        observations: [consumerLine250],
        context: { backendScanComplete: true }
      });

      expect(findingsA[0].id).toBe(findingsB[0].id);
    });

    it("23. different rules on the same endpoint remain distinct findings", () => {
      // UND100 on /api/users
      const cMissing = createObs("c1", "consumer", "GET", "/api/users");
      const [fMissing] = evaluateProtocolRules({
        observations: [cMissing],
        context: { backendScanComplete: true }
      });

      // UND120 on /api/users
      const cConflict = createObs("c2", "consumer", "GET", "/api/users");
      const pConflict = createObs("p2", "provider", "POST", "/api/users");
      const [fConflict] = evaluateProtocolRules({
        observations: [cConflict, pConflict]
      });

      expect(fMissing.id).not.toBe(fConflict.id);
      expect(fMissing.ruleId).toBe("UND100");
      expect(fConflict.ruleId).toBe("UND120");
    });

    it("24. preserves source evidence, role assignment, relationship IDs, limitations, and observations", () => {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Unusual header option",
        affectsCompleteness: false
      };

      const consumer = createObs("c1", "consumer", "POST", "/api/data", {
        limitations: [warning]
      });
      const provider = createObs("p1", "provider", "GET", "/api/data");

      const findings = evaluateProtocolRules({
        observations: [consumer, provider]
      });

      expect(findings).toHaveLength(1);
      const f = findings[0];
      expect(f.relationshipId).toBe("rel:method-conflict:c1:p1");
      expect(f.observationIds).toEqual(["c1", "p1"]);
      expect(f.sourceLocations).toHaveLength(2);
      expect(f.limitations).toContainEqual(warning);
    });

    it("25. handles multiple relationships sharing an observation with LLD suppression semantics", () => {
      // 1 consumer calls POST /api/users
      // 1 provider accepts GET /api/users (method conflict -> UND120)
      // 1 provider accepts POST /api/other (unmatched -> UND110)
      const c1 = createObs("c1", "consumer", "POST", "/api/users");
      const p1 = createObs("p1", "provider", "GET", "/api/users");
      const p2 = createObs("p2", "provider", "POST", "/api/other");

      const findings = evaluateProtocolRules({
        observations: [c1, p1, p2],
        context: { backendScanComplete: true, consumerScanComplete: true }
      });

      const ruleIds = findings.map((f) => f.ruleId);
      expect(ruleIds).toContain("UND120"); // c1:p1
      expect(ruleIds).toContain("UND110"); // p2
      expect(ruleIds).not.toContain("UND100"); // c1 is explained by UND120, not UND100
    });

    it("26. RuleEngine coordinates protocol rules and limitation rules together deterministically", () => {
      const engine = new RuleEngine();
      const consumer = createObs("c1", "consumer", "GET", "/api/missing");

      const warning: AnalysisWarning = {
        code: "PARSE_ERROR",
        message: "Syntax error in routes/index.ts",
        source: {
          uri: "file:///src/routes/index.ts",
          range: { start: 1, end: 10 },
          start: { line: 1, character: 1 },
          end: { line: 1, character: 10 }
        },
        affectsCompleteness: true
      };

      const findings = engine.evaluate({
        observations: [consumer],
        warnings: [warning],
        backendScanComplete: true
      });

      // Should have UND100 (protocol rule) and UND920 (limitation rule)
      const ruleIds = findings.map((f) => f.ruleId);
      expect(ruleIds).toContain("UND100");
      expect(ruleIds).toContain("UND920");

      // Verify evaluateRules helper function matches RuleEngine instance
      const helperFindings = evaluateRules({
        observations: [consumer],
        warnings: [warning],
        backendScanComplete: true
      });
      expect(helperFindings.map((f) => f.id)).toEqual(findings.map((f) => f.id));
    });

    it("27. empty relationship and observation inputs behave conservatively and return empty array", () => {
      expect(evaluateProtocolRules({ observations: [] })).toEqual([]);
      expect(evaluateProtocolRules([], [])).toEqual([]);
      expect(new RuleEngine().evaluate({ observations: [] })).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Conservative Coverage Gating Semantics (UND100 & UND110)
  // --------------------------------------------------------------------------
  describe("7. Conservative Coverage Gating Semantics (UND100 & UND110)", () => {
    const dummyCoverage = (complete: boolean): AnalysisCoverageSummary => ({
      complete,
      filesScanned: 10,
      filesWithWarnings: 1,
      unresolvedPatterns: 0,
      warnings: []
    });

    it("28. resolveScopeCompleteness helper handles all permutations of scopeFlag and coverageComplete strictly", () => {
      // 1. Unverified / omitted coverage defaults to false
      expect(resolveScopeCompleteness(undefined, undefined)).toBe(false);
      expect(resolveScopeCompleteness(undefined, false)).toBe(false);
      expect(resolveScopeCompleteness(undefined, true)).toBe(true);

      // 2. Explicit false scopeFlag always resolves to false
      expect(resolveScopeCompleteness(false, undefined)).toBe(false);
      expect(resolveScopeCompleteness(false, false)).toBe(false);
      expect(resolveScopeCompleteness(false, true)).toBe(false); // conflicting: false wins

      // 3. Explicit true scopeFlag requires coverage not to be false
      expect(resolveScopeCompleteness(true, undefined)).toBe(true);
      expect(resolveScopeCompleteness(true, false)).toBe(false); // conflicting: false wins
      expect(resolveScopeCompleteness(true, true)).toBe(true);
    });

    it("29. evaluateProtocolRules does not emit UND100 when context is omitted entirely", () => {
      const consumer = createObs("c-no-ctx", "consumer", "GET", "/api/items");
      const findings = evaluateProtocolRules({
        observations: [consumer]
      });
      expect(findings).toHaveLength(0);
    });

    it("30. evaluateProtocolRules does not emit UND110 when context is omitted entirely", () => {
      const provider = createObs("p-no-ctx", "provider", "GET", "/api/items");
      const findings = evaluateProtocolRules({
        observations: [provider]
      });
      expect(findings).toHaveLength(0);
    });

    it("31. empty context {} does not establish complete coverage for either absence rule", () => {
      const consumer = createObs("c-empty-ctx", "consumer", "GET", "/api/items");
      const provider = createObs("p-empty-ctx", "provider", "GET", "/api/items");

      expect(
        evaluateProtocolRules({
          observations: [consumer],
          context: {}
        })
      ).toHaveLength(0);

      expect(
        evaluateProtocolRules({
          observations: [provider],
          context: {}
        })
      ).toHaveLength(0);
    });

    it("32. explicit backendScanComplete: true permits UND100 when coverage is unconflicted", () => {
      const consumer = createObs("c-perm", "consumer", "GET", "/api/items");

      // Scope flag only
      const findingsFlag = evaluateProtocolRules({
        observations: [consumer],
        context: { backendScanComplete: true }
      });
      expect(findingsFlag).toHaveLength(1);
      expect(findingsFlag[0].ruleId).toBe("UND100");

      // Scope flag + coverage.complete: true
      const findingsBoth = evaluateProtocolRules({
        observations: [consumer],
        context: { backendScanComplete: true, coverage: dummyCoverage(true) }
      });
      expect(findingsBoth).toHaveLength(1);
      expect(findingsBoth[0].ruleId).toBe("UND100");

      // coverage.complete: true alone also establishes completeness
      const findingsCoverageOnly = evaluateProtocolRules({
        observations: [consumer],
        context: { coverage: dummyCoverage(true) }
      });
      expect(findingsCoverageOnly).toHaveLength(1);
      expect(findingsCoverageOnly[0].ruleId).toBe("UND100");
    });

    it("33. explicit consumerScanComplete: true permits UND110 when coverage is unconflicted", () => {
      const provider = createObs("p-perm", "provider", "GET", "/api/items");

      // Scope flag only
      const findingsFlag = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: true }
      });
      expect(findingsFlag).toHaveLength(1);
      expect(findingsFlag[0].ruleId).toBe("UND110");

      // Scope flag + coverage.complete: true
      const findingsBoth = evaluateProtocolRules({
        observations: [provider],
        context: { consumerScanComplete: true, coverage: dummyCoverage(true) }
      });
      expect(findingsBoth).toHaveLength(1);
      expect(findingsBoth[0].ruleId).toBe("UND110");

      // coverage.complete: true alone also establishes completeness
      const findingsCoverageOnly = evaluateProtocolRules({
        observations: [provider],
        context: { coverage: dummyCoverage(true) }
      });
      expect(findingsCoverageOnly).toHaveLength(1);
      expect(findingsCoverageOnly[0].ruleId).toBe("UND110");
    });

    it("34. conflicting signals favor incompleteness: backendScanComplete: true with coverage.complete: false suppresses UND100", () => {
      const consumer = createObs("c-conflict-b", "consumer", "GET", "/api/items");
      const findings = evaluateProtocolRules({
        observations: [consumer],
        context: {
          backendScanComplete: true,
          coverage: dummyCoverage(false)
        }
      });
      expect(findings).toHaveLength(0);
    });

    it("35. conflicting signals favor incompleteness: consumerScanComplete: true with coverage.complete: false suppresses UND110", () => {
      const provider = createObs("p-conflict-c", "provider", "GET", "/api/items");
      const findings = evaluateProtocolRules({
        observations: [provider],
        context: {
          consumerScanComplete: true,
          coverage: dummyCoverage(false)
        }
      });
      expect(findings).toHaveLength(0);
    });

    it("36. conflicting signals favor incompleteness: false scopeFlag overrides coverage.complete: true", () => {
      const consumer = createObs("c-override", "consumer", "GET", "/api/items");
      const provider = createObs("p-override", "provider", "GET", "/api/items");

      // Backend scope false overrides overall coverage true
      const findingsConsumer = evaluateProtocolRules({
        observations: [consumer],
        context: {
          backendScanComplete: false,
          coverage: dummyCoverage(true)
        }
      });
      expect(findingsConsumer).toHaveLength(0);

      // Consumer scope false overrides overall coverage true
      const findingsProvider = evaluateProtocolRules({
        observations: [provider],
        context: {
          consumerScanComplete: false,
          coverage: dummyCoverage(true)
        }
      });
      expect(findingsProvider).toHaveLength(0);
    });
  });
});
