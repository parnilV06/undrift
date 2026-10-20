import { describe, expect, it } from "vitest";
import type {
  AnalysisWarning,
  LimitationRuleId,
  LimitationWarningContext,
  SourceSpan
} from "../../packages/core/src/index";
import {
  evaluateLimitationRules,
  evaluateLimitationWarning,
  LIMITATION_RULE_IDS
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.4: Limitation Rules (UND900, UND910, UND920)", () => {
  const sampleSpan: SourceSpan = {
    uri: "file:///src/routes/users.ts",
    range: { start: 50, end: 120 },
    start: { line: 5, character: 1 },
    end: { line: 7, character: 25 }
  };

  // --------------------------------------------------------------------------
  // 1. UNSUPPORTED_PATTERN -> UND900
  // --------------------------------------------------------------------------
  describe("1. UND900: Unsupported Pattern", () => {
    it("maps UNSUPPORTED_PATTERN warning to UND900 finding", () => {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Express route with RegExp pattern is unsupported",
        source: sampleSpan,
        analyzerId: "express-extractor",
        affectsCompleteness: false
      };

      const finding = evaluateLimitationWarning({
        warning,
        observationId: "obs-route-1",
        relationshipId: "rel:exact:c1:p1"
      });

      expect(finding).toBeDefined();
      expect(finding!.ruleId).toBe<LimitationRuleId>("UND900");
      expect(finding!.category).toBe("analysis-limit");
      expect(finding!.severity).toBe("info"); // affectsCompleteness: false -> info
      expect(finding!.state).toBe("active");
      expect(finding!.title).toBe("Unsupported pattern limits analysis");
      expect(finding!.summary).toBe("Express route with RegExp pattern is unsupported");
      expect(finding!.observationIds).toEqual(["obs-route-1"]);
      expect(finding!.sourceLocations).toEqual([sampleSpan]);
      expect(finding!.relationshipId).toBe("rel:exact:c1:p1");
      expect(finding!.limitations).toEqual([warning]);
      expect(finding!.expected).toBeUndefined();
      expect(finding!.observed).toBeUndefined();
      expect(finding!.structuredExplanation).toBeDefined();
      expect(finding!.structuredExplanation?.headline).toBe("Unsupported pattern limits analysis");
    });

    it("assigns warning severity when affectsCompleteness is true", () => {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Dynamic controller mounting affects endpoint discovery",
        source: sampleSpan,
        affectsCompleteness: true
      };

      const finding = evaluateLimitationWarning({ warning });
      expect(finding?.severity).toBe("warning");
    });
  });

  // --------------------------------------------------------------------------
  // 2. UNRESOLVED_REFERENCE -> UND910
  // --------------------------------------------------------------------------
  describe("2. UND910: Unresolved Reference", () => {
    it("maps UNRESOLVED_REFERENCE warning to UND910 finding", () => {
      const warning: AnalysisWarning = {
        code: "UNRESOLVED_REFERENCE",
        message: "External type 'CreateUserPayload' could not be resolved",
        source: sampleSpan,
        affectsCompleteness: false
      };

      const finding = evaluateLimitationWarning({
        warning,
        observationId: "obs-type-1"
      });

      expect(finding).toBeDefined();
      expect(finding!.ruleId).toBe<LimitationRuleId>("UND910");
      expect(finding!.category).toBe("analysis-limit");
      expect(finding!.title).toBe("Type or reference unresolved");
      expect(finding!.summary).toContain("CreateUserPayload");
      expect(finding!.observationIds).toEqual(["obs-type-1"]);
      expect(finding!.evidenceStrength).toBe("direct");
      expect(finding!.structuredExplanation?.headline).toBe(
        "Unresolved reference or type limits analysis"
      );
    });

    it("assigns warning severity for completeness-affecting unresolved references", () => {
      const warning: AnalysisWarning = {
        code: "UNRESOLVED_REFERENCE",
        message: "Critical barrel export missing",
        affectsCompleteness: true
      };

      const finding = evaluateLimitationWarning({ warning });
      expect(finding?.severity).toBe("warning");
    });
  });

  // --------------------------------------------------------------------------
  // 3. PARSE_ERROR & INCOMPLETE_SCOPE -> UND920
  // --------------------------------------------------------------------------
  describe("3. UND920: Incomplete Parse or Scope", () => {
    it("maps PARSE_ERROR warning to UND920 finding with warning severity", () => {
      const warning: AnalysisWarning = {
        code: "PARSE_ERROR",
        message: "Syntax error: Unexpected token '}' at line 42",
        source: sampleSpan,
        affectsCompleteness: true
      };

      const finding = evaluateLimitationWarning({
        warning,
        uri: "file:///src/routes/users.ts"
      });

      expect(finding).toBeDefined();
      expect(finding!.ruleId).toBe<LimitationRuleId>("UND920");
      expect(finding!.category).toBe("analysis-limit");
      expect(finding!.severity).toBe("warning");
      expect(finding!.title).toBe("Parse error limits analysis coverage");
      expect(finding!.summary).toContain("Syntax error");
      expect(finding!.structuredExplanation?.headline).toBe(
        "Incomplete parse or analysis scope limits coverage"
      );
    });

    it("maps INCOMPLETE_SCOPE warning to UND920 finding", () => {
      const warning: AnalysisWarning = {
        code: "INCOMPLETE_SCOPE",
        message: "Max depth exceeded during folder scan",
        affectsCompleteness: true
      };

      const finding = evaluateLimitationWarning({ warning });
      expect(finding).toBeDefined();
      expect(finding!.ruleId).toBe<LimitationRuleId>("UND920");
      expect(finding!.severity).toBe("warning");
      expect(finding!.title).toBe("Incomplete analysis scope affects coverage");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Unrelated Warning Codes Not Fabricated Into Findings
  // --------------------------------------------------------------------------
  describe("4. Non-limitation warning rejection", () => {
    it("returns undefined for DYNAMIC_ROUTE warning", () => {
      const warning: AnalysisWarning = {
        code: "DYNAMIC_ROUTE",
        message: "Template literal route could not be evaluated statically",
        affectsCompleteness: false
      };

      expect(evaluateLimitationWarning({ warning })).toBeUndefined();
    });

    it("returns undefined for PARTIAL_SHAPE warning", () => {
      const warning: AnalysisWarning = {
        code: "PARTIAL_SHAPE",
        message: "Payload response inferred partially",
        affectsCompleteness: false
      };

      expect(evaluateLimitationWarning({ warning })).toBeUndefined();
    });

    it("returns undefined for CONFIGURATION_ERROR warning", () => {
      const warning: AnalysisWarning = {
        code: "CONFIGURATION_ERROR",
        message: "Invalid config setting",
        affectsCompleteness: false
      };

      expect(evaluateLimitationWarning({ warning })).toBeUndefined();
    });

    it("returns undefined for ANALYZER_FAILURE warning", () => {
      const warning: AnalysisWarning = {
        code: "ANALYZER_FAILURE",
        message: "Out of memory in sub-worker",
        affectsCompleteness: true
      };

      expect(evaluateLimitationWarning({ warning })).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 5. Batch Evaluation, Deduplication & Determinism
  // --------------------------------------------------------------------------
  describe("5. Batch Evaluation & Deduplication", () => {
    it("deduplicates identical warnings producing the same FindingId", () => {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Duplicate unsupported helper pattern",
        source: sampleSpan,
        affectsCompleteness: false
      };

      const ctx1: LimitationWarningContext = {
        warning,
        uri: "file:///src/routes/users.ts",
        observationId: "obs-1"
      };

      const ctx2: LimitationWarningContext = {
        warning,
        uri: "file:///src/routes/users.ts",
        observationId: "obs-1"
      };

      const findings = evaluateLimitationRules([ctx1, ctx2]);
      expect(findings).toHaveLength(1);
    });

    it("sorts findings deterministically by ID regardless of input order", () => {
      const w1: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Feature A not supported",
        affectsCompleteness: false
      };
      const w2: AnalysisWarning = {
        code: "UNRESOLVED_REFERENCE",
        message: "Reference B missing",
        affectsCompleteness: false
      };
      const w3: AnalysisWarning = {
        code: "PARSE_ERROR",
        message: "Parse error C",
        affectsCompleteness: true
      };

      const ctx1 = { warning: w1, uri: "file:///1.ts" };
      const ctx2 = { warning: w2, uri: "file:///2.ts" };
      const ctx3 = { warning: w3, uri: "file:///3.ts" };

      const run1 = evaluateLimitationRules([ctx1, ctx2, ctx3]);
      const run2 = evaluateLimitationRules([ctx3, ctx1, ctx2]);
      const run3 = evaluateLimitationRules([ctx2, ctx3, ctx1]);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
      expect(run1).toHaveLength(3);
    });

    it("ignores non-limitation warnings in batch evaluation", () => {
      const w1: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Unsupported style",
        affectsCompleteness: false
      };
      const w2: AnalysisWarning = {
        code: "PARTIAL_SHAPE",
        message: "Partial body",
        affectsCompleteness: false
      };
      const w3: AnalysisWarning = {
        code: "DYNAMIC_ROUTE",
        message: "Dynamic path",
        affectsCompleteness: false
      };

      const findings = evaluateLimitationRules([{ warning: w1 }, { warning: w2 }, { warning: w3 }]);

      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe(LIMITATION_RULE_IDS.UND900);
    });
  });
});
