// Phase 4, Chunk 4.2: Analysis Coordinator & Core Component Wiring Tests
// Verifies orchestration between WorkspaceManager, AnalysisEngine, and VS Code layer.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisStatistics,
  AnalysisWarning,
  Finding,
  ResolvedUndriftConfig,
  SourceDocument,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator, deriveWorkspaceId } from "../../apps/vscode-extension/src/activation";
import type { ExtensionLogger } from "../../apps/vscode-extension/src/logging";
import {
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike,
  WorkspaceManager,
  type WorkspaceSnapshotResult
} from "../../apps/vscode-extension/src/workspace";

class TestExtensionLogger implements ExtensionLogger {
  readonly logs: { level: string; msg: string; error?: unknown }[] = [];

  info(msg: string): void {
    this.logs.push({ level: "info", msg });
  }

  warn(msg: string, error?: unknown): void {
    this.logs.push({ level: "warn", msg, error });
  }

  error(msg: string, error?: unknown): void {
    this.logs.push({ level: "error", msg, error });
  }

  show(): void {}
  dispose(): void {}
}

function createSampleStatistics(): AnalysisStatistics {
  return {
    filesConsidered: 1,
    filesParsed: 1,
    filesWithWarnings: 0,
    consumerObservations: 1,
    providerObservations: 1,
    relationships: 1,
    activeFindings: 0,
    unresolvedPatterns: 0,
    durationMs: 10
  };
}

function createSampleAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    workspaceId: "file:///test/ws",
    generation: 1,
    generatedAt: Date.now(),
    complete: true,
    observations: [],
    relationships: [],
    findings: [],
    warnings: [],
    statistics: createSampleStatistics(),
    ...overrides
  };
}

function createMockEngine(
  impl?: (request: AnalysisRequest) => Promise<AnalysisResult>
): AnalysisEnginePort & { requests: AnalysisRequest[]; disposeCalled: number } {
  const requests: AnalysisRequest[] = [];
  let disposeCalled = 0;

  return {
    requests,
    get disposeCalled() {
      return disposeCalled;
    },
    analyze: async (req: AnalysisRequest) => {
      requests.push(req);
      if (impl) {
        return impl(req);
      }
      return createSampleAnalysisResult({
        workspaceId: req.workspaceId,
        generation: req.generation
      });
    },
    dispose: async () => {
      disposeCalled += 1;
    }
  };
}

function createMockWorkspaceManager(snapshotResult: WorkspaceSnapshotResult): WorkspaceManager {
  return {
    createWorkspaceSnapshot: async () => snapshotResult,
    getWorkspaceRoots: () => snapshotResult.workspaceRootUris
  } as unknown as WorkspaceManager;
}

describe("Phase 4, Chunk 4.2: AnalysisCoordinator", () => {
  let logger: TestExtensionLogger;

  beforeEach(() => {
    logger = new TestExtensionLogger();
  });

  // 1 & 2. Workspace snapshot is converted into the correct AnalysisRequest
  it("1 & 2. converts workspace snapshot into documented AnalysisRequest preserving documents, roots, config, and mode", async () => {
    const mockDocs: SourceDocument[] = [
      {
        uri: "file:///workspace/src/client.ts",
        languageId: "typescript",
        text: "console.log('client');",
        contentHash: "hash1"
      },
      {
        uri: "file:///workspace/src/server.ts",
        languageId: "typescript",
        text: "console.log('server');",
        contentHash: "hash2"
      }
    ];

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: ["file:///workspace"],
      documents: mockDocs,
      failures: [],
      totalDiscovered: 2,
      totalAcquired: 2
    });

    const mockEngine = createMockEngine();
    const customConfig: ResolvedUndriftConfig = {
      version: 1,
      include: ["src/**"]
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      config: customConfig,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.workspaceId).toBe("file:///workspace");
    expect(outcome.generation).toBe(1);
    expect(outcome.totalDiscovered).toBe(2);
    expect(outcome.totalAcquired).toBe(2);

    expect(mockEngine.requests).toHaveLength(1);
    const req = mockEngine.requests[0];
    expect(req.workspaceId).toBe("file:///workspace");
    expect(req.workspaceRootUris).toEqual(["file:///workspace"]);
    expect(req.generation).toBe(1);
    expect(req.documents).toEqual(mockDocs);
    expect(req.config).toEqual(customConfig);
    expect(req.mode).toBe("workspace");
  });

  // 3. Workspace identity is deterministic regardless of root ordering
  it("3. derives deterministic workspace identity regardless of root input ordering", () => {
    const rootsOrder1 = ["file:///workspace/b", "file:///workspace/a"];
    const rootsOrder2 = ["file:///workspace/a", "file:///workspace/b"];

    const id1 = deriveWorkspaceId(rootsOrder1);
    const id2 = deriveWorkspaceId(rootsOrder2);

    expect(id1).toBe(id2);
    expect(id1.startsWith("multi-root:")).toBe(true);

    // Single root normalization
    const single1 = deriveWorkspaceId(["file:///workspace/repo"]);
    const single2 = deriveWorkspaceId(["file:///workspace/repo/"]);
    expect(single1).toBe("file:///workspace/repo");
    expect(single2).toBe("file:///workspace/repo");

    // Empty roots reject
    expect(() => deriveWorkspaceId([])).toThrow();
  });

  // 4 & 5. Generation counter increment and workspace separation
  it("4 & 5. maintains monotonically increasing generation counters separated by workspace identity", async () => {
    const wsA = ["file:///workspace/a"];
    const wsB = ["file:///workspace/b"];

    let currentRoots = wsA;
    const wm = {
      createWorkspaceSnapshot: async () => ({
        status: "success" as const,
        workspaceRootUris: currentRoots,
        documents: [],
        failures: [],
        totalDiscovered: 0,
        totalAcquired: 0
      }),
      getWorkspaceRoots: () => currentRoots
    } as unknown as WorkspaceManager;

    const mockEngine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    // First scan for wsA -> generation 1
    const outcomeA1 = await coordinator.runWorkspaceScan();
    expect(outcomeA1.generation).toBe(1);

    // Second scan for wsA -> generation 2
    const outcomeA2 = await coordinator.runWorkspaceScan();
    expect(outcomeA2.generation).toBe(2);

    // First scan for wsB -> generation 1 (isolated!)
    currentRoots = wsB;
    const outcomeB1 = await coordinator.runWorkspaceScan();
    expect(outcomeB1.generation).toBe(1);

    // Account for restored generation
    coordinator.setInitialGeneration("file:///workspace/a" as WorkspaceId, 99);
    currentRoots = wsA;
    const outcomeA3 = await coordinator.runWorkspaceScan();
    expect(outcomeA3.generation).toBe(100);
  });

  // 6. Valid empty workspace remains distinct from no-workspace
  it("6. analyzes valid empty workspace and reports legitimate empty outcome", async () => {
    const wm = createMockWorkspaceManager({
      status: "empty",
      workspaceRootUris: ["file:///workspace/empty"],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const mockEngine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.workspaceId).toBe("file:///workspace/empty");
    expect(mockEngine.requests).toHaveLength(1);
    expect(mockEngine.requests[0].documents).toEqual([]);
  });

  // 7. No-workspace does not invoke the analysis engine
  it("7. returns distinct no-workspace outcome without invoking analysis engine", async () => {
    const wm = createMockWorkspaceManager({
      status: "no-workspace",
      workspaceRootUris: [],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const mockEngine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("no-workspace");
    expect(outcome.workspaceId).toBeUndefined();
    expect(mockEngine.requests).toHaveLength(0);
    expect(logger.logs.some((l) => l.msg.includes("No workspace folder"))).toBe(true);
  });

  // 8. Failed snapshot acquisition is not reported as clean analysis
  it("8. surfaces failed snapshot discovery without invoking analysis engine", async () => {
    const wm = createMockWorkspaceManager({
      status: "failed",
      workspaceRootUris: ["file:///workspace/failing"],
      documents: [],
      failures: [{ uri: "file:///workspace/failing", error: "Permission denied on directory" }],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const mockEngine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("Permission denied");
    expect(mockEngine.requests).toHaveLength(0);
  });

  // 9 & 10. Partial acquisition results in incomplete outcome and suppresses absence claims
  it("9 & 10. handles partial acquisition by attaching INCOMPLETE_SCOPE warnings and suppressing unsafe absence claims", async () => {
    const acquiredDoc: SourceDocument = {
      uri: "file:///workspace/src/client.ts",
      languageId: "typescript",
      text: "fetch('/api/users');",
      contentHash: "hash-client"
    };

    const wm = createMockWorkspaceManager({
      status: "partial",
      workspaceRootUris: ["file:///workspace/partial"],
      documents: [acquiredDoc],
      failures: [{ uri: "file:///workspace/src/server.ts", error: "EACCES read error" }],
      totalDiscovered: 2,
      totalAcquired: 1
    });

    // Mock engine emits missing-provider (UND100), no-known-consumer (UND110), suspected-route (UND130), and shape drift (UND200)
    const mockFindings: Finding[] = [
      {
        id: "finding:und100",
        ruleId: "UND100",
        category: "existence",
        severity: "error",
        state: "active",
        title: "Missing provider",
        summary: "No provider found",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        suggestedFixes: []
      },
      {
        id: "finding:und110",
        ruleId: "UND110",
        category: "existence",
        severity: "warning",
        state: "active",
        title: "No known consumer",
        summary: "Orphaned provider",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        suggestedFixes: []
      },
      {
        id: "finding:und130",
        ruleId: "UND130",
        category: "route",
        severity: "warning",
        state: "active",
        title: "Suspected route mismatch",
        summary: "Near route match",
        evidenceStrength: "inferred",
        sourceLocations: [],
        limitations: [],
        suggestedFixes: []
      },
      {
        id: "finding:und200",
        ruleId: "UND200",
        category: "shape",
        severity: "error",
        state: "active",
        title: "Shape field mismatch",
        summary: "Field type mismatch",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        suggestedFixes: []
      }
    ];

    const mockEngine = createMockEngine(async (req) =>
      createSampleAnalysisResult({
        workspaceId: req.workspaceId,
        generation: req.generation,
        complete: true, // engine might think it's complete for acquired subset
        findings: mockFindings
      })
    );

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("incomplete");
    expect(outcome.result).toBeDefined();
    expect(outcome.result?.complete).toBe(false);

    // INCOMPLETE_SCOPE warning attached
    const scopeWarning = outcome.result?.warnings.find((w) => w.code === "INCOMPLETE_SCOPE");
    expect(scopeWarning).toBeDefined();
    expect(scopeWarning?.message).toContain("file:///workspace/src/server.ts");

    // UND100, UND110, UND130 must be suppressed
    const remainingFindingRuleIds = outcome.result?.findings.map((f) => f.ruleId);
    expect(remainingFindingRuleIds).not.toContain("UND100");
    expect(remainingFindingRuleIds).not.toContain("UND110");
    expect(remainingFindingRuleIds).not.toContain("UND130");

    // Real observed shape drift finding UND200 is preserved
    expect(remainingFindingRuleIds).toContain("UND200");
    expect(outcome.result?.statistics.activeFindings).toBe(1);
    expect(outcome.result?.statistics.filesConsidered).toBe(2);
  });

  // 11. Engine exceptions are surfaced as failures rather than swallowed
  it("11. surfaces engine exceptions through the error path rather than converting to empty results", async () => {
    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: ["file:///workspace/crash"],
      documents: [
        {
          uri: "file:///workspace/src/client.ts",
          languageId: "typescript",
          text: "code",
          contentHash: "hash"
        }
      ],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const mockEngine = createMockEngine(async () => {
      throw new Error("Synthetic analysis engine crash");
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("Synthetic analysis engine crash");
    expect(logger.logs.some((l) => l.msg.includes("Analysis engine failed"))).toBe(true);
  });

  // 12. Coordinator disposal releases owned engine/parser resources safely
  it("12. safely disposes owned engine resources and prevents further runs", async () => {
    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: ["file:///workspace/dispose"],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const mockEngine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine: mockEngine,
      ownsEngine: true,
      logger
    });

    expect(coordinator.isDisposed).toBe(false);
    await coordinator.dispose();

    expect(coordinator.isDisposed).toBe(true);
    expect(mockEngine.disposeCalled).toBe(1);

    // Subsequent run returns failed
    const outcome = await coordinator.runWorkspaceScan();
    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("already been disposed");
  });

  // 13. Resource disposal remains safe if activation or initialization fails partway through
  it("13. handles multiple or partial disposal safely without throwing", async () => {
    const coordinator = new AnalysisCoordinator();
    await coordinator.dispose();
    // Second dispose is safe no-op
    await coordinator.dispose();
    expect(coordinator.isDisposed).toBe(true);
  });

  // 14. Real-component composition smoke test
  it("14. smoke tests real parser, analyzer, engine, and coordinator components together", async () => {
    const parser = new TreeSitterParserAdapter();
    const analyzer = new JsTsAnalyzer();
    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [analyzer]
    });

    const clientCode = `
      import axios from "axios";
      async function test() {
        await axios.get("/api/users");
      }
    `;

    const serverCode = `
      import express from "express";
      const app = express();
      app.get("/api/users", (req, res) => {
        res.json({ id: 1 });
      });
    `;

    const mockFiles: Record<string, string> = {
      "file:///workspace/smoke/client.ts": clientCode,
      "file:///workspace/smoke/server.ts": serverCode
    };

    const mockAccessor: WorkspaceAccessor = {
      getWorkspaceFolders: () => [
        {
          uri: {
            toString: () => "file:///workspace/smoke",
            fsPath: "/workspace/smoke"
          }
        }
      ],
      findFiles: async () => [
        {
          toString: () => "file:///workspace/smoke/client.ts",
          fsPath: "/workspace/smoke/client.ts"
        },
        {
          toString: () => "file:///workspace/smoke/server.ts",
          fsPath: "/workspace/smoke/server.ts"
        }
      ],
      readFile: async (uri) => new TextEncoder().encode(mockFiles[uri.toString()] ?? ""),
      getOpenDocuments: () => []
    };

    const wm = new WorkspaceManager(mockAccessor);

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      ownsEngine: true,
      logger
    });

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.result).toBeDefined();
    expect(outcome.result?.observations.length).toBeGreaterThanOrEqual(2);
    expect(outcome.result?.relationships.length).toBeGreaterThanOrEqual(1);

    await coordinator.dispose();
  });
});
