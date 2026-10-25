// Tests verifying regression requirements 10-17 of Phase 6 Chunk 6.1 Section 12:
// - Relevant source parse failure remains a genuine coverage limitation (Req 10)
// - Confirmed irrelevant/generated files excluded by default globs (Req 11)
// - Workspace source-acquisition failure marks scan incomplete (Req 12)
// - Incomplete analysis with an existing complete persisted finding preserves accepted snapshot intact (Req 13)
// - Incomplete analysis with no prior complete snapshot produces no fabricated snapshot (Req 14)
// - Positive provisional finding displayed separately from verified/persisted findings (Req 15)
// - No false resolution lifecycle transition on incomplete analysis (Req 16)
// - Warning source path, line/character, scope, completeness, and distinct finding vs coverage counts in report (Req 17)

import Module from "module";
import { describe, expect, it, vi } from "vitest";

const { mockVsCode } = vi.hoisted(() => {
  return {
    mockVsCode: {
      Position: class MockPosition {
        constructor(
          public line: number,
          public character: number
        ) {}
      },
      Range: class MockRange {
        constructor(
          public start: unknown,
          public end: unknown
        ) {}
      },
      Uri: { file: (p: string) => ({ fsPath: p, path: p, toString: () => p }) },
      ThemeIcon: class MockThemeIcon {
        constructor(public id: string) {}
      },
      ThemeColor: class MockThemeColor {
        constructor(public id: string) {}
      },
      TreeItem: class MockTreeItem {
        constructor(public label: string) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      ViewColumn: { One: 1, Two: 2 },
      window: {
        createWebviewPanel: vi.fn(),
        showTextDocument: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn()
      },
      workspace: {
        openTextDocument: vi.fn()
      },
      commands: {
        registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        executeCommand: vi.fn()
      }
    }
  };
});

vi.mock("vscode", () => mockVsCode);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCode;
  }
  return originalRequire.call(this, id, ...args);
};

import {
  AnalysisEngine,
  createFindingId,
  createObservationId,
  extractCoverageSummary,
  reconcileState,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalysisSnapshot,
  type AnalysisWarning,
  type ApiObservation,
  type Finding,
  type PersistedFindingRecord,
  type SourceDocument
} from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { DEFAULT_EXCLUDE_GLOBS } from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";
import {
  renderReportHtml,
  type ReportViewModel
} from "../../apps/vscode-extension/src/views/report-panel";
import type { DiagnosticFindingSource } from "../../apps/vscode-extension/src/diagnostics";

// Helper to check if a relative path matches exclude glob patterns
function matchesGlob(filePath: string, glob: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const cleanPattern = glob.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
  if (glob.startsWith("**/") && glob.endsWith("/**")) {
    return (
      normalizedPath.includes(`/${cleanPattern}/`) || normalizedPath.startsWith(`${cleanPattern}/`)
    );
  }
  if (glob.startsWith("**/") && glob.includes("*.")) {
    const ext = glob.slice(glob.lastIndexOf("."));
    return normalizedPath.endsWith(ext);
  }
  return normalizedPath.includes(cleanPattern);
}

describe("Phase 6.1 V1 Coverage and Reporting Regressions (Items 10-17)", () => {
  const engine = new AnalysisEngine({
    parsers: [new TreeSitterParserAdapter()],
    analyzers: [new JsTsAnalyzer()]
  });

  it("10. Relevant source parse failure remains a genuine coverage limitation", async () => {
    // When a backend source document fails to parse, it must be flagged with PARSE_ERROR,
    // affectsCompleteness: true, and scope: "provider", suppressing absence-based findings.
    const invalidDoc: SourceDocument = {
      uri: "src/server/broken.ts",
      languageId: "typescript",
      text: "export function broken( { syntax error ??? <<< >>>",
      contentHash: "hash-broken"
    };

    const consumerDoc: SourceDocument = {
      uri: "src/client/api.ts",
      languageId: "typescript",
      text: `
        export async function getMissing() {
          const res = await fetch("/api/missing-route");
          return res.json();
        }
      `,
      contentHash: "hash-consumer"
    };

    const request: AnalysisRequest = {
      workspaceId: "ws:parse-failure",
      workspaceRootUris: ["."],
      generation: 1,
      documents: [invalidDoc, consumerDoc],
      mode: "workspace"
    };

    const result = await engine.analyze(request);

    // Parse failure must mark analysis incomplete
    const coverage = extractCoverageSummary(result);
    expect(result.complete).toBe(false);
    expect(coverage.complete).toBe(false);
    expect(coverage.backendComplete).toBe(false);

    // Warning is preserved as a genuine limitation
    const parseWarning = result.warnings.find((w) => w.code === "PARSE_ERROR");
    expect(parseWarning).toBeDefined();
    expect(parseWarning!.affectsCompleteness).toBe(true);
    expect(parseWarning!.scope).toBe("provider");

    // Incomplete backend scan must suppress absence-based UND100 (missing endpoint)
    expect(result.findings.some((f) => f.ruleId === "UND100")).toBe(false);
  });

  it("11. Confirmed irrelevant/generated files are excluded by default exclude globs", () => {
    // Generated Prisma files, build outputs, and node_modules must be excluded by default
    const testCases = [
      { path: "node_modules/@prisma/client/index.d.ts", shouldExclude: true },
      { path: ".prisma/client/runtime/library.js", shouldExclude: true },
      { path: "prisma/generated/client/index.ts", shouldExclude: true },
      { path: ".generated/api-types.ts", shouldExclude: true },
      { path: "dist/bundle.js", shouldExclude: true },
      { path: "src/api/users.ts", shouldExclude: false },
      { path: "src/backend/routes.ts", shouldExclude: false }
    ];

    for (const { path: testPath, shouldExclude } of testCases) {
      const isExcluded = DEFAULT_EXCLUDE_GLOBS.some((glob) => matchesGlob(testPath, glob));
      expect(isExcluded, `Expected path '${testPath}' exclusion to be ${shouldExclude}`).toBe(
        shouldExclude
      );
    }
  });

  it("12. Workspace source-acquisition / analyzer failure marks scan incomplete", async () => {
    // Create an engine with a failing analyzer to simulate source-acquisition or analysis failure
    const failingEngine = new AnalysisEngine({
      parsers: [new TreeSitterParserAdapter()],
      analyzers: [
        {
          id: "failing-backend-analyzer",
          languages: ["typescript"],
          supports: () => true,
          analyze: () => {
            throw new Error("Disk read failed or AST corrupted");
          }
        }
      ]
    });

    const doc: SourceDocument = {
      uri: "src/server/routes.ts",
      languageId: "typescript",
      text: "export const x = 1;",
      contentHash: "hash-doc"
    };

    const result = await failingEngine.analyze({
      workspaceId: "ws:failure",
      workspaceRootUris: ["."],
      generation: 1,
      documents: [doc],
      mode: "workspace"
    });

    const coverage = extractCoverageSummary(result);
    expect(result.complete).toBe(false);
    expect(coverage.complete).toBe(false);
    expect(coverage.backendComplete).toBe(false);
    const failureWarn = result.warnings.find((w) => w.code === "ANALYZER_FAILURE");
    expect(failureWarn).toBeDefined();
    expect(failureWarn!.affectsCompleteness).toBe(true);
    expect(failureWarn!.scope).toBe("provider");
  });

  it("13. Incomplete analysis with an existing complete persisted finding preserves accepted snapshot intact", () => {
    const findingId = createFindingId("UND120", "/api/auth/login", "POST");
    const existingRecord: PersistedFindingRecord = {
      id: findingId,
      finding: {
        id: findingId,
        ruleId: "UND120",
        category: "contract-violation",
        severity: "error",
        title: "HTTP method conflict",
        message: "Method conflict on /api/auth/login",
        state: "active",
        createdAt: 1000,
        updatedAt: 1000,
        expected: "POST",
        observed: "GET",
        evidence: [],
        locations: []
      },
      status: "open",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      seenCount: 1,
      verificationState: "verified"
    };

    const previousSnapshot: AnalysisSnapshot = {
      schemaVersion: "1.0.0",
      snapshotId: "snapshot:ws:test:1:1000",
      workspaceId: "ws:test",
      generation: 1,
      analyzedAt: 1000,
      coverage: {
        complete: true,
        backendComplete: true,
        consumerComplete: true,
        filesScanned: 2,
        filesWithWarnings: 0,
        unresolvedPatterns: 0,
        warnings: []
      },
      findings: [existingRecord]
    };

    // A subsequent analysis result is incomplete due to a warning
    const incompleteResult: AnalysisResult = {
      workspaceId: "ws:test",
      generation: 2,
      generatedAt: 2000,
      complete: false,
      observations: [],
      relationships: [],
      findings: [],
      warnings: [
        {
          code: "PARSE_ERROR",
          message: "Parse failed on syntax error",
          affectsCompleteness: true,
          scope: "workspace"
        }
      ],
      statistics: {
        filesConsidered: 2,
        filesParsed: 1,
        filesWithWarnings: 1,
        consumerObservations: 0,
        providerObservations: 0,
        relationships: 0,
        activeFindings: 0,
        unresolvedPatterns: 1,
        durationMs: 50
      }
    };

    const reconciliation = reconcileState(incompleteResult, previousSnapshot);

    // Incomplete analysis must not overwrite accepted snapshot or drop existing findings
    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.currentSnapshot).toBe(previousSnapshot);
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.unchangedFindingCount).toBe(1);
  });

  it("14. Incomplete analysis with no prior complete snapshot produces no fabricated snapshot", () => {
    const incompleteResult: AnalysisResult = {
      workspaceId: "ws:first-run-incomplete",
      generation: 1,
      generatedAt: 1000,
      complete: false,
      observations: [],
      relationships: [],
      findings: [],
      warnings: [
        {
          code: "DYNAMIC_ROUTE",
          message: "Dynamic route segment cannot be resolved",
          affectsCompleteness: true,
          scope: "consumer"
        }
      ],
      statistics: {
        filesConsidered: 1,
        filesParsed: 1,
        filesWithWarnings: 1,
        consumerObservations: 0,
        providerObservations: 0,
        relationships: 0,
        activeFindings: 0,
        unresolvedPatterns: 1,
        durationMs: 30
      }
    };

    const reconciliation = reconcileState(incompleteResult, undefined);

    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.currentSnapshot).toBeUndefined();
    expect(reconciliation.eventsEmitted).toHaveLength(0);
  });

  it("15. Positive provisional findings are displayed separately from verified/persisted findings", () => {
    // When an incomplete scan contains positive findings (e.g. an obvious UND120 method conflict),
    // they should be exposed as provisional findings without contaminating the verified/persisted snapshot.
    const provisionalFinding: DiagnosticFindingSource = {
      id: "finding:prov:1",
      ruleId: "UND120",
      category: "contract-violation",
      severity: "error",
      title: "Provisional HTTP method conflict",
      message: "Consumer calls POST, provider accepts GET",
      primaryLocation: {
        uri: "client/api.ts",
        start: { line: 10, character: 4 },
        end: { line: 10, character: 30 }
      },
      secondaryLocations: [],
      evidence: [],
      status: "open",
      verificationState: "unverified"
    };

    const model: ReportViewModel = {
      workspaceId: "ws:test",
      workspaceLabel: "Test Workspace",
      status: "unverified",
      findings: [], // accepted/verified findings from snapshot
      provisionalFindings: [provisionalFinding],
      history: [],
      warnings: [
        {
          code: "DYNAMIC_ROUTE",
          message: "Unresolved interpolation",
          affectsCompleteness: true,
          scope: "consumer"
        }
      ]
    };

    // Render HTML via exported renderReportHtml
    const html = renderReportHtml(model);

    // Verify presence of Provisional Findings section with unverified banner
    expect(html).toContain("Provisional Drift Findings from Latest Incomplete Analysis");
    expect(html).toContain("Provisional — Incomplete Scan");
    expect(html).toContain("Provisional HTTP method conflict");
    // Main accepted findings summary should indicate 0 verified active findings
    expect(html).toContain("Active Drift Findings");
  });

  it("16. Incomplete analysis does not emit false resolution lifecycle transitions", () => {
    const findingId = createFindingId("UND120", "/api/items", "DELETE");
    const activeRecord: PersistedFindingRecord = {
      id: findingId,
      finding: {
        id: findingId,
        ruleId: "UND120",
        category: "contract-violation",
        severity: "error",
        title: "HTTP method conflict",
        message: "Method conflict on /api/items",
        state: "active",
        createdAt: 1000,
        updatedAt: 1000,
        expected: "DELETE",
        observed: "POST",
        evidence: [],
        locations: []
      },
      status: "open",
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      seenCount: 1,
      verificationState: "verified"
    };

    const snapshot: AnalysisSnapshot = {
      schemaVersion: "1.0.0",
      snapshotId: "snapshot:ws:test:1:1000",
      workspaceId: "ws:test",
      generation: 1,
      analyzedAt: 1000,
      coverage: {
        complete: true,
        filesScanned: 2,
        filesWithWarnings: 0,
        unresolvedPatterns: 0,
        warnings: []
      },
      findings: [activeRecord]
    };

    // Scan has 0 observations and 0 findings (e.g. backend file failed to parse),
    // but has a completeness-affecting warning
    const incompleteResult: AnalysisResult = {
      workspaceId: "ws:test",
      generation: 2,
      generatedAt: 2000,
      complete: false,
      observations: [],
      relationships: [],
      findings: [],
      warnings: [
        {
          code: "PARSE_ERROR",
          message: "Parse failure in backend routes",
          affectsCompleteness: true,
          scope: "provider"
        }
      ],
      statistics: {
        filesConsidered: 2,
        filesParsed: 1,
        filesWithWarnings: 1,
        consumerObservations: 0,
        providerObservations: 0,
        relationships: 0,
        activeFindings: 0,
        unresolvedPatterns: 1,
        durationMs: 40
      }
    };

    const reconciliation = reconcileState(incompleteResult, snapshot);

    // Must NOT emit a "resolved" event!
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.eventsEmitted.some((e) => e.transitionKind === "resolved")).toBe(false);
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(1);
    expect(reconciliation.currentSnapshot?.findings[0].id).toBe(findingId);
  });

  it("17. Warning source path, line/character, scope, completeness, and distinct finding vs coverage counts are rendered in report", () => {
    const warning: AnalysisWarning = {
      code: "DYNAMIC_ROUTE",
      message: "Unsupported complex interpolation in Axios URL",
      source: {
        uri: "client/src/api/posts.ts",
        start: { line: 25, character: 12 },
        end: { line: 25, character: 45 }
      },
      scope: "consumer",
      affectsCompleteness: true
    };

    const finding: DiagnosticFindingSource = {
      id: "f:1",
      ruleId: "UND120",
      category: "contract-violation",
      severity: "error",
      title: "Method conflict on /api/posts",
      message: "Consumer calls POST, provider accepts GET",
      primaryLocation: {
        uri: "client/src/api/posts.ts",
        start: { line: 10, character: 4 },
        end: { line: 10, character: 30 }
      },
      secondaryLocations: [],
      evidence: [],
      status: "open",
      verificationState: "verified"
    };

    const model: ReportViewModel = {
      workspaceId: "ws:test",
      workspaceLabel: "Test App",
      status: "diverged",
      findings: [finding],
      history: [],
      warnings: [warning],
      coverage: {
        complete: false,
        backendComplete: true,
        consumerComplete: false,
        filesScanned: 5,
        filesWithWarnings: 1,
        unresolvedPatterns: 1,
        warnings: [warning]
      }
    };

    const html = renderReportHtml(model);

    // 1. Metric cards distinguish findings count from limitations count
    expect(html).toContain("Active Drift Findings");
    expect(html).toContain("Coverage Limitations");

    // 2. Limitations table contains exact code, message, readable location, scope, and affectsCompleteness
    expect(html).toContain("DYNAMIC_ROUTE");
    expect(html).toContain("Unsupported complex interpolation in Axios URL");
    expect(html).toContain("client/src/api/posts.ts:26:13");
    expect(html).toContain("consumer");
    expect(html).toContain("Yes");
  });
});
