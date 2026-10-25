// Programmatic integration tests verifying the V1 compatibility fixtures
// as specified in Phase 6 Chunk 6.1 Section 10 and 11.

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  AnalysisEngine,
  extractCoverageSummary,
  type AnalysisRequest,
  type SourceDocument
} from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";

function loadFixtureDoc(relativeFilePath: string): SourceDocument {
  const fullPath = path.resolve(__dirname, "../../examples/v1-compatibility", relativeFilePath);
  const text = fs.readFileSync(fullPath, "utf-8");
  return {
    uri: relativeFilePath.replace(/\\/g, "/"),
    languageId:
      relativeFilePath.endsWith(".ts") || relativeFilePath.endsWith(".tsx")
        ? "typescript"
        : "javascript",
    text,
    contentHash: "hash-" + relativeFilePath
  };
}

describe("V1 Compatibility Fixtures Programmatic Test Suite", () => {
  const engine = new AnalysisEngine({
    parsers: [new TreeSitterParserAdapter()],
    analyzers: [new JsTsAnalyzer()]
  });

  it("1. Fixture A (MERN stack): detects exact UND120 on /api/auth/login and has complete baseline coverage", async () => {
    const docs = [
      loadFixtureDoc("mern-stack/client/src/api/users.ts"),
      loadFixtureDoc("mern-stack/server/src/routes.ts")
    ];

    const request: AnalysisRequest = {
      workspaceId: "ws:mern-fixture",
      workspaceRootUris: ["mern-stack"],
      generation: 1,
      documents: docs,
      mode: "workspace"
    };

    const result = await engine.analyze(request);

    // Baseline coverage is clean and complete
    const coverage = extractCoverageSummary(result);
    expect(result.complete).toBe(true);
    expect(coverage.complete).toBe(true);
    expect(coverage.backendComplete).toBe(true);
    expect(coverage.consumerComplete).toBe(true);
    expect(result.warnings).toHaveLength(0);

    // Exactly one active drift finding: UND120 method conflict on /api/auth/login
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.ruleId).toBe("UND120");
    expect(finding.expected).toBe("POST");
    expect(finding.observed).toBe("GET");
    expect(finding.severity).toBe("error");
    expect(finding.title).toBe("HTTP method conflict");

    // Relationships show matches on /api/users, /api/posts/:id, and conflict on /api/auth/login
    const matchKinds = result.relationships.map((r) => r.matchKind).sort();
    expect(matchKinds).toContain("exact");
    expect(matchKinds).toContain("method-conflict");
  });

  it("2. Fixture B (PERN stack): detects exact UND120 on /api/items/:id and has complete baseline coverage", async () => {
    const docs = [
      loadFixtureDoc("pern-stack/src/frontend/items-client.ts"),
      loadFixtureDoc("pern-stack/src/backend/routes/items.ts"),
      loadFixtureDoc("pern-stack/src/backend/db/pool.ts")
    ];

    const request: AnalysisRequest = {
      workspaceId: "ws:pern-fixture",
      workspaceRootUris: ["pern-stack"],
      generation: 1,
      documents: docs,
      mode: "workspace"
    };

    const result = await engine.analyze(request);

    const coverage = extractCoverageSummary(result);
    expect(result.complete).toBe(true);
    expect(coverage.complete).toBe(true);
    expect(coverage.backendComplete).toBe(true);
    expect(coverage.consumerComplete).toBe(true);
    expect(result.warnings).toHaveLength(0);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.ruleId).toBe("UND120");
    expect(finding.expected).toBe("DELETE");
    expect(finding.observed).toBe("POST");
  });

  it("3. Fixture C (Next.js App Router): extracts route.ts named exports and detects exact UND120 on /api/products/:id", async () => {
    const docs = [
      loadFixtureDoc("nextjs-app-router/src/components/ProductList.tsx"),
      loadFixtureDoc("nextjs-app-router/src/app/api/products/route.ts"),
      loadFixtureDoc("nextjs-app-router/src/app/api/products/[id]/route.ts")
    ];

    const request: AnalysisRequest = {
      workspaceId: "ws:nextjs-app-fixture",
      workspaceRootUris: ["nextjs-app-router"],
      generation: 1,
      documents: docs,
      mode: "workspace"
    };

    const result = await engine.analyze(request);

    const coverage = extractCoverageSummary(result);
    expect(result.complete).toBe(true);
    expect(coverage.complete).toBe(true);
    expect(result.warnings).toHaveLength(0);

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.ruleId).toBe("UND120");
    expect(finding.expected).toBe("PUT");
    expect(finding.observed).toBe("DELETE");
  });

  it("4. Fixture D (Next.js Pages Router): matches switch-dispatched methods and flags ambiguous.ts limitation", async () => {
    // 4a. Clean subset: TodoView and todos.ts
    const cleanDocs = [
      loadFixtureDoc("nextjs-pages-router/src/components/TodoView.tsx"),
      loadFixtureDoc("nextjs-pages-router/src/pages/api/todos.ts")
    ];

    const cleanResult = await engine.analyze({
      workspaceId: "ws:nextjs-pages-clean",
      workspaceRootUris: ["nextjs-pages-router"],
      generation: 1,
      documents: cleanDocs,
      mode: "workspace"
    });

    const cleanCoverage = extractCoverageSummary(cleanResult);
    expect(cleanResult.complete).toBe(true);
    expect(cleanCoverage.complete).toBe(true);
    expect(cleanResult.warnings).toHaveLength(0);
    expect(cleanResult.findings).toHaveLength(1);
    expect(cleanResult.findings[0].ruleId).toBe("UND120");
    expect(cleanResult.findings[0].expected).toBe("POST");
    expect(cleanResult.findings[0].observed).toBe("PUT");

    // 4b. Ambiguous subset: including ambiguous.ts
    const allDocs = [
      ...cleanDocs,
      loadFixtureDoc("nextjs-pages-router/src/pages/api/ambiguous.ts")
    ];

    const resultWithAmbiguous = await engine.analyze({
      workspaceId: "ws:nextjs-pages-ambiguous",
      workspaceRootUris: ["nextjs-pages-router"],
      generation: 2,
      documents: allDocs,
      mode: "workspace"
    });

    // ambiguous.ts produces UNSUPPORTED_PATTERN warning for provider scope
    expect(resultWithAmbiguous.warnings.some((w) => w.code === "UNSUPPORTED_PATTERN")).toBe(true);
    const warn = resultWithAmbiguous.warnings.find((w) => w.code === "UNSUPPORTED_PATTERN")!;
    expect(warn.scope).toBe("provider");
    expect(warn.affectsCompleteness).toBe(true);
    // Method mismatch on todos is still detected!
    expect(resultWithAmbiguous.findings.some((f) => f.ruleId === "UND120")).toBe(true);
  });
});
