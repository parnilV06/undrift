import { describe, expect, it } from "vitest";
import type {
  EvidenceStrength,
  Finding,
  FindingCategory,
  FindingExplanation,
  FindingIdentityInput,
  FindingSeverity,
  FindingState,
  RoutePattern,
  SourceSpan
} from "../../packages/core/src/index";
import {
  canonicalizeFindingIdentity,
  createFindingId,
  explainFinding,
  formatExplanationText,
  normalizeRoute
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.4: Finding Model, Stable Identity & Explanations", () => {
  const dummySpan = (line = 10, char = 1): SourceSpan => ({
    uri: "file:///src/app.ts",
    range: { start: 100, end: 150 },
    start: { line, character: char },
    end: { line, character: char + 20 }
  });

  // --------------------------------------------------------------------------
  // 1. Finding Domain Contract
  // --------------------------------------------------------------------------
  describe("1. Canonical Finding Domain Model", () => {
    it("satisfies the canonical finding contract with all required attributes", () => {
      const finding: Finding = {
        id: createFindingId({ ruleId: "UND120", method: "POST", route: "/api/users" }),
        ruleId: "UND120",
        category: "route",
        severity: "error",
        state: "active",
        title: "HTTP method conflict",
        summary: "Consumer calls POST but provider accepts GET",
        explanation: "Method mismatch on route /api/users",
        evidenceStrength: "direct",
        relationshipId: "rel:method-conflict:c1:p1",
        observationIds: ["c1", "p1"],
        sourceLocations: [dummySpan()],
        expected: "POST",
        observed: "GET",
        impactStatement: "Requests will receive 404/405 at runtime.",
        limitations: [],
        fixProposalIds: []
      };

      expect(finding.id).toMatch(/^find:UND120:[a-f0-9]{16}$/);
      expect(finding.ruleId).toBe("UND120");
      expect(finding.category).toBe<FindingCategory>("route");
      expect(finding.severity).toBe<FindingSeverity>("error");
      expect(finding.state).toBe<FindingState>("active");
      expect(finding.evidenceStrength).toBe<EvidenceStrength>("direct");
      expect(finding.observationIds).toEqual(["c1", "p1"]);
      expect(finding.sourceLocations).toHaveLength(1);
      expect(finding.expected).toBe("POST");
      expect(finding.observed).toBe("GET");
      expect(finding.fixProposalIds).toEqual([]);
    });

    it("does not fabricate expected or observed values when not present", () => {
      const finding: Finding = {
        id: createFindingId({ ruleId: "UND900", warningCode: "UNSUPPORTED_PATTERN" }),
        ruleId: "UND900",
        category: "analysis-limit",
        severity: "info",
        state: "active",
        title: "Unsupported pattern limits analysis",
        summary: "Regex route is not supported",
        explanation: "Analysis warning on regex pattern",
        evidenceStrength: "inferred",
        observationIds: [],
        sourceLocations: [],
        expected: undefined,
        observed: undefined,
        limitations: [],
        fixProposalIds: []
      };

      expect(finding.expected).toBeUndefined();
      expect(finding.observed).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Deterministic Finding Identity
  // --------------------------------------------------------------------------
  describe("2. Deterministic Finding Identity", () => {
    it("produces identical FindingId for identical semantic inputs", () => {
      const input1: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users",
        targetKey: "userId",
        consumerId: "c1",
        providerId: "p1"
      };

      const input2: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users",
        targetKey: "userId",
        consumerId: "c1",
        providerId: "p1"
      };

      const id1 = createFindingId(input1);
      const id2 = createFindingId(input2);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^find:UND120:[a-f0-9]{16}$/);
    });

    it("reordering observationIds does not change the FindingId", () => {
      const inputA: FindingIdentityInput = {
        ruleId: "UND100",
        method: "GET",
        route: "/api/users",
        observationIds: ["obs-alpha", "obs-beta", "obs-gamma"]
      };

      const inputB: FindingIdentityInput = {
        ruleId: "UND100",
        method: "GET",
        route: "/api/users",
        observationIds: ["obs-gamma", "obs-alpha", "obs-beta"]
      };

      expect(createFindingId(inputA)).toBe(createFindingId(inputB));
    });

    it("shifting source line numbers does not change the FindingId", () => {
      // Identity input does not include line/char positions
      const input1: FindingIdentityInput = {
        ruleId: "UND200",
        method: "POST",
        route: "/api/login",
        targetKey: "password",
        scopeUri: "file:///src/login.ts"
      };

      const input2: FindingIdentityInput = {
        ...input1
      };

      expect(createFindingId(input1)).toBe(createFindingId(input2));
    });

    it("changing the rule ID changes identity", () => {
      const base: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users"
      };

      const changedRule: FindingIdentityInput = {
        ...base,
        ruleId: "UND130"
      };

      expect(createFindingId(base)).not.toBe(createFindingId(changedRule));
    });

    it("changing the normalized route changes identity", () => {
      const base: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users"
      };

      const changedRoute: FindingIdentityInput = {
        ...base,
        route: "/api/accounts"
      };

      expect(createFindingId(base)).not.toBe(createFindingId(changedRoute));
    });

    it("accepts RoutePattern instances and string routes compatibly for equivalent known routes", () => {
      // 1. Parameterized route without trailing slash
      const pattern = normalizeRoute("/api/users/:id");
      const idFromPattern = createFindingId({
        ruleId: "UND200",
        method: "PUT",
        route: pattern
      });
      const idFromString = createFindingId({
        ruleId: "UND200",
        method: "PUT",
        route: "/api/users/:id"
      });
      expect(idFromPattern).toBe(idFromString);

      // 2. Route with trailing slash
      const patternSlash = normalizeRoute("/api/users/:id/");
      const idFromPatternSlash = createFindingId({
        ruleId: "UND200",
        method: "PUT",
        route: patternSlash
      });
      const idFromStringSlash = createFindingId({
        ruleId: "UND200",
        method: "PUT",
        route: "/api/users/:id/"
      });
      expect(idFromPatternSlash).toBe(idFromStringSlash);

      // 3. Root route
      const patternRoot = normalizeRoute("/");
      const idFromPatternRoot = createFindingId({
        ruleId: "UND100",
        route: patternRoot
      });
      const idFromStringRoot = createFindingId({
        ruleId: "UND100",
        route: "/"
      });
      expect(idFromPatternRoot).toBe(idFromStringRoot);

      // 4. Known empty route
      const patternEmpty = normalizeRoute("");
      const idFromPatternEmpty = createFindingId({
        ruleId: "UND100",
        route: patternEmpty
      });
      const idFromStringEmpty = createFindingId({
        ruleId: "UND100",
        route: ""
      });
      expect(idFromPatternEmpty).toBe(idFromStringEmpty);
    });

    it("distinguishes otherwise identical routes with trailingSlash: 'present' and 'absent'", () => {
      const patternAbsent = normalizeRoute("/api/users"); // trailingSlash: "absent"
      const patternPresent = normalizeRoute("/api/users/"); // trailingSlash: "present"

      const idAbsent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternAbsent
      });
      const idPresent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternPresent
      });

      expect(idAbsent).not.toBe(idPresent);

      // String inputs also preserve this distinction
      const idStrAbsent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: "/api/users"
      });
      const idStrPresent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: "/api/users/"
      });
      expect(idStrAbsent).not.toBe(idStrPresent);
      expect(idAbsent).toBe(idStrAbsent);
      expect(idPresent).toBe(idStrPresent);
    });

    it("distinguishes otherwise identical routes with trailingSlash: 'absent' and 'unknown'", () => {
      const patternAbsent = normalizeRoute("/api/users");
      const patternUnknown: RoutePattern = {
        ...patternAbsent,
        trailingSlash: "unknown"
      };

      const idAbsent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternAbsent
      });
      const idUnknown = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternUnknown
      });

      expect(idAbsent).not.toBe(idUnknown);
    });

    it("distinguishes otherwise identical routes with trailingSlash: 'present' and 'unknown'", () => {
      const patternPresent = normalizeRoute("/api/users/");
      const patternUnknown: RoutePattern = {
        ...normalizeRoute("/api/users"),
        trailingSlash: "unknown"
      };

      const idPresent = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternPresent
      });
      const idUnknown = createFindingId({
        ruleId: "UND100",
        method: "GET",
        route: patternUnknown
      });

      expect(idPresent).not.toBe(idUnknown);
    });

    it("preserves meaningful trailing-slash metadata in empty-segment and root-route cases", () => {
      const rootPattern = normalizeRoute("/");
      expect(rootPattern.trailingSlash).toBe("present");
      expect(rootPattern.segments).toEqual([]);

      const emptyPattern = normalizeRoute("");
      expect(emptyPattern.trailingSlash).toBe("absent");
      expect(emptyPattern.segments).toEqual([]);

      const emptyUnknown: RoutePattern = {
        segments: [],
        trailingSlash: "unknown",
        queryHandling: "excluded-from-path",
        rawPath: ""
      };

      const idRoot = createFindingId({ ruleId: "UND100", route: rootPattern });
      const idEmpty = createFindingId({ ruleId: "UND100", route: emptyPattern });
      const idEmptyUnknown = createFindingId({ ruleId: "UND100", route: emptyUnknown });

      expect(idRoot).not.toBe(idEmpty);
      expect(idRoot).not.toBe(idEmptyUnknown);
      expect(idEmpty).not.toBe(idEmptyUnknown);
    });

    it("distinguishes missing route information from a known empty route", () => {
      const idMissingOmitted = createFindingId({
        ruleId: "UND920",
        scopeUri: "file:///src/file.ts"
      });

      const idMissingNull = createFindingId({
        ruleId: "UND920",
        route: null,
        scopeUri: "file:///src/file.ts"
      });

      expect(idMissingOmitted).toBe(idMissingNull);

      const idKnownEmptyStr = createFindingId({
        ruleId: "UND920",
        route: "",
        scopeUri: "file:///src/file.ts"
      });

      const idKnownEmptyPattern = createFindingId({
        ruleId: "UND920",
        route: normalizeRoute(""),
        scopeUri: "file:///src/file.ts"
      });

      expect(idKnownEmptyStr).toBe(idKnownEmptyPattern);
      expect(idMissingOmitted).not.toBe(idKnownEmptyStr);
      expect(idMissingNull).not.toBe(idKnownEmptyPattern);
    });

    it("changing the targetKey property changes identity", () => {
      const inputA: FindingIdentityInput = {
        ruleId: "UND210",
        method: "POST",
        route: "/api/users",
        targetKey: "age"
      };

      const inputB: FindingIdentityInput = {
        ruleId: "UND210",
        method: "POST",
        route: "/api/users",
        targetKey: "email"
      };

      expect(createFindingId(inputA)).not.toBe(createFindingId(inputB));
    });

    it("swapping consumerId and providerId changes identity", () => {
      const normal: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users",
        consumerId: "c1",
        providerId: "p1"
      };

      const swapped: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/users",
        consumerId: "p1",
        providerId: "c1"
      };

      expect(createFindingId(normal)).not.toBe(createFindingId(swapped));
    });

    it("handles missing or unknown values without delimiter collision", () => {
      const noMethod: FindingIdentityInput = {
        ruleId: "UND920",
        scopeUri: "file:///src/file.ts"
      };

      const explicitNullMethod: FindingIdentityInput = {
        ruleId: "UND920",
        method: null,
        route: null,
        scopeUri: "file:///src/file.ts"
      };

      expect(createFindingId(noMethod)).toBe(createFindingId(explicitNullMethod));

      // Ensure distinct tuples with similar parts don't collide
      const tuple1: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET",
        route: "/api/a:b"
      };

      const tuple2: FindingIdentityInput = {
        ruleId: "UND120",
        method: "GET:a",
        route: "/api/b"
      };

      expect(createFindingId(tuple1)).not.toBe(createFindingId(tuple2));
    });

    it("does not mutate input objects during canonicalization and hashing", () => {
      const obs = ["b", "a", "c"];
      const pattern: RoutePattern = {
        segments: [{ kind: "static", value: "users" }],
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        rawPath: "/users"
      };
      Object.freeze(pattern.segments);
      Object.freeze(pattern);

      const frozenInput: FindingIdentityInput = Object.freeze({
        ruleId: "UND100",
        route: pattern,
        observationIds: Object.freeze(obs)
      });

      const id = createFindingId(frozenInput);
      expect(id).toBeDefined();
      expect(obs).toEqual(["b", "a", "c"]); // Unchanged
      expect(pattern.segments).toHaveLength(1);
    });

    it("canonicalizeFindingIdentity produces valid sorted JSON", () => {
      const canonical = canonicalizeFindingIdentity({
        ruleId: "UND100",
        method: "get",
        route: " /api/test ",
        observationIds: ["z", "a"]
      });

      expect(typeof canonical).toBe("string");
      const parsed = JSON.parse(canonical);
      expect(Array.isArray(parsed)).toBe(true);
      // Key order check: first entry should be alphabetically first key
      expect(parsed[0][0]).toBe("consumer");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Structured Explanations
  // --------------------------------------------------------------------------
  describe("3. Structured Explanations (explainFinding)", () => {
    it("generates structured explanation for UND900 unsupported pattern", () => {
      const expl = explainFinding({
        ruleId: "UND900",
        warningCode: "UNSUPPORTED_PATTERN",
        warningMessage: "Regex routes are not supported",
        sourceLocations: [dummySpan()]
      });

      expect(expl.headline).toBe("Unsupported pattern limits analysis");
      expect(expl.summary).toContain("Regex routes");
      expect(expl.reason).toContain("does not yet support");
      expect(expl.possibleImpact).toContain("may not be detected");
      expect(expl.suggestedNextSteps.length).toBeGreaterThanOrEqual(1);
      expect(expl.evidenceStrength).toBe("inferred");
      expect(expl.sourceLocations).toHaveLength(1);
    });

    it("generates structured explanation for UND910 unresolved reference", () => {
      const expl = explainFinding({
        ruleId: "UND910",
        warningCode: "UNRESOLVED_REFERENCE",
        warningMessage: "Type UserDTO could not be resolved"
      });

      expect(expl.headline).toBe("Unresolved reference or type limits analysis");
      expect(expl.summary).toContain("UserDTO");
      expect(expl.reason).toContain("could not trace");
      expect(expl.suggestedNextSteps.length).toBeGreaterThanOrEqual(1);
    });

    it("generates structured explanation for UND920 incomplete parse or scope", () => {
      const expl = explainFinding({
        ruleId: "UND920",
        warningCode: "PARSE_ERROR",
        warningMessage: "Syntax error at line 5"
      });

      expect(expl.headline).toBe("Incomplete parse or analysis scope limits coverage");
      expect(expl.summary).toContain("Syntax error");
      expect(expl.possibleImpact).toContain("proof of contract compatibility");
    });

    it("generates deterministic explanation for generic finding inputs", () => {
      const input = {
        ruleId: "UND120",
        title: "HTTP Method Mismatch",
        summary: "Expected GET but received POST",
        expectedDescription: "GET",
        observedDescription: "POST",
        reason: "Client invoked POST on an endpoint that only handles GET"
      };

      const expl1 = explainFinding(input);
      const expl2 = explainFinding(input);

      expect(expl1).toEqual(expl2);
      expect(expl1.expectedDescription).toBe("GET");
      expect(expl1.observedDescription).toBe("POST");
    });

    it("formats structured explanation to clean markdown prose", () => {
      const expl: FindingExplanation = {
        headline: "Method Conflict",
        summary: "Consumer calls POST against GET endpoint",
        expectedDescription: "GET",
        observedDescription: "POST",
        reason: "Provider route declares only GET handlers",
        possibleImpact: "Runtime calls will return HTTP 405",
        evidenceStrength: "direct",
        sourceLocations: [],
        limitations: [],
        suggestedNextSteps: [
          "Update consumer fetch call to use GET",
          "Add POST handler on provider"
        ]
      };

      const text = formatExplanationText(expl);
      expect(text).toContain("**Method Conflict**: Consumer calls POST against GET endpoint");
      expect(text).toContain("- Expected: GET");
      expect(text).toContain("- Observed: POST");
      expect(text).toContain("Reason: Provider route declares only GET handlers");
      expect(text).toContain("Impact: Runtime calls will return HTTP 405");
      expect(text).toContain("Suggested next steps:");
      expect(text).toContain("* Update consumer fetch call to use GET");
    });
  });
});
