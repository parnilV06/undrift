// Phase 4, Chunk 4.4: Debouncing, Cancellation & Stale-Result Prevention Tests
// Verifies debounced scheduling, cancellation propagation across CancellationToken
// and AbortSignal, race-safe stale-result acceptance boundaries, and workspace isolation.

import { beforeEach, describe, expect, it } from "vitest";
import type {
  AnalysisEnginePort,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisStatistics,
  DocumentUri,
  Finding,
  PersistedFindingRecord,
  WorkspaceId
} from "@undrift/core";
import { StateReconciler, toPersistedFindingRecord } from "@undrift/core";
import {
  AnalysisCoordinator,
  type CancellationTokenLike,
  CancellationTokenSourceLike,
  deriveWorkspaceId
} from "../../apps/vscode-extension/src/activation";
import type { ExtensionLogger } from "../../apps/vscode-extension/src/logging";
import {
  createInMemoryStorageFileSystem,
  type InMemoryStorageFileSystem,
  WorkspaceStatePersistenceAdapter
} from "../../apps/vscode-extension/src/storage";
import {
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike,
  WorkspaceManager
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

function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "/")
  };
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

function createSampleFinding(id: string, overrides?: Partial<Finding>): Finding {
  return {
    id: `finding:${id}`,
    ruleId: "UND200",
    category: "shape",
    severity: "error",
    state: "active",
    title: `Sample finding ${id}`,
    summary: `Summary of finding ${id}`,
    evidenceStrength: "exact",
    sourceLocations: [
      {
        uri: "file:///test/ws/src/api.ts" as DocumentUri,
        range: { start: 10, end: 20 },
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 }
      }
    ],
    limitations: [],
    suggestedFixes: [],
    ...overrides
  };
}

function createSampleSnapshot(
  workspaceId: WorkspaceId,
  generation: number,
  findings: readonly PersistedFindingRecord[] = []
): AnalysisSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: `snap:${workspaceId}:${generation}`,
    workspaceId,
    generation,
    analyzedAt: 1700000000000 + generation * 1000,
    coverage: {
      complete: true,
      filesScanned: 1,
      filesWithWarnings: 0,
      unresolvedPatterns: 0,
      warnings: []
    },
    findings
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

function createMockWorkspaceAccessor(
  workspaceFolders: WorkspaceFolderLike[] = [
    {
      uri: makeUri("file:///test/ws"),
      name: "test-ws",
      index: 0
    }
  ]
): WorkspaceAccessor {
  return {
    getWorkspaceFolders: () => workspaceFolders,
    findFiles: async () => [makeUri("file:///test/ws/src/api.ts")],
    readFile: async () => new TextEncoder().encode("export const api = 1;"),
    getOpenDocuments: () => [],
    asRelativePath: (uriOrPath) => {
      const s = typeof uriOrPath === "string" ? uriOrPath : (uriOrPath.path ?? "");
      return s.replace(/^\/test\/ws\/?/, "");
    },
    getWorkspaceFolder: (uri) => {
      const uriStr = typeof uri === "string" ? uri : uri.toString();
      return workspaceFolders.find((f) => uriStr.startsWith(f.uri.toString()));
    }
  };
}

function createMockDocumentAccessor(
  docs: Array<{ uri: UriLike; version: number; languageId: string; getText: () => string }> = [
    {
      uri: makeUri("file:///test/ws/src/api.ts"),
      version: 1,
      languageId: "typescript",
      getText: () => "const x = 1;"
    }
  ]
): OpenDocumentAccessor {
  return {
    textDocuments: docs
  };
}

describe("Phase 4, Chunk 4.4: Debouncing, Cancellation & Stale-Result Prevention", () => {
  let logger: TestExtensionLogger;
  let inMemoryFs: InMemoryStorageFileSystem;
  let persistence: WorkspaceStatePersistenceAdapter;
  let reconciler: StateReconciler;
  let workspaceManager: WorkspaceManager;

  beforeEach(() => {
    logger = new TestExtensionLogger();
    inMemoryFs = createInMemoryStorageFileSystem();
    persistence = new WorkspaceStatePersistenceAdapter({
      storageUri: () => makeUri("file:///storage/globalStorage"),
      fileSystem: inMemoryFs,
      logger
    });
    reconciler = new StateReconciler();
    workspaceManager = new WorkspaceManager(createMockWorkspaceAccessor(), {
      documentAccessor: createMockDocumentAccessor()
    });
  });

  describe("1. Debounced Analysis Scheduling", () => {
    it("coalesces a burst of document changes into a single scheduled scan after the debounce window", async () => {
      let analyzeCalls = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzeCalls++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger,
        debounceDelayMs: 40
      });

      const scheduler = coordinator.getScheduler();
      const docUri = makeUri("file:///test/ws/src/api.ts");

      // Fire 5 rapid document edits within the debounce window
      const p1 = scheduler.handleDocumentChange({
        document: { uri: docUri, languageId: "typescript" }
      });
      await new Promise((r) => setTimeout(r, 10));
      const p2 = scheduler.handleDocumentChange({
        document: { uri: docUri, languageId: "typescript" }
      });
      await new Promise((r) => setTimeout(r, 10));
      const p3 = scheduler.handleDocumentChange({
        document: { uri: docUri, languageId: "typescript" }
      });
      await new Promise((r) => setTimeout(r, 10));
      const p4 = scheduler.handleDocumentSave({ uri: docUri, languageId: "typescript" });
      await new Promise((r) => setTimeout(r, 10));
      const p5 = scheduler.handleDocumentChange({
        document: { uri: docUri, languageId: "typescript" }
      });

      // While debouncing, analyze has not been called yet
      expect(analyzeCalls).toBe(0);

      // Wait for debounce window (40ms) to elapse + analysis execution
      const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5]);

      expect(analyzeCalls).toBe(1);
      expect(r1?.status).toBe("success");
      // All callers share the same scheduled scan promise outcome
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
      expect(r3).toBe(r4);
      expect(r4).toBe(r5);

      await coordinator.dispose();
    });

    it("ignores unsupported file extensions and excluded paths", async () => {
      let analyzeCalls = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzeCalls++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger,
        debounceDelayMs: 30
      });

      const scheduler = coordinator.getScheduler();

      // Unsupported extension (.css)
      const pCss = scheduler.handleDocumentChange({
        document: { uri: makeUri("file:///test/ws/src/styles.css"), languageId: "css" }
      });
      // Excluded directory (node_modules)
      const pNodeModules = scheduler.handleDocumentChange({
        document: {
          uri: makeUri("file:///test/ws/node_modules/pkg/index.js"),
          languageId: "javascript"
        }
      });

      expect(pCss).toBeUndefined();
      expect(pNodeModules).toBeUndefined();

      await new Promise((r) => setTimeout(r, 50));
      expect(analyzeCalls).toBe(0);

      await coordinator.dispose();
    });
  });

  describe("2. Cancellation Propagation", () => {
    it("passes an AbortSignal to engine.analyze() and aborts it when scan is cancelled", async () => {
      let capturedSignal: AbortSignal | undefined;
      let engineStartedResolve: () => void;
      const engineStartedPromise = new Promise<void>((r) => {
        engineStartedResolve = r;
      });

      const engine: AnalysisEnginePort = {
        analyze: async (req, signal) => {
          capturedSignal = signal;
          engineStartedResolve();
          // Wait until aborted
          return new Promise<AnalysisResult>((resolve, reject) => {
            if (signal?.aborted) {
              const err = new Error("Engine aborted");
              err.name = "AbortError";
              return reject(err);
            }
            signal?.addEventListener("abort", () => {
              const err = new Error("Engine aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      const scanPromise = coordinator.runWorkspaceScan();
      await engineStartedPromise;

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      // Cancel active scan
      const roots = workspaceManager.getWorkspaceRoots();
      const workspaceId = deriveWorkspaceId(roots);
      coordinator.cancelActiveScan(workspaceId);

      expect(capturedSignal?.aborted).toBe(true);

      const outcome = await scanPromise;
      expect(outcome.status).toBe("cancelled");

      await coordinator.dispose();
    });

    it("propagates CancellationToken to createWorkspaceSnapshot()", async () => {
      let capturedToken: CancellationTokenLike | undefined;

      const spiedWorkspaceManager = new WorkspaceManager(createMockWorkspaceAccessor(), {
        documentAccessor: createMockDocumentAccessor()
      });
      const originalCreate =
        spiedWorkspaceManager.createWorkspaceSnapshot.bind(spiedWorkspaceManager);
      spiedWorkspaceManager.createWorkspaceSnapshot = async (token) => {
        capturedToken = token;
        return originalCreate(token);
      };

      const engine: AnalysisEnginePort = {
        analyze: async (req) =>
          createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          }),
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager: spiedWorkspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      const outcome = await coordinator.runWorkspaceScan();
      expect(outcome.status).toBe("success");
      expect(capturedToken).toBeDefined();
      expect(capturedToken?.isCancellationRequested).toBe(false);
      expect(typeof capturedToken?.onCancellationRequested).toBe("function");

      await coordinator.dispose();
    });

    it("aborts scan early if cancellation is requested before or during snapshot acquisition", async () => {
      const cts = new CancellationTokenSourceLike();
      cts.cancel(); // Pre-cancelled

      let analyzeCalled = false;
      const engine: AnalysisEnginePort = {
        analyze: async () => {
          analyzeCalled = true;
          return createSampleAnalysisResult();
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      const outcome = await coordinator.runWorkspaceScan(cts.token);
      expect(outcome.status).toBe("cancelled");
      expect(analyzeCalled).toBe(false);

      await coordinator.dispose();
    });
  });

  describe("3. Stale-Result Prevention & Superseded Scans", () => {
    it("supersedes an in-progress scan when a newer scan starts and rejects the older scan's result", async () => {
      let scan1Resolve: (res: AnalysisResult) => void;
      const scan1Promise = new Promise<AnalysisResult>((r) => {
        scan1Resolve = r;
      });

      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          if (req.generation === 1) {
            return scan1Promise;
          }
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation,
            findings: [createSampleFinding("v2")]
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      // 1. Start scan 1 (generation 1)
      const p1 = coordinator.runWorkspaceScan();
      await new Promise((r) => setTimeout(r, 10));

      // 2. Start scan 2 (generation 2) while scan 1 is in-flight
      const p2 = coordinator.runWorkspaceScan();

      // Scan 2 completes immediately
      const outcome2 = await p2;
      expect(outcome2.status).toBe("success");
      expect(outcome2.generation).toBe(2);
      expect(outcome2.result?.findings[0].id).toBe("finding:v2");

      // 3. Now let scan 1 resolve LATE with an old finding
      scan1Resolve!(
        createSampleAnalysisResult({
          workspaceId: "file:///test/ws",
          generation: 1,
          findings: [createSampleFinding("v1-stale")]
        })
      );

      const outcome1 = await p1;
      // Scan 1 MUST be reported as superseded
      expect(outcome1.status).toBe("superseded");
      expect(outcome1.reconciliation).toBeUndefined();
      expect(outcome1.persistenceStatus).toBe("skipped-stale");

      // Verify that persistence snapshot still has generation 2 and finding:v2!
      const roots = workspaceManager.getWorkspaceRoots();
      const workspaceId = deriveWorkspaceId(roots);
      const persistedSnapshot = await persistence.loadLatestSnapshot(workspaceId);
      expect(persistedSnapshot).toBeDefined();
      expect(persistedSnapshot?.generation).toBe(2);
      expect(persistedSnapshot?.findings[0].id).toBe("finding:v2");

      // Verify in-memory last-known snapshot is generation 2
      expect(coordinator.getLastKnownSnapshot(workspaceId)?.generation).toBe(2);

      await coordinator.dispose();
    });

    it("prevents an engine that ignores cancellation from persisting stale findings or emitting lifecycle events", async () => {
      let slowEngineResolve: (res: AnalysisResult) => void;
      const slowPromise = new Promise<AnalysisResult>((r) => {
        slowEngineResolve = r;
      });

      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          if (req.generation === 1) {
            // Engine deliberately ignores cancellation and returns normally later
            return slowPromise;
          }
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation,
            findings: [createSampleFinding("valid-v2")]
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      const p1 = coordinator.runWorkspaceScan();
      await new Promise((r) => setTimeout(r, 10));

      const p2 = coordinator.runWorkspaceScan();
      const outcome2 = await p2;
      expect(outcome2.status).toBe("success");
      expect(outcome2.generation).toBe(2);

      // Now resolve slow engine with stale finding
      slowEngineResolve!(
        createSampleAnalysisResult({
          workspaceId: "file:///test/ws",
          generation: 1,
          findings: [createSampleFinding("stale-ignored-cancellation")]
        })
      );

      const outcome1 = await p1;
      expect(outcome1.status).toBe("superseded");

      const roots = workspaceManager.getWorkspaceRoots();
      const workspaceId = deriveWorkspaceId(roots);

      // Check history: history must contain only events from Scan 2, zero events from Scan 1
      const history = await persistence.loadLifecycleHistory(workspaceId);
      expect(history.length).toBe(1);
      expect(history[0].findingId).toBe("finding:valid-v2");

      // Verify in-memory state
      const memSnapshot = coordinator.getLastKnownSnapshot(workspaceId);
      expect(memSnapshot?.generation).toBe(2);
      expect(memSnapshot?.findings[0].id).toBe("finding:valid-v2");

      await coordinator.dispose();
    });

    it("rejects an analysis result belonging to a different workspace identity", async () => {
      const engine: AnalysisEnginePort = {
        analyze: async (req) =>
          createSampleAnalysisResult({
            workspaceId: "file:///different/workspace", // Mismatched workspace ID
            generation: req.generation
          }),
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      const outcome = await coordinator.runWorkspaceScan();
      expect(outcome.status).toBe("failed");
      expect(outcome.errorMessage).toContain("does not match expected");

      await coordinator.dispose();
    });
  });

  describe("4. Workspace Isolation", () => {
    it("maintains independent generation counters, scheduling, and active scans per workspace", async () => {
      const wsFolderA: WorkspaceFolderLike = {
        uri: makeUri("file:///workspace/a"),
        name: "ws-a",
        index: 0
      };
      const wsFolderB: WorkspaceFolderLike = {
        uri: makeUri("file:///workspace/b"),
        name: "ws-b",
        index: 1
      };

      const wsManagerA = new WorkspaceManager(createMockWorkspaceAccessor([wsFolderA]), {
        documentAccessor: createMockDocumentAccessor()
      });
      const wsManagerB = new WorkspaceManager(createMockWorkspaceAccessor([wsFolderB]), {
        documentAccessor: createMockDocumentAccessor()
      });

      let slowWsAResolve: (res: AnalysisResult) => void;
      const slowWsAPromise = new Promise<AnalysisResult>((r) => {
        slowWsAResolve = r;
      });

      const engineA: AnalysisEnginePort = {
        analyze: async () => slowWsAPromise,
        dispose: async () => {}
      };

      const engineB: AnalysisEnginePort = {
        analyze: async (req) =>
          createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          }),
        dispose: async () => {}
      };

      const coordinatorA = new AnalysisCoordinator({
        workspaceManager: wsManagerA,
        engine: engineA,
        persistence,
        reconciler,
        logger
      });

      const coordinatorB = new AnalysisCoordinator({
        workspaceManager: wsManagerB,
        engine: engineB,
        persistence,
        reconciler,
        logger
      });

      // Pre-populate persistence for Workspace B at generation 10
      await persistence.saveSnapshot(
        "file:///workspace/b",
        createSampleSnapshot("file:///workspace/b", 10)
      );

      // 1. Generation counters are isolated
      coordinatorA.setInitialGeneration("file:///workspace/a", 5);
      coordinatorB.setInitialGeneration("file:///workspace/b", 10);
      expect(coordinatorA.getNextGeneration("file:///workspace/a")).toBe(6);
      expect(coordinatorB.getNextGeneration("file:///workspace/b")).toBe(11);

      // 2. Scheduler pending timers are isolated
      const schedulerA = coordinatorA.getScheduler();
      const schedulerB = coordinatorB.getScheduler();

      void schedulerA.scheduleScan({ targetWorkspaceId: "file:///workspace/a", delayMs: 150 });
      void schedulerB.scheduleScan({ targetWorkspaceId: "file:///workspace/b", delayMs: 150 });

      expect(schedulerA.hasPendingScan("file:///workspace/a")).toBe(true);
      expect(schedulerB.hasPendingScan("file:///workspace/b")).toBe(true);

      schedulerA.cancelPendingScan("file:///workspace/a");
      expect(schedulerA.hasPendingScan("file:///workspace/a")).toBe(false);
      expect(schedulerB.hasPendingScan("file:///workspace/b")).toBe(true); // Workspace B unaffected

      schedulerB.cancelPendingScan("file:///workspace/b");

      // 3. Active scans and cancellation are isolated
      const pScanA = coordinatorA.runWorkspaceScan();
      await new Promise((r) => setTimeout(r, 10));

      const pScanB = coordinatorB.runWorkspaceScan();
      const outcomeB = await pScanB;

      expect(outcomeB.status).toBe("success");
      expect(outcomeB.workspaceId).toBe("file:///workspace/b");
      expect(outcomeB.generation).toBe(11);

      // Workspace A is still active and uncancelled
      const activeA = coordinatorA.getActiveScan("file:///workspace/a");
      expect(activeA).toBeDefined();
      expect(activeA?.isObsolete).toBe(false);

      // Cancel Workspace A explicitly
      coordinatorA.cancelActiveScan("file:///workspace/a");

      slowWsAResolve!(
        createSampleAnalysisResult({
          workspaceId: "file:///workspace/a",
          generation: 7
        })
      );

      const outcomeA = await pScanA;
      expect(outcomeA.status).toBe("cancelled");

      await coordinatorA.dispose();
      await coordinatorB.dispose();
    });
  });

  describe("5. Command Integration (runImmediateScan)", () => {
    it("clears pending debounce timers and executes scan immediately", async () => {
      let analyzeCalls = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzeCalls++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger,
        debounceDelayMs: 200
      });

      const scheduler = coordinator.getScheduler();
      const docUri = makeUri("file:///test/ws/src/api.ts");

      // Schedule a debounced scan (200ms delay)
      void scheduler.handleDocumentChange({ document: { uri: docUri, languageId: "typescript" } });
      expect(analyzeCalls).toBe(0);

      // Invoke immediate scan (simulating undrift.scanWorkspace command)
      const outcome = await scheduler.runImmediateScan();
      expect(outcome.status).toBe("success");
      expect(analyzeCalls).toBe(1);

      // Wait past the original 200ms debounce timer to verify no redundant second scan ran
      await new Promise((r) => setTimeout(r, 220));
      expect(analyzeCalls).toBe(1);

      await coordinator.dispose();
    });
  });

  describe("6. Restoration Ordering & Generation Allocation", () => {
    it("finishes session restoration before allocating generation counter", async () => {
      const roots = workspaceManager.getWorkspaceRoots();
      const workspaceId = deriveWorkspaceId(roots);

      // Pre-populate persistence with snapshot generation 10
      await persistence.saveSnapshot(
        workspaceId,
        createSampleSnapshot(workspaceId, 10, [
          toPersistedFindingRecord(createSampleFinding("existing"), 1000, 1000)
        ])
      );

      let analyzedGeneration: number | undefined;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzedGeneration = req.generation;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger
      });

      // runWorkspaceScan must await restoration and allocate generation 11 (not 1)
      const outcome = await coordinator.runWorkspaceScan();
      expect(outcome.status).toBe("success");
      expect(analyzedGeneration).toBe(11);
      expect(outcome.generation).toBe(11);

      await coordinator.dispose();
    });
  });

  describe("7. Disposal & Lifecycle Cleanup", () => {
    it("clears pending debounce timers, cancels active scans, and prevents rescheduling", async () => {
      let analyzeCalls = 0;
      let engineStartedResolve: () => void;
      const engineStarted = new Promise<void>((r) => {
        engineStartedResolve = r;
      });

      let capturedSignal: AbortSignal | undefined;
      const engine: AnalysisEnginePort = {
        analyze: async (req, signal) => {
          analyzeCalls++;
          capturedSignal = signal;
          engineStartedResolve();
          return new Promise<AnalysisResult>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        persistence,
        reconciler,
        logger,
        debounceDelayMs: 100
      });

      // Start an active scan
      const scanPromise = coordinator.runWorkspaceScan();
      await engineStarted;
      expect(analyzeCalls).toBe(1);

      // Dispose coordinator
      await coordinator.dispose();

      // Active scan should have received abort
      expect(capturedSignal?.aborted).toBe(true);
      const outcome = await scanPromise;
      expect(outcome.status).toBe("cancelled");

      // Wait past debounce timer: pending timer should NOT have fired
      await new Promise((r) => setTimeout(r, 120));
      expect(analyzeCalls).toBe(1);

      // Subsequent schedule attempt after disposal throws or returns failed
      const postDisposeOutcome = await coordinator.runWorkspaceScan();
      expect(postDisposeOutcome.status).toBe("failed");
    });
  });

  describe("8. Workspace Event Registration with Disposable", () => {
    it("registers listeners and unregisters them on dispose", () => {
      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine: {
          analyze: async () => createSampleAnalysisResult(),
          dispose: async () => {}
        },
        persistence,
        reconciler,
        logger
      });

      const scheduler = coordinator.getScheduler();

      let changeListenerRegistered = false;
      let changeListenerDisposed = false;

      const mockEventSource = {
        onDidChangeTextDocument: () => {
          changeListenerRegistered = true;
          return {
            dispose: () => {
              changeListenerDisposed = true;
            }
          };
        },
        onDidOpenTextDocument: () => ({ dispose: () => {} }),
        onDidSaveTextDocument: () => ({ dispose: () => {} }),
        onDidCreateFiles: () => ({ dispose: () => {} }),
        onDidDeleteFiles: () => ({ dispose: () => {} }),
        onDidRenameFiles: () => ({ dispose: () => {} })
      };

      const disposable = scheduler.registerWorkspaceEvents(mockEventSource);
      expect(changeListenerRegistered).toBe(true);
      expect(changeListenerDisposed).toBe(false);

      disposable.dispose();
      expect(changeListenerDisposed).toBe(true);
    });
  });
});
