// Phase 3, Chunk 3.9: Integration Verification & Golden Test Suite
// Verifies real parser adapter, JavaScript/TypeScript analyzer, normalization,
// candidate matching, rule engine, and analysis engine using representative fixture workspaces.

import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "../../packages/parser-tree-sitter/src/index";
import { JsTsAnalyzer } from "../../packages/analyzer-js-ts/src/index";
import {
  AnalysisEngine,
  reconcileState,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisSnapshot,
  type SourceDocument
} from "../../packages/core/src/index";
import { projectAnalysisResultForGolden } from "./golden-projector";

const WORKSPACES_DIR = path.resolve(__dirname, "../fixtures/workspaces");
const GOLDEN_DIR = path.resolve(__dirname, "../fixtures/golden");

describe("Phase 3, Chunk 3.9: Integration Verification & Golden Test Suite", () => {
  let parser: TreeSitterParserAdapter;
  let analyzer: JsTsAnalyzer;
  let engine: AnalysisEngine;

  beforeAll(() => {
    parser = new TreeSitterParserAdapter();
    analyzer = new JsTsAnalyzer();
    engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [analyzer]
    });
  });

  afterAll(() => {
    parser.dispose();
  });

  // Helper to load fixture workspace documents from disk
  function loadFixtureWorkspace(scenarioName: string): SourceDocument[] {
    const scenarioDir = path.join(WORKSPACES_DIR, scenarioName);
    const srcDir = path.join(scenarioDir, "src");
    if (!fs.existsSync(srcDir)) {
      throw new Error(`Fixture source directory not found: ${srcDir}`);
    }

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
    return files.map((fileName) => {
      const filePath = path.join(srcDir, fileName);
      const text = fs.readFileSync(filePath, "utf8");
      return {
        uri: `file:///workspace/src/${fileName}`,
        languageId: "typescript",
        text,
        contentHash: `hash-${fileName}`
      };
    });
  }

  // Helper to load reviewed golden JSON projection from disk
  function loadGoldenProjection(scenarioName: string): Record<string, unknown> {
    const goldenPath = path.join(GOLDEN_DIR, `${scenarioName}.golden.json`);
    if (!fs.existsSync(goldenPath)) {
      throw new Error(`Golden file not found: ${goldenPath}`);
    }
    return JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  }

  // Helper to run end-to-end analysis on a fixture workspace
  async function runWorkspaceAnalysis(
    scenarioName: string,
    workspaceIdOverride?: string
  ): Promise<AnalysisResult> {
    const documents = loadFixtureWorkspace(scenarioName);
    const request: AnalysisRequest = {
      workspaceId: workspaceIdOverride ?? `ws-${scenarioName}`,
      workspaceRootUris: ["file:///workspace"],
      generation: 1,
      documents,
      config: {},
      mode: "workspace"
    };
    return engine.analyze(request);
  }

  describe("1. Golden Projections & End-to-End Scenarios", () => {
    it("Scenario A: Valid exact match matches golden projection and emits zero findings", async () => {
      const result = await runWorkspaceAnalysis("valid-exact-match");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("valid-exact-match");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions
      expect(result.complete).toBe(true);
      expect(result.observations).toHaveLength(2);
      expect(result.relationships).toHaveLength(1);
      const rel = result.relationships[0];
      expect(rel.matchKind).toBe("exact");
      expect(rel.state).toBe("matched");

      // Explicit Negative Assertions
      expect(result.findings).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("Scenario B: Method conflict matches golden projection and produces UND120 without false UND100", async () => {
      const result = await runWorkspaceAnalysis("method-conflict");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("method-conflict");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions
      expect(result.complete).toBe(true);
      expect(result.relationships).toHaveLength(1);
      const rel = result.relationships[0];
      expect(rel.matchKind).toBe("method-conflict");
      expect(rel.state).toBe("matched");

      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.ruleId).toBe("UND120");
      expect(finding.category).toBe("route");
      expect(finding.severity).toBe("error");
      expect(finding.expected).toBe("GET");
      expect(finding.observed).toBe("POST");

      // Explicit Negative Assertion: Method conflict is distinguishable from missing provider
      const hasMissingProvider = result.findings.some((f) => f.ruleId === "UND100");
      expect(hasMissingProvider).toBe(false);
    });

    it("Scenario C: Suspected route mismatch matches golden projection and preserves inferred status", async () => {
      const result = await runWorkspaceAnalysis("suspected-route-mismatch");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("suspected-route-mismatch");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions
      expect(result.complete).toBe(true);
      expect(result.relationships).toHaveLength(1);
      const rel = result.relationships[0];
      expect(rel.matchKind).toBe("suspected-route-conflict");

      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.ruleId).toBe("UND130");
      expect(finding.category).toBe("route");
      expect(finding.severity).toBe("warning");
      expect(finding.evidenceStrength).toBe("inferred");
      expect(finding.expected).toBe("/api/users");
      expect(finding.observed).toBe("/api/user");

      // Explicit Negative Assertion: Does not emit high-confidence UND100 for the same consumer
      const hasUnd100 = result.findings.some((f) => f.ruleId === "UND100");
      expect(hasUnd100).toBe(false);
    });

    it("Scenario D: Shape drift matches golden projection and verifies directional type mismatch", async () => {
      const result = await runWorkspaceAnalysis("shape-drift");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("shape-drift");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions: Client expects string, Express provides number -> UND310
      expect(result.complete).toBe(true);
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0];
      expect(finding.ruleId).toBe("UND310");
      expect(finding.category).toBe("response-shape");
      expect(finding.severity).toBe("error");
      expect(finding.expected).toBe("string");
      expect(finding.observed).toBe("number");
      expect(finding.relationshipId).toBeDefined();

      // Source locations on both client and server sides
      expect(finding.sourceLocations).toHaveLength(2);
      expect(finding.sourceLocations.some((s) => s.uri.includes("client.ts"))).toBe(true);
      expect(finding.sourceLocations.some((s) => s.uri.includes("server.ts"))).toBe(true);
    });

    it("Scenario E: Ambiguous candidates preserves ambiguity and avoids premature collapse", async () => {
      const result = await runWorkspaceAnalysis("ambiguous-candidates");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("ambiguous-candidates");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions: 3 observations, 2 ambiguous relationships
      expect(result.complete).toBe(true);
      expect(result.observations).toHaveLength(3);
      expect(result.relationships).toHaveLength(2);
      for (const rel of result.relationships) {
        expect(rel.matchKind).toBe("ambiguous");
        expect(rel.state).toBe("unresolved");
      }

      // Explicit Negative Assertion: Ambiguous set does not emit false exact match or route mismatch
      expect(result.findings).toHaveLength(0);
    });

    it("Scenario F: Dynamic evidence preserves uncertainty and suppresses false contradictions", async () => {
      const result = await runWorkspaceAnalysis("dynamic-unresolved");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("dynamic-unresolved");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions
      expect(result.complete).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");
      expect(result.warnings[0].affectsCompleteness).toBe(true);

      const consumerObs = result.observations.find((o) => o.role === "consumer");
      expect(consumerObs?.endpoint.path.state).toBe("dynamic");

      // Explicit Negative Assertion: Unknown path does not produce confident mismatch or missing-provider findings
      expect(result.findings).toHaveLength(0);
    });

    it("Scenario G: Incomplete coverage gates absence findings and emits UND920", async () => {
      const result = await runWorkspaceAnalysis("incomplete-coverage");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("incomplete-coverage");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Positive Assertions
      expect(result.complete).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("PARSE_ERROR");
      expect(result.warnings[0].affectsCompleteness).toBe(true);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe("UND920");
      expect(result.findings[0].category).toBe("analysis-limit");

      // CRITICAL NEGATIVE ASSERTION: Incomplete backend scan MUST NOT claim provider is missing (UND100 gated)
      const hasMissingProvider = result.findings.some((f) => f.ruleId === "UND100");
      expect(hasMissingProvider).toBe(false);
    });

    it("Scenario H: Empty workspace negative control produces clean complete output", async () => {
      const result = await runWorkspaceAnalysis("empty-workspace");
      const projected = projectAnalysisResultForGolden(result);
      const golden = loadGoldenProjection("empty-workspace");

      // Golden comparison
      expect(projected).toEqual(golden);

      // Explicit Negative Assertions
      expect(result.complete).toBe(true);
      expect(result.observations).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
      expect(result.findings).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("2. Crucial Invariants and Negative Assertions", () => {
    it("Invariant: Completely unrelated routes are not matched through fuzzy string similarity", async () => {
      const doc1: SourceDocument = {
        uri: "file:///workspace/src/client.ts",
        languageId: "typescript",
        text: `import axios from "axios";\nexport const f = () => axios.get("/api/auth/login");\n`,
        contentHash: "h1"
      };
      const doc2: SourceDocument = {
        uri: "file:///workspace/src/server.ts",
        languageId: "typescript",
        text: `import express from "express";\nconst app = express();\napp.get("/api/products/catalog", (req, res) => res.json({}));\n`,
        contentHash: "h2"
      };

      const result = await engine.analyze({
        workspaceId: "ws-unrelated",
        workspaceRootUris: ["file:///workspace"],
        generation: 1,
        documents: [doc1, doc2],
        config: {},
        mode: "workspace"
      });

      // Both relationships are unmatched, no suspected match, no exact match
      expect(result.relationships.every((r) => r.matchKind === "unmatched")).toBe(true);
      const hasRouteMismatch = result.findings.some((f) => f.ruleId === "UND130");
      expect(hasRouteMismatch).toBe(false);
    });

    it("Invariant: Parameter-name difference alone does NOT become route drift", async () => {
      const doc1: SourceDocument = {
        uri: "file:///workspace/src/client.ts",
        languageId: "typescript",
        text: `import axios from "axios";\nexport const f = () => axios.get("/api/users/:id");\n`,
        contentHash: "h1"
      };
      const doc2: SourceDocument = {
        uri: "file:///workspace/src/server.ts",
        languageId: "typescript",
        text: `import express from "express";\nconst app = express();\napp.get("/api/users/:userId", (req, res) => res.json({ ok: true }));\n`,
        contentHash: "h2"
      };

      const result = await engine.analyze({
        workspaceId: "ws-params",
        workspaceRootUris: ["file:///workspace"],
        generation: 1,
        documents: [doc1, doc2],
        config: {},
        mode: "workspace"
      });

      // Parameter name difference (:id vs :userId) is structurally compatible under route-shape equality
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].matchKind).toBe("exact");
      expect(result.relationships[0].state).toBe("matched");
      expect(result.findings).toHaveLength(0);
    });

    it("Invariant: Extra response properties on provider do NOT create drift findings by default", async () => {
      const doc1: SourceDocument = {
        uri: "file:///workspace/src/client.ts",
        languageId: "typescript",
        text: `import axios from "axios";\nexport const f = () => axios.get("/api/data");\n`,
        contentHash: "h1"
      };
      const doc2: SourceDocument = {
        uri: "file:///workspace/src/server.ts",
        languageId: "typescript",
        text: `import express from "express";\nconst app = express();\napp.get("/api/data", (req, res) => {\n  res.json({ id: 1, extraFieldA: "val", extraFieldB: 99 });\n});\n`,
        contentHash: "h2"
      };

      const result = await engine.analyze({
        workspaceId: "ws-extra-fields",
        workspaceRootUris: ["file:///workspace"],
        generation: 1,
        documents: [doc1, doc2],
        config: {},
        mode: "workspace"
      });

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].matchKind).toBe("exact");
      // Extra response fields ignored by consumer do not create drift findings
      expect(result.findings).toHaveLength(0);
    });

    it("Invariant: Result projections remain 100% deterministic across repeated runs", async () => {
      const run1 = await runWorkspaceAnalysis("method-conflict");
      const run2 = await runWorkspaceAnalysis("method-conflict");

      const proj1 = projectAnalysisResultForGolden(run1);
      const proj2 = projectAnalysisResultForGolden(run2);

      expect(proj1).toEqual(proj2);
      expect(JSON.stringify(proj1)).toBe(JSON.stringify(proj2));
    });
  });

  describe("3. End-to-End Pipeline to Reconciliation Verification", () => {
    it("promotes complete verified result to AnalysisSnapshot and emits detected events", async () => {
      const result = await runWorkspaceAnalysis("method-conflict");
      const recon = reconcileState(result, undefined);

      expect(recon.coverageSufficient).toBe(true);
      expect(recon.currentSnapshot).toBeDefined();
      expect(recon.currentSnapshot?.findings).toHaveLength(1);
      expect(recon.eventsEmitted).toHaveLength(1);
      expect(recon.eventsEmitted[0].transitionKind).toBe("detected");
      expect(recon.eventsEmitted[0].findingId).toBe(result.findings[0].id);
    });

    it("preserves previous complete snapshot and suppresses false resolution when analysis is incomplete", async () => {
      // 1. Establish initial complete state with a finding from method-conflict in the same workspace
      const initialResult = await runWorkspaceAnalysis("method-conflict", "ws-evolution");
      const initialRecon = reconcileState(initialResult, undefined);
      const priorSnapshot = initialRecon.currentSnapshot!;
      expect(priorSnapshot.findings).toHaveLength(1);

      // 2. Subsequent run encounters incomplete coverage (syntax error in backend) in the same workspace
      const incompleteResult = await runWorkspaceAnalysis("incomplete-coverage", "ws-evolution");
      const recon = reconcileState(incompleteResult, priorSnapshot);

      // SAFETY INVARIANT VERIFIED:
      // Incomplete analysis must NEVER produce false resolution events or overwrite the previous snapshot
      expect(recon.coverageSufficient).toBe(false);
      expect(recon.eventsEmitted).toHaveLength(0); // ZERO false resolution events
      expect(recon.currentSnapshot).toBe(priorSnapshot); // Snapshot preserved intact
      expect(recon.currentSnapshot?.findings).toHaveLength(1);
    });
  });
});
