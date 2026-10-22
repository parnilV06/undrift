// Phase 4, Chunk 4.3: Session Restoration & Snapshot Reconciliation Integration Tests.
// Tests the coordination between WorkspaceStatePersistenceAdapter, StateReconciler,
// AnalysisCoordinator, and extension lifecycle.

import * as Module from "module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisStatistics,
  DocumentUri,
  Finding,
  FindingLifecycleEvent,
  PersistedFindingRecord,
  RetentionPolicy,
  SourceDocument,
  WorkspaceId
} from "@undrift/core";
import {
  LIFECYCLE_HISTORY_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  StateReconciler
} from "@undrift/core";
import { AnalysisCoordinator, deriveWorkspaceId } from "../../apps/vscode-extension/src/activation";
import type { ExtensionLogger } from "../../apps/vscode-extension/src/logging";
import {
  createInMemoryStorageFileSystem,
  getWorkspaceStorageKey,
  type InMemoryStorageFileSystem,
  joinStorageUri,
  StorageIOError,
  StorageUnavailableError,
  WorkspaceStatePersistenceAdapter
} from "../../apps/vscode-extension/src/storage";
import {
  type UriLike,
  type WorkspaceAccessor,
  WorkspaceManager,
  type WorkspaceSnapshotResult
} from "../../apps/vscode-extension/src/workspace";

const vscodeMock = vi.hoisted(() => ({
  commands: {
    registerCommand: vi.fn((_cmd: string, handler: (...args: unknown[]) => unknown) => ({
      dispose: vi.fn(),
      _handler: handler
    }))
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      dispose: vi.fn(),
      show: vi.fn()
    }))
  }
}));

// Mock vscode module for both ESM and CommonJS require
vi.mock("vscode", () => vscodeMock);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return vscodeMock;
  }
  return originalRequire.call(this, id, ...args);
};

import { activate, deactivate } from "../../apps/vscode-extension/src/extension";

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

function makeStorageUri(uriStr: string): UriLike {
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
        uri: "file:///workspace/src/app.ts" as DocumentUri,
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
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: `snap:${workspaceId}:${generation}`,
    workspaceId,
    generation,
    analyzedAt: 1700000000000 + generation * 1000,
    coverage: {
      complete: true,
      filesScanned: 2,
      filesWithWarnings: 0,
      unresolvedPatterns: 0,
      warnings: []
    },
    findings
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
      return {
        workspaceId: req.workspaceId,
        generation: req.generation,
        generatedAt: Date.now(),
        complete: true,
        observations: [],
        relationships: [],
        findings: [],
        warnings: [],
        statistics: createSampleStatistics()
      };
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

describe("Phase 4, Chunk 4.3: Session Restoration & Snapshot Reconciliation", () => {
  let logger: TestExtensionLogger;
  let inMemoryFs: InMemoryStorageFileSystem;
  let storageRoot: UriLike;
  const testWorkspaceId = "file:///workspace/test" as WorkspaceId;

  beforeEach(() => {
    logger = new TestExtensionLogger();
    inMemoryFs = createInMemoryStorageFileSystem();
    storageRoot = makeStorageUri("file:///storage/root");
  });

  function createPersistenceAdapter(): WorkspaceStatePersistenceAdapter {
    return new WorkspaceStatePersistenceAdapter({
      storageUri: storageRoot,
      fileSystem: inMemoryFs,
      logger: {
        info: (msg) => logger.info(msg),
        warn: (msg, err) => logger.warn(msg, err),
        error: (msg, err) => logger.error(msg, err)
      }
    });
  }

  // 1. Restoring an existing snapshot and lifecycle history
  it("1. restores existing complete snapshot and lifecycle history for a workspace", async () => {
    const persistence = createPersistenceAdapter();

    const sampleRecord: PersistedFindingRecord = {
      id: "finding:f1",
      ruleId: "UND200",
      category: "shape",
      severity: "error",
      state: "active",
      title: "Shape drift",
      summary: "Mismatch in response type",
      evidenceStrength: "exact",
      sourceLocations: [],
      limitations: [],
      firstObservedAt: 1700000000000,
      lastConfirmedAt: 1700000005000
    };

    const initialSnapshot = createSampleSnapshot(testWorkspaceId, 5, [sampleRecord]);
    await persistence.saveSnapshot(testWorkspaceId, initialSnapshot);

    const initialEvent: FindingLifecycleEvent = {
      eventId: "evt:5:1",
      workspaceId: testWorkspaceId,
      findingId: "finding:f1",
      transitionKind: "detected",
      observedAt: 1700000000000,
      triggerGeneration: 5,
      newState: "active"
    };
    await persistence.appendLifecycleEvents(testWorkspaceId, [initialEvent]);

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    const restored = await coordinator.restoreSession();

    expect(restored.status).toBe("restored");
    expect(restored.workspaceId).toBe(testWorkspaceId);
    expect(restored.snapshot).toBeDefined();
    expect(restored.snapshot?.generation).toBe(5);
    expect(restored.snapshot?.findings).toHaveLength(1);
    expect(restored.history).toHaveLength(1);
    expect(restored.seededGeneration).toBe(5);

    // Read-only APIs
    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(5);
    expect(coordinator.getLastKnownHistory()?.length).toBe(1);
    expect(coordinator.getActiveWorkspaceId()).toBe(testWorkspaceId);
  });

  // 2. Starting with no prior snapshot
  it("2. establishes clean empty baseline when no prior snapshot exists", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    const restored = await coordinator.restoreSession();

    expect(restored.status).toBe("empty-baseline");
    expect(restored.workspaceId).toBe(testWorkspaceId);
    expect(restored.snapshot).toBeUndefined();
    expect(restored.history).toHaveLength(0);
    expect(restored.seededGeneration).toBe(0);

    expect(coordinator.getLastKnownSnapshot()).toBeUndefined();
    expect(coordinator.getLastKnownHistory()).toEqual([]);
  });

  // 3. Restoring and seeding the workspace generation correctly
  it("3. seeds monotonic generation counter from restored snapshot so subsequent scans increment correctly", async () => {
    const persistence = createPersistenceAdapter();
    const snapshot = createSampleSnapshot(testWorkspaceId, 42);
    await persistence.saveSnapshot(testWorkspaceId, snapshot);

    const wm = createMockWorkspaceManager({
      status: "empty",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const engine = createMockEngine();
    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    const restored = await coordinator.restoreSession();
    expect(restored.seededGeneration).toBe(42);

    // Scan should continue from generation 43
    const outcome = await coordinator.runWorkspaceScan();
    expect(outcome.generation).toBe(43);
    expect(engine.requests[0].generation).toBe(43);
    expect(coordinator.getCurrentGeneration(testWorkspaceId)).toBe(43);
  });

  // 4. Workspace isolation and identity mismatch protection
  it("4. preserves workspace isolation between distinct workspaces", async () => {
    const ws1 = "file:///workspace/alpha" as WorkspaceId;
    const ws2 = "file:///workspace/beta" as WorkspaceId;

    const persistence = createPersistenceAdapter();
    await persistence.saveSnapshot(ws1, createSampleSnapshot(ws1, 3));
    await persistence.saveSnapshot(ws2, createSampleSnapshot(ws2, 7));

    const wm = createMockWorkspaceManager({
      status: "empty",
      workspaceRootUris: [ws1],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    const restored1 = await coordinator.restoreSession(ws1);
    expect(restored1.seededGeneration).toBe(3);

    const restored2 = await coordinator.restoreSession(ws2);
    expect(restored2.seededGeneration).toBe(7);

    expect(coordinator.getLastKnownSnapshot(ws1)?.generation).toBe(3);
    expect(coordinator.getLastKnownSnapshot(ws2)?.generation).toBe(7);
  });

  // 5. Complete scans detecting new findings
  it("5. detects new findings on complete scan, emits 'detected' lifecycle event, and persists state", async () => {
    const persistence = createPersistenceAdapter();

    const finding1 = createSampleFinding("f1", { severity: "error" });
    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [finding1],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [
        {
          uri: "file:///workspace/src/app.ts",
          languageId: "typescript",
          text: "app code",
          contentHash: "hash1"
        }
      ],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.persistenceStatus).toBe("saved");
    expect(outcome.reconciliation?.eventsEmitted).toHaveLength(1);
    expect(outcome.reconciliation?.eventsEmitted[0].transitionKind).toBe("detected");
    expect(outcome.reconciliation?.eventsEmitted[0].findingId).toBe("finding:f1");

    // Verify disk persisted state
    const savedSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(savedSnapshot).toBeDefined();
    expect(savedSnapshot?.generation).toBe(1);
    expect(savedSnapshot?.findings).toHaveLength(1);

    const savedHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(savedHistory).toHaveLength(1);
    expect(savedHistory[0].transitionKind).toBe("detected");
  });

  // 6. Complete scans correctly producing changed, resolved, and reintroduced transitions
  it("6. correctly produces changed, resolved, and reintroduced transitions across sequential complete scans", async () => {
    const persistence = createPersistenceAdapter();

    let currentFindings: Finding[] = [];
    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: currentFindings,
      warnings: [],
      statistics: createSampleStatistics()
    }));

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [
        {
          uri: "file:///workspace/src/app.ts",
          languageId: "typescript",
          text: "code",
          contentHash: "hash"
        }
      ],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    // Scan 1: Detect f1 (warning) and f2 (error)
    currentFindings = [
      createSampleFinding("f1", { severity: "warning" }),
      createSampleFinding("f2", { severity: "error" })
    ];
    const outcome1 = await coordinator.runWorkspaceScan();
    expect(outcome1.reconciliation?.eventsEmitted).toHaveLength(2);
    expect(outcome1.reconciliation?.eventsEmitted.map((e) => e.transitionKind)).toEqual([
      "detected",
      "detected"
    ]);

    // Scan 2: f1 changes to error; f2 is fixed (resolved)
    currentFindings = [createSampleFinding("f1", { severity: "error" })];
    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.reconciliation?.eventsEmitted).toHaveLength(2);
    const eventMap2 = new Map(
      outcome2.reconciliation?.eventsEmitted.map((e) => [e.findingId, e.transitionKind])
    );
    expect(eventMap2.get("finding:f1")).toBe("changed");
    expect(eventMap2.get("finding:f2")).toBe("resolved");

    // Scan 3: f2 is reintroduced!
    currentFindings = [
      createSampleFinding("f1", { severity: "error" }),
      createSampleFinding("f2", { severity: "error" })
    ];
    const outcome3 = await coordinator.runWorkspaceScan();
    expect(outcome3.reconciliation?.eventsEmitted).toHaveLength(1);
    expect(outcome3.reconciliation?.eventsEmitted[0].findingId).toBe("finding:f2");
    expect(outcome3.reconciliation?.eventsEmitted[0].transitionKind).toBe("reintroduced");

    // Check full history in storage
    const fullHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(fullHistory).toHaveLength(5); // 2 detected + 1 changed + 1 resolved + 1 reintroduced
  });

  // 7. Unchanged findings producing no new lifecycle events
  it("7. does not produce lifecycle events for materially unchanged findings", async () => {
    const persistence = createPersistenceAdapter();

    const finding1 = createSampleFinding("f1", { severity: "error" });
    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [finding1],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    // First scan -> 1 detected event
    await coordinator.runWorkspaceScan();
    const historyAfterScan1 = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(historyAfterScan1).toHaveLength(1);

    // Second scan with identical finding -> 0 new events
    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.status).toBe("success");
    expect(outcome2.reconciliation?.eventsEmitted).toHaveLength(0);
    expect(outcome2.reconciliation?.unchangedFindingCount).toBe(1);

    const historyAfterScan2 = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(historyAfterScan2).toHaveLength(1); // Still exactly 1 event!
  });

  // 8. Incomplete first scans not creating a snapshot
  it("8. enforces that an incomplete initial scan does not create or persist a snapshot", async () => {
    const persistence = createPersistenceAdapter();

    // Partial acquisition failure
    const wm = createMockWorkspaceManager({
      status: "partial",
      workspaceRootUris: [testWorkspaceId],
      documents: [
        {
          uri: "file:///workspace/src/app.ts",
          languageId: "typescript",
          text: "app",
          contentHash: "hash"
        }
      ],
      failures: [{ uri: "file:///workspace/src/server.ts", error: "Permission denied" }],
      totalDiscovered: 2,
      totalAcquired: 1
    });

    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [createSampleFinding("f1")],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("incomplete");
    expect(outcome.persistenceStatus).toBe("skipped-incomplete");
    expect(outcome.reconciliation?.coverageSufficient).toBe(false);
    expect(outcome.reconciliation?.eventsEmitted).toHaveLength(0);

    // Storage must be empty!
    const savedSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(savedSnapshot).toBeUndefined();

    const savedHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(savedHistory).toHaveLength(0);
  });

  // 9. Incomplete subsequent scans preserving the previous snapshot and emitting no lifecycle events
  it("9. preserves existing snapshot intact on incomplete subsequent scans and emits zero false resolutions", async () => {
    const persistence = createPersistenceAdapter();

    let isScanIncomplete = false;
    let findingsToReturn = [createSampleFinding("f1")];

    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: !isScanIncomplete,
      observations: [],
      relationships: [],
      findings: findingsToReturn,
      warnings: isScanIncomplete
        ? [
            {
              code: "PARSE_TIMEOUT",
              message: "Timeout parsing server file",
              affectsCompleteness: true
            }
          ]
        : [],
      statistics: createSampleStatistics()
    }));

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    // Scan 1: complete, succeeds
    const outcome1 = await coordinator.runWorkspaceScan();
    expect(outcome1.status).toBe("success");
    expect(outcome1.persistenceStatus).toBe("saved");

    const snapshotAfter1 = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(snapshotAfter1?.generation).toBe(1);
    expect(snapshotAfter1?.findings).toHaveLength(1);

    // Scan 2: incomplete, returns 0 findings (would falsely resolve f1 if un-gated!)
    isScanIncomplete = true;
    findingsToReturn = [];

    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.status).toBe("incomplete");
    expect(outcome2.persistenceStatus).toBe("skipped-incomplete");
    expect(outcome2.reconciliation?.coverageSufficient).toBe(false);
    expect(outcome2.reconciliation?.eventsEmitted).toHaveLength(0); // Zero resolution events!

    // Snapshot in persistence MUST remain intact with generation 1 and f1
    const snapshotAfter2 = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(snapshotAfter2?.generation).toBe(1);
    expect(snapshotAfter2?.findings[0].id).toBe("finding:f1");

    // In-memory coordinator getter must still return the intact snapshot
    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(1);
  });

  // 10. Failed scans preserving persisted state
  it("10. preserves existing persisted state intact when workspace discovery or engine execution fails", async () => {
    const persistence = createPersistenceAdapter();
    const initialSnapshot = createSampleSnapshot(testWorkspaceId, 10);
    await persistence.saveSnapshot(testWorkspaceId, initialSnapshot);

    const wm = createMockWorkspaceManager({
      status: "failed",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [{ uri: testWorkspaceId, error: "Disk failure" }],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();
    expect(outcome.status).toBe("failed");

    // Snapshot intact
    const snapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(snapshot?.generation).toBe(10);
  });

  // 11. Corrupted stored records following quarantine/recovery policy
  it("11. quarantines corrupted snapshot and establishes clean baseline without crashing", async () => {
    const persistence = createPersistenceAdapter();

    // Write malformed corrupted JSON to snapshot.json
    const wsDir = joinStorageUri(
      storageRoot,
      "workspaces",
      getWorkspaceStorageKey(testWorkspaceId)
    );
    const snapshotUri = joinStorageUri(wsDir, "snapshot.json");
    await inMemoryFs.createDirectory(wsDir);
    await inMemoryFs.writeFile(
      snapshotUri,
      new TextEncoder().encode("{ corrupted invalid json...")
    );

    // Also write valid history to check that valid records are preserved
    const validHistory: FindingLifecycleEvent[] = [
      {
        eventId: "evt:1:1",
        workspaceId: testWorkspaceId,
        findingId: "finding:f1",
        transitionKind: "detected",
        observedAt: 1700000000000,
        triggerGeneration: 1,
        newState: "active"
      }
    ];
    const historyUri = joinStorageUri(wsDir, "history.json");
    await inMemoryFs.writeFile(
      historyUri,
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: LIFECYCLE_HISTORY_SCHEMA_VERSION,
          workspaceId: testWorkspaceId,
          events: validHistory
        })
      )
    );

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    const restored = await coordinator.restoreSession();

    expect(restored.status).toBe("corrupted-quarantined");
    expect(restored.snapshot).toBeUndefined();
    expect(restored.history).toHaveLength(1);
    expect(restored.seededGeneration).toBe(0);
    expect(restored.warningMessage).toContain("quarantined");

    // Confirm that quarantine file was created in quarantine dir
    const quarantined = Array.from(inMemoryFs.files.keys()).some(
      (k) => k.includes("/quarantine/") && k.includes(".corrupt.")
    );
    expect(quarantined).toBe(true);
  });

  // 12. Unavailable storage and I/O failures being reported without falsely claiming persistence success
  it("12. handles unavailable storage gracefully without claiming persistence success", async () => {
    // Persistence adapter where storageUri returns undefined
    const persistence = new WorkspaceStatePersistenceAdapter({
      storageUri: () => undefined,
      fileSystem: inMemoryFs,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    });

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence,
      logger
    });

    const restored = await coordinator.restoreSession();
    expect(restored.status).toBe("storage-unavailable");
    expect(restored.seededGeneration).toBe(0);

    const outcome = await coordinator.runWorkspaceScan();
    expect(outcome.status).toBe("success");
    expect(outcome.persistenceStatus).toBe("failed");
    expect(outcome.persistenceError).toContain("unavailable");
  });

  // 13. Snapshot-save and lifecycle-history-write failure paths
  it("13. reports persistence failure when saveSnapshot or appendLifecycleEvents throws", async () => {
    // Failing persistence adapter
    const failingPersistence = {
      id: "failing-persistence",
      loadLatestSnapshot: async () => undefined,
      saveSnapshot: async () => {
        throw new StorageIOError("Simulated disk write failure on snapshot.json");
      },
      loadLifecycleHistory: async () => [],
      appendLifecycleEvents: async () => {},
      pruneLifecycleHistory: async () => 0,
      clearCache: async () => {},
      resetHistory: async () => {}
    };

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence: failingPersistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success"); // Analysis engine succeeded
    expect(outcome.persistenceStatus).toBe("failed");
    expect(outcome.persistenceError).toContain("Simulated disk write failure");

    // Coordinator in-memory snapshot was NOT updated because persistence failed
    expect(coordinator.getLastKnownSnapshot()).toBeUndefined();
  });

  // 14. Retention policy pruning integration
  it("14. prunes historical lifecycle events according to configured retention policy during scan", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const retentionPolicy: RetentionPolicy = {
      maxEventsPerWorkspace: 2
    };

    let scanCount = 0;
    const engine = createMockEngine(async (req) => {
      scanCount++;
      return {
        workspaceId: req.workspaceId,
        generation: req.generation,
        generatedAt: Date.now(),
        complete: true,
        observations: [],
        relationships: [],
        findings: [createSampleFinding(`f${scanCount}`)],
        warnings: [],
        statistics: createSampleStatistics()
      };
    });

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      retentionPolicy,
      logger
    });

    await coordinator.restoreSession();

    // 3 successive scans, each detecting a new finding -> 3 events
    await coordinator.runWorkspaceScan();
    await coordinator.runWorkspaceScan();
    await coordinator.runWorkspaceScan();

    // With retention policy maxEventsPerWorkspace: 2, history should be pruned to 2
    const history = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(history.length).toBeLessThanOrEqual(2);
  });

  // 15. Safe extension activation and deactivation
  it("15. activates and deactivates extension safely with storage, reconciler, and coordinator dependencies", async () => {
    const mockContext = {
      extensionPath:
        "z:/OLD PC Files/parnil - My Files/Programming/UNDRIFT/UNDRIFT-SourceCode/apps/vscode-extension",
      storageUri: makeStorageUri("file:///test/storage/uri"),
      subscriptions: [] as { dispose: () => void }[]
    };

    // Activate
    activate(mockContext as unknown as Parameters<typeof activate>[0]);
    expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(2);

    // Deactivate
    await deactivate();
    // Second deactivate is safe no-op
    await deactivate();
  });
});
