// Phase 2, Chunk 2.3: Support Matrix Unit Tests.
// Verifies support matrix structure, documented pattern definitions, distinction
// between planned and implemented patterns, and query helpers.

import { describe, expect, it } from "vitest";
import {
  SUPPORT_MATRIX,
  getImplementedPatterns,
  getPatternsByFramework,
  getPatternsByRole,
  getPlannedPatterns,
  getSupportMatrix,
  type SupportMatrixEntry
} from "../../packages/analyzer-js-ts/src/index";

describe("Support Matrix (Chunk 2.3)", () => {
  describe("1. Matrix Schema and Field Integrity", () => {
    it("contains documented pattern entries", () => {
      const matrix = getSupportMatrix();
      expect(matrix.length).toBeGreaterThan(0);
      expect(matrix).toBe(SUPPORT_MATRIX);
    });

    it("ensures every entry conforms to the LLD Section 7.7 schema", () => {
      for (const entry of SUPPORT_MATRIX) {
        expect(typeof entry.patternId).toBe("string");
        expect(entry.patternId.trim().length).toBeGreaterThan(0);

        expect(["consumer", "provider"]).toContain(entry.sourceRole);
        expect(typeof entry.supportedLanguage).toBe("string");
        expect(typeof entry.supportedFramework).toBe("string");

        expect(Array.isArray(entry.examples)).toBe(true);
        expect(entry.examples.length).toBeGreaterThan(0);

        expect(Array.isArray(entry.fieldsReliablyExtracted)).toBe(true);
        expect(entry.fieldsReliablyExtracted.length).toBeGreaterThan(0);

        expect(Array.isArray(entry.knownLimitations)).toBe(true);
        expect(entry.knownLimitations.length).toBeGreaterThan(0);

        expect(["direct", "resolved"]).toContain(entry.evidenceKind);
        expect(["planned", "implemented", "tested"]).toContain(entry.testStatus);
      }
    });

    it("contains unique pattern identifiers without duplicates", () => {
      const ids = SUPPORT_MATRIX.map((entry) => entry.patternId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("2. Planned vs. Implemented Capability Separation", () => {
    it("reports exactly 8 implemented/tested patterns at Phase 6 Chunk 6.1", () => {
      // Phase 6 Chunk 6.1 implements and tests fetch, axios, express, and nextjs patterns.
      const implemented = getImplementedPatterns();
      expect(implemented).toHaveLength(8);
      expect(implemented.map((p) => p.patternId)).toEqual([
        "fetch-standard-call",
        "fetch-standard-call-ts",
        "axios-method-call",
        "axios-method-call-ts",
        "express-route-declaration",
        "express-route-declaration-ts",
        "nextjs-app-router-route-handler",
        "nextjs-pages-router-api-route"
      ]);
    });

    it("catalogs 0 remaining target patterns as 'planned'", () => {
      const planned = getPlannedPatterns();
      expect(planned).toHaveLength(0);
    });

    it("confirms all documented framework patterns are tested", () => {
      const fetchPatterns = getPatternsByFramework("fetch");
      const axiosPatterns = getPatternsByFramework("axios");
      const expressPatterns = getPatternsByFramework("express");
      const nextjsPatterns = getPatternsByFramework("nextjs");

      expect(fetchPatterns.length).toBe(2);
      for (const pattern of fetchPatterns) {
        expect(pattern.testStatus).toBe("tested");
      }

      expect(axiosPatterns.length).toBe(2);
      for (const pattern of axiosPatterns) {
        expect(pattern.testStatus).toBe("tested");
      }

      expect(expressPatterns.length).toBe(2);
      for (const pattern of expressPatterns) {
        expect(pattern.testStatus).toBe("tested");
      }

      expect(nextjsPatterns.length).toBe(2);
      for (const pattern of nextjsPatterns) {
        expect(pattern.testStatus).toBe("tested");
      }
    });
  });

  describe("3. Query and Filtering Helpers", () => {
    it("filters patterns by framework case-insensitively", () => {
      const fetchLower = getPatternsByFramework("fetch");
      const fetchUpper = getPatternsByFramework("FETCH");

      expect(fetchLower.length).toBeGreaterThan(0);
      expect(fetchLower).toEqual(fetchUpper);

      for (const entry of fetchLower) {
        expect(entry.supportedFramework).toBe("fetch");
      }
    });

    it("returns empty array for an unsupported framework query", () => {
      expect(getPatternsByFramework("django")).toHaveLength(0);
      expect(getPatternsByFramework("spring")).toHaveLength(0);
    });

    it("filters patterns by role (consumer vs provider)", () => {
      const consumers = getPatternsByRole("consumer");
      const providers = getPatternsByRole("provider");

      expect(consumers.length).toBeGreaterThan(0);
      expect(providers.length).toBeGreaterThan(0);
      expect(consumers.length + providers.length).toBe(SUPPORT_MATRIX.length);

      for (const entry of consumers) {
        expect(entry.sourceRole).toBe("consumer");
      }
      for (const entry of providers) {
        expect(entry.sourceRole).toBe("provider");
      }
    });
  });
});
