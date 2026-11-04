import { describe, expect, it } from "vitest";
import {
  getAllRuleGuidances,
  getDiagnosticGuidance,
  getWarningGuidance,
  LIMITATION_RULE_IDS,
  PROTOCOL_RULE_IDS,
  SHAPE_RULE_IDS,
  UND110_REFERENCE_GUIDANCE,
  type PartialShapeReasonCode,
  type WarningCode
} from "@undrift/core";

describe("Diagnostic Explanation & Resolution Guidance Registry", () => {
  it("provides comprehensive guidance for all 14 core diagnostic rules", () => {
    const allRuleIds = [
      ...Object.values(PROTOCOL_RULE_IDS),
      ...Object.values(SHAPE_RULE_IDS),
      ...Object.values(LIMITATION_RULE_IDS)
    ];

    expect(allRuleIds).toHaveLength(14);

    const guidances = getAllRuleGuidances();
    expect(guidances).toHaveLength(14);

    for (const ruleId of allRuleIds) {
      const guidance = getDiagnosticGuidance({ ruleId });
      expect(guidance.ruleCode).toBe(ruleId);
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.whatDetected.length).toBeGreaterThan(0);
      expect(guidance.whatItMeans.length).toBeGreaterThan(0);
      expect(guidance.whyItMatters.length).toBeGreaterThan(0);
      expect(guidance.whyNoAutomatedFix).toBeDefined();
      expect(guidance.whyNoAutomatedFix!.length).toBeGreaterThan(0);
      expect(guidance.suggestedSteps.length).toBeGreaterThanOrEqual(2);
      expect(["automatic", "guided", "investigation"]).toContain(guidance.resolutionMode);
    }
  });

  describe("UND110 Reference Implementation", () => {
    it("strictly satisfies the 7-step actionable guidance specification", () => {
      const guidance = getDiagnosticGuidance({ ruleId: "UND110" });

      expect(guidance.ruleCode).toBe("UND110");
      expect(guidance.title).toBe("Provider has no known consumer");
      expect(guidance.resolutionMode).toBe("investigation");

      // Clarifies that unmapped does NOT mean confirmed dead code
      expect(guidance.whatItMeans).toContain("This does NOT confirm dead code");
      expect(guidance.whatItMeans).toContain("external clients");

      // Explains why automated deletion or mock generation is unsafe
      expect(guidance.whyNoAutomatedFix).toContain("deleting unmapped routes");
      expect(guidance.whyNoAutomatedFix).toContain("unsafe");

      // Concise fields for compact presentation
      expect(guidance.conciseExplanation).toContain("This does not necessarily indicate dead code");
      expect(guidance.conciseFixUnavailableReason).toContain(
        "cannot determine whether this endpoint should be deleted"
      );

      // Exact 7 actionable resolution steps
      expect(guidance.suggestedSteps).toHaveLength(7);
      expect(guidance.suggestedSteps[0]).toContain("internal or external consumers");
      expect(guidance.suggestedSteps[1]).toContain("dynamic route invocations");
      expect(guidance.suggestedSteps[2]).toContain("work-in-progress or planned endpoint");
      expect(guidance.suggestedSteps[3]).toContain("decommissioning or archiving");
      expect(guidance.suggestedSteps[4]).toContain("frontend API client call");
      expect(guidance.suggestedSteps[5]).toContain("unsupported client library");
      expect(guidance.suggestedSteps[6]).toContain("path and method spelling");
    });

    it("matches the exported constant reference", () => {
      expect(UND110_REFERENCE_GUIDANCE.ruleCode).toBe("UND110");
      expect(UND110_REFERENCE_GUIDANCE.suggestedSteps).toHaveLength(7);
    });
  });

  describe("Contextual Interpolation", () => {
    it("interpolates method and route into UND100", () => {
      const g = getDiagnosticGuidance({
        ruleId: "UND100",
        method: "POST",
        route: "/api/creators"
      });
      expect(g.whatDetected).toContain("POST");
      expect(g.whatDetected).toContain("/api/creators");
    });

    it("interpolates method, route, and expected/observed into UND120", () => {
      const gWithFix = getDiagnosticGuidance({
        ruleId: "UND120",
        method: "POST",
        route: "/api/creators/[id]",
        expectedDescription: "POST",
        observedDescription: "GET",
        hasAutomatedFix: true
      });
      expect(gWithFix.whatDetected).toContain("POST");
      expect(gWithFix.whatDetected).toContain("GET");
      expect(gWithFix.whatDetected).toContain("/api/creators/[id]");
      expect(gWithFix.resolutionMode).toBe("automatic");
      expect(gWithFix.whyNoAutomatedFix).toContain("Automated repair proposals are available");

      const gWithoutFix = getDiagnosticGuidance({
        ruleId: "UND120",
        method: "POST",
        route: "/api/creators/[id]",
        hasAutomatedFix: false
      });
      expect(gWithoutFix.resolutionMode).toBe("guided");
      expect(gWithoutFix.whyNoAutomatedFix).toContain("ambiguity");
    });

    it("interpolates suspected typo segments into UND130", () => {
      const g = getDiagnosticGuidance({
        ruleId: "UND130",
        expectedDescription: "/api/creator",
        observedDescription: "/api/creators"
      });
      expect(g.whatDetected).toContain("/api/creator");
      expect(g.whatDetected).toContain("/api/creators");
    });

    it("interpolates targetKey into UND200 and UND210", () => {
      const g200 = getDiagnosticGuidance({
        ruleId: "UND200",
        targetKey: "email",
        route: "/api/users"
      });
      expect(g200.whatDetected).toContain("'email'");
      expect(g200.whatDetected).toContain("/api/users");

      const g210 = getDiagnosticGuidance({
        ruleId: "UND210",
        targetKey: "age",
        expectedDescription: "number",
        observedDescription: "string"
      });
      expect(g210.whatDetected).toContain("'age'");
      expect(g210.whatDetected).toContain("string");
      expect(g210.whatDetected).toContain("number");
    });

    it("interpolates targetKey into UND300, UND310, UND320, UND330", () => {
      const g300 = getDiagnosticGuidance({
        ruleId: "UND300",
        targetKey: "createdAt"
      });
      expect(g300.whatDetected).toContain("'createdAt'");

      const g310 = getDiagnosticGuidance({
        ruleId: "UND310",
        targetKey: "price",
        expectedDescription: "number",
        observedDescription: "string"
      });
      expect(g310.whatDetected).toContain("'price'");

      const g320 = getDiagnosticGuidance({
        ruleId: "UND320",
        targetKey: "metadata"
      });
      expect(g320.whatDetected).toContain("'metadata'");

      const g330 = getDiagnosticGuidance({
        ruleId: "UND330",
        targetKey: "profileUrl"
      });
      expect(g330.whatDetected).toContain("'profileUrl'");
    });

    it("falls back gracefully for unknown rule codes without throwing", () => {
      const fallback = getDiagnosticGuidance({
        ruleId: "UND999" as unknown as import("@undrift/core").RuleId,
        summary: "Custom unexpected rule"
      });
      expect(fallback.ruleCode).toBe("UND999");
      expect(fallback.title).toContain("UND999");
      expect(fallback.whatDetected).toBe("Custom unexpected rule");
      expect(fallback.resolutionMode).toBe("investigation");
      expect(fallback.suggestedSteps.length).toBeGreaterThan(0);
    });
  });

  describe("Warning & Limitation Guidance", () => {
    const warningCodes: WarningCode[] = [
      "DYNAMIC_ROUTE",
      "PARTIAL_SHAPE",
      "PARSE_ERROR",
      "UNSUPPORTED_PATTERN",
      "UNRESOLVED_REFERENCE",
      "INCOMPLETE_SCOPE",
      "CONFIGURATION_ERROR",
      "ANALYZER_FAILURE"
    ];

    it("provides guidance for all known WarningCode values", () => {
      for (const code of warningCodes) {
        const wg = getWarningGuidance(code);
        expect(wg.ruleCode).toBe(code);
        expect(wg.title.length).toBeGreaterThan(0);
        expect(wg.whatDetected.length).toBeGreaterThan(0);
        expect(wg.whatItMeans.length).toBeGreaterThan(0);
        expect(wg.suggestedSteps.length).toBeGreaterThanOrEqual(2);
      }
    });

    const partialShapeReasons: PartialShapeReasonCode[] = [
      "explicit-unknown-type",
      "explicit-any-type",
      "unannotated-parameter",
      "cross-module-forwarding",
      "no-caller-evidence",
      "multipart-no-construction-evidence",
      "multipart-partial-field-evidence",
      "dynamic-property",
      "unsupported-expression",
      "unresolved-reference"
    ];

    it("provides specific guidance for all 10 PartialShapeReasonCode values", () => {
      for (const reason of partialShapeReasons) {
        const wg = getWarningGuidance("PARTIAL_SHAPE", reason);
        expect(wg.ruleCode).toBe(`PARTIAL_SHAPE:${reason}`);
        expect(wg.title.length).toBeGreaterThan(0);
        expect(wg.whatDetected.length).toBeGreaterThan(0);
        expect(wg.whatItMeans.length).toBeGreaterThan(0);
        expect(wg.whyNoAutomatedFix).toBeDefined();
        expect(wg.suggestedSteps.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("falls back gracefully for unknown warning codes without throwing", () => {
      const fallback = getWarningGuidance("UNKNOWN_WARN" as unknown as WarningCode);
      expect(fallback.ruleCode).toBe("UNKNOWN_WARN");
      expect(fallback.title).toContain("UNKNOWN_WARN");
      expect(fallback.suggestedSteps.length).toBeGreaterThan(0);
    });
  });
});
