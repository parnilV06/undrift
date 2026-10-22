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
  StateReconciler,
  toPersistedFindingRecord
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
  },
  languages: {
    createDiagnosticCollection: vi.fn((_name?: string) => ({
      name: _name ?? "undrift",
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      get: vi.fn()
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

  // 16. Race condition elimination: scan awaits pending restoration
  it("16. eliminates restoration/scan race by awaiting pending restoration before allocating generation and reconciling", async () => {
    const persistence = createPersistenceAdapter();

    // Seed prior snapshot with generation 15 and finding f_old
    const priorSnapshot = createSampleSnapshot(testWorkspaceId, 15, [
      {
        id: "finding:f_old",
        ruleId: "UND200",
        category: "shape",
        severity: "error",
        state: "active",
        title: "Old drift",
        summary: "Old summary",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        firstObservedAt: 1700000000000,
        lastConfirmedAt: 1700000015000
      }
    ]);
    await persistence.saveSnapshot(testWorkspaceId, priorSnapshot);

    // Controlled deferred promise on loadLatestSnapshot to artificially delay restoration
    let resolveSnapshotLoad: (snap: AnalysisSnapshot | undefined) => void = () => {};
    const deferredLoad = new Promise<AnalysisSnapshot | undefined>((resolve) => {
      resolveSnapshotLoad = resolve;
    });

    const realLoadLatestSnapshot = persistence.loadLatestSnapshot.bind(persistence);
    let loadCallCount = 0;
    persistence.loadLatestSnapshot = async (wsId: WorkspaceId) => {
      loadCallCount++;
      await deferredLoad;
      return realLoadLatestSnapshot(wsId);
    };

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

    // Start restoration asynchronously without awaiting it
    const restorationPromise = coordinator.restoreSession();

    // Immediately trigger workspace scan concurrently
    let scanFinished = false;
    const scanPromise = coordinator.runWorkspaceScan().then((res) => {
      scanFinished = true;
      return res;
    });

    // Verify that the scan has NOT finished yet (it must await restoration!)
    await new Promise((r) => setTimeout(r, 10));
    expect(scanFinished).toBe(false);

    // Now release the deferred load
    resolveSnapshotLoad(priorSnapshot);

    // Both should now resolve
    const [restored, outcome] = await Promise.all([restorationPromise, scanPromise]);

    expect(restored.status).toBe("restored");
    expect(restored.seededGeneration).toBe(15);

    // Scan waited, used the restored snapshot, and allocated generation 16 (strictly > 15)
    expect(outcome.status).toBe("success");
    expect(outcome.generation).toBe(16);
    expect(engine.requests[0].generation).toBe(16);

    // Finding f_old from restored snapshot was evaluated: since empty workspace has 0 findings, f_old was resolved!
    expect(outcome.reconciliation?.previousSnapshot?.generation).toBe(15);
    expect(
      outcome.reconciliation?.eventsEmitted.some(
        (e) => e.findingId === "finding:f_old" && e.transitionKind === "resolved"
      )
    ).toBe(true);
  });

  // 17. Deduplicates concurrent restoreSession calls for the same workspace
  it("17. deduplicates concurrent restoreSession calls for the same workspace", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "empty",
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

    const p1 = coordinator.restoreSession(testWorkspaceId);
    const p2 = coordinator.restoreSession(testWorkspaceId);

    expect(p1).toBe(p2); // Exact same promise returned!

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toEqual(res2);
  });

  // 18. Storage I/O failure during restoration aborts scan safely
  it("18. aborts workspace scan and does not overwrite state if storage I/O error occurs during restoration", async () => {
    const failingPersistence = {
      id: "failing-io",
      loadLatestSnapshot: async () => {
        throw new StorageIOError("Disk unreadable due to hardware fault");
      },
      saveSnapshot: async () => {},
      loadLifecycleHistory: async () => [],
      appendLifecycleEvents: async () => {},
      pruneLifecycleHistory: async () => 0,
      clearCache: async () => {},
      resetHistory: async () => {}
    };

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
      persistence: failingPersistence,
      logger
    });

    // Trigger scan without explicit restoreSession
    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("storage I/O failure during state restoration");
    expect(engine.requests).toHaveLength(0); // Engine was NEVER invoked!
  });

  // 19. Preserves persisted snapshot and history on snapshot write failure
  it("19. preserves persisted snapshot and history on snapshot write failure", async () => {
    const persistence = createPersistenceAdapter();
    const initialSnapshot = createSampleSnapshot(testWorkspaceId, 5, [
      {
        id: "finding:f1",
        ruleId: "UND200",
        category: "shape",
        severity: "error",
        state: "active",
        title: "f1",
        summary: "s",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        firstObservedAt: 1700000000000,
        lastConfirmedAt: 1700000005000
      }
    ]);
    await persistence.saveSnapshot(testWorkspaceId, initialSnapshot);

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [createSampleFinding("f1"), createSampleFinding("f2")],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    // Inject failure on saveSnapshot
    const realSaveSnapshot = persistence.saveSnapshot.bind(persistence);
    persistence.saveSnapshot = async (ws, snap) => {
      if (snap.generation > 5) {
        throw new StorageIOError("Simulated snapshot write failure on disk");
      }
      return realSaveSnapshot(ws, snap);
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success"); // Engine analysis completed
    expect(outcome.persistenceStatus).toBe("failed");
    expect(outcome.persistenceError).toContain("Simulated snapshot write failure");

    // Inspect disk state directly
    persistence.saveSnapshot = realSaveSnapshot;
    const diskSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(diskSnapshot?.generation).toBe(5); // Preserved at 5!

    const diskHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(diskHistory).toHaveLength(0); // No events leaked!

    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(5);
  });

  // 20. Rolls back candidate snapshot on lifecycle-event append failure and preserves previous valid state
  it("20. rolls back candidate snapshot on lifecycle-event append failure and preserves previous valid state on disk", async () => {
    const persistence = createPersistenceAdapter();
    const initialSnapshot = createSampleSnapshot(testWorkspaceId, 5, [
      {
        id: "finding:f1",
        ruleId: "UND200",
        category: "shape",
        severity: "error",
        state: "active",
        title: "f1",
        summary: "s",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        firstObservedAt: 1700000000000,
        lastConfirmedAt: 1700000005000
      }
    ]);
    await persistence.saveSnapshot(testWorkspaceId, initialSnapshot);

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    // Detects new finding f2
    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [createSampleFinding("f1"), createSampleFinding("f2")],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    // Inject failure on appendLifecycleEvents
    const realAppend = persistence.appendLifecycleEvents.bind(persistence);
    persistence.appendLifecycleEvents = async () => {
      throw new StorageIOError("Disk write failure while appending lifecycle events");
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.persistenceStatus).toBe("failed");
    expect(outcome.persistenceError).toContain("appending lifecycle events");

    // Inspect disk state directly: snapshot MUST HAVE BEEN ROLLED BACK to 5!
    persistence.appendLifecycleEvents = realAppend;
    const diskSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(diskSnapshot?.generation).toBe(5);
    expect(diskSnapshot?.findings).toHaveLength(1);
    expect(diskSnapshot?.findings[0].id).toBe("finding:f1");

    const diskHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(diskHistory).toHaveLength(0);

    // In-memory state remains at previous valid snapshot
    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(5);
  });

  // 21. Recovers cleanly on scan retry after lifecycle-event append failure
  it("21. recovers cleanly on scan retry after lifecycle-event append failure without losing or duplicating transitions", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
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

    let failAppend = true;
    const realAppend = persistence.appendLifecycleEvents.bind(persistence);
    persistence.appendLifecycleEvents = async (ws, evts) => {
      if (failAppend) {
        throw new StorageIOError("Transient disk error on events file");
      }
      return realAppend(ws, evts);
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();

    // Scan 1: appendLifecycleEvents fails
    const outcome1 = await coordinator.runWorkspaceScan();
    expect(outcome1.persistenceStatus).toBe("failed");

    // Disk snapshot was rolled back (deleted since no prior snapshot existed)
    failAppend = false;
    const snapshotAfterFail = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(snapshotAfterFail).toBeUndefined();

    // Scan 2 (retry): appendLifecycleEvents now succeeds
    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.status).toBe("success");
    expect(outcome2.persistenceStatus).toBe("saved");

    // Inspect disk state directly
    const snapshotAfterRetry = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(snapshotAfterRetry).toBeDefined();
    expect(snapshotAfterRetry?.findings).toHaveLength(1);

    const historyAfterRetry = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(historyAfterRetry).toHaveLength(1);
    expect(historyAfterRetry[0].findingId).toBe("finding:f1");
    expect(historyAfterRetry[0].transitionKind).toBe("detected");
  });

  // 22. Preserves valid complete snapshot when retention pruning fails and reports failure truthfully
  it("22. preserves valid complete snapshot when retention pruning fails and reports failure truthfully", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
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

    // Inject failure on pruneLifecycleHistory
    const realPrune = persistence.pruneLifecycleHistory.bind(persistence);
    persistence.pruneLifecycleHistory = async () => {
      throw new StorageIOError("Retention pruning failed due to disk lock");
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      retentionPolicy: { maxEventsPerWorkspace: 2 },
      logger
    });

    await coordinator.restoreSession();

    const outcome = await coordinator.runWorkspaceScan();

    expect(outcome.status).toBe("success");
    expect(outcome.persistenceStatus).toBe("failed");
    expect(outcome.persistenceError).toContain("Retention pruning failed");

    // Snapshot was preserved on disk and in memory
    persistence.pruneLifecycleHistory = realPrune;
    const diskSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(diskSnapshot).toBeDefined();
    expect(diskSnapshot?.generation).toBe(1);

    const diskHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(diskHistory).toHaveLength(1);

    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(1);
  });

  // 23. Quarantines corrupt snapshot while preserving valid lifecycle history
  it("23. quarantines corrupt snapshot while preserving valid lifecycle history", async () => {
    const persistence = createPersistenceAdapter();

    const wsDir = joinStorageUri(
      storageRoot,
      "workspaces",
      getWorkspaceStorageKey(testWorkspaceId)
    );
    await inMemoryFs.createDirectory(wsDir);

    // Corrupt snapshot
    const snapshotUri = joinStorageUri(wsDir, "snapshot.json");
    await inMemoryFs.writeFile(snapshotUri, new TextEncoder().encode("bad json content"));

    // Valid history with 2 events
    const validEvents: FindingLifecycleEvent[] = [
      {
        eventId: "evt:1:1",
        workspaceId: testWorkspaceId,
        findingId: "finding:f1",
        transitionKind: "detected",
        observedAt: 1700000000000,
        triggerGeneration: 1,
        newState: "active"
      },
      {
        eventId: "evt:2:2",
        workspaceId: testWorkspaceId,
        findingId: "finding:f1",
        transitionKind: "resolved",
        observedAt: 1700000005000,
        triggerGeneration: 2,
        newState: "resolved"
      }
    ];
    const historyUri = joinStorageUri(wsDir, "history.json");
    await inMemoryFs.writeFile(
      historyUri,
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: LIFECYCLE_HISTORY_SCHEMA_VERSION,
          workspaceId: testWorkspaceId,
          events: validEvents
        })
      )
    );

    const wm = createMockWorkspaceManager({
      status: "empty",
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
    // Valid history is preserved!
    expect(restored.history).toHaveLength(2);
    expect(restored.seededGeneration).toBe(0);

    expect(coordinator.getLastKnownSnapshot()).toBeUndefined();
    expect(coordinator.getLastKnownHistory()).toHaveLength(2);
  });

  // 24. Quarantines corrupt history while preserving valid snapshot
  it("24. quarantines corrupt history while preserving valid snapshot", async () => {
    const persistence = createPersistenceAdapter();

    const wsDir = joinStorageUri(
      storageRoot,
      "workspaces",
      getWorkspaceStorageKey(testWorkspaceId)
    );
    await inMemoryFs.createDirectory(wsDir);

    // Valid snapshot at generation 8
    const validSnapshot = createSampleSnapshot(testWorkspaceId, 8, [
      {
        id: "finding:f8",
        ruleId: "UND200",
        category: "shape",
        severity: "error",
        state: "active",
        title: "f8",
        summary: "s",
        evidenceStrength: "exact",
        sourceLocations: [],
        limitations: [],
        firstObservedAt: 1700000000000,
        lastConfirmedAt: 1700000008000
      }
    ]);
    const snapshotUri = joinStorageUri(wsDir, "snapshot.json");
    await inMemoryFs.writeFile(
      snapshotUri,
      new TextEncoder().encode(JSON.stringify(validSnapshot))
    );

    // Corrupt history
    const historyUri = joinStorageUri(wsDir, "history.json");
    await inMemoryFs.writeFile(historyUri, new TextEncoder().encode("bad json history"));

    const wm = createMockWorkspaceManager({
      status: "empty",
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
    // Valid snapshot is preserved!
    expect(restored.snapshot).toBeDefined();
    expect(restored.snapshot?.generation).toBe(8);
    expect(restored.seededGeneration).toBe(8);
    expect(restored.history).toHaveLength(0);

    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(8);
    expect(coordinator.getLastKnownHistory()).toEqual([]);
  });

  // 25. Rethrows real StorageIOError during snapshot or history restoration
  it("25. rethrows real StorageIOError during snapshot or history restoration", async () => {
    const failingSnapshotPersistence = {
      id: "failing-snapshot",
      loadLatestSnapshot: async () => {
        throw new StorageIOError("Disk unreadable on snapshot read");
      },
      saveSnapshot: async () => {},
      loadLifecycleHistory: async () => [],
      appendLifecycleEvents: async () => {},
      pruneLifecycleHistory: async () => 0,
      clearCache: async () => {},
      resetHistory: async () => {}
    };

    const wm = createMockWorkspaceManager({
      status: "empty",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 0,
      totalAcquired: 0
    });

    const coordinator1 = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence: failingSnapshotPersistence,
      logger
    });

    await expect(coordinator1.restoreSession()).rejects.toThrow(StorageIOError);

    const failingHistoryPersistence = {
      id: "failing-history",
      loadLatestSnapshot: async () => undefined,
      saveSnapshot: async () => {},
      loadLifecycleHistory: async () => {
        throw new StorageIOError("Disk unreadable on history read");
      },
      appendLifecycleEvents: async () => {},
      pruneLifecycleHistory: async () => 0,
      clearCache: async () => {},
      resetHistory: async () => {}
    };

    const coordinator2 = new AnalysisCoordinator({
      workspaceManager: wm,
      persistence: failingHistoryPersistence,
      logger
    });

    await expect(coordinator2.restoreSession()).rejects.toThrow(StorageIOError);
  });

  // 26. Regression test: normal completed scans with unchanged findings and generation gaps are not falsely classified as interrupted writes
  it("26. ensures normal completed scans with unchanged findings and generation gaps are not falsely classified as interrupted writes", async () => {
    const persistence = createPersistenceAdapter();

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
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

    // Scan 1: initial detection of f1 -> generation 1, 1 event emitted
    const outcome1 = await coordinator.runWorkspaceScan();
    expect(outcome1.status).toBe("success");
    expect(outcome1.generation).toBe(1);
    expect(outcome1.reconciliation?.eventsEmitted).toHaveLength(1);
    expect(outcome1.reconciliation?.eventsEmitted[0].triggerGeneration).toBe(1);

    // Scan 2: unchanged findings -> generation 2, 0 events emitted
    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.status).toBe("success");
    expect(outcome2.generation).toBe(2);
    expect(outcome2.reconciliation?.eventsEmitted).toHaveLength(0);
    expect(outcome2.reconciliation?.unchangedFindingCount).toBe(1);

    // Scan 3: unchanged findings -> generation 3, 0 events emitted
    const outcome3 = await coordinator.runWorkspaceScan();
    expect(outcome3.status).toBe("success");
    expect(outcome3.generation).toBe(3);
    expect(outcome3.reconciliation?.eventsEmitted).toHaveLength(0);
    expect(outcome3.reconciliation?.unchangedFindingCount).toBe(1);

    // Inspect disk state: snapshot generation is 3, while history triggerGeneration is 1!
    const diskSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(diskSnapshot?.generation).toBe(3);

    const diskHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(diskHistory).toHaveLength(1);
    expect(diskHistory[0].triggerGeneration).toBe(1);

    // Simulate restart with a fresh AnalysisCoordinator instance pointing to the same persistence adapter
    const restartedCoordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    const restoredState = await restartedCoordinator.restoreSession();

    // Verify clean restoration: must NOT be quarantined, marked corrupted, or treated as interrupted write
    expect(restoredState.status).toBe("restored");
    expect(restoredState.seededGeneration).toBe(3);
    expect(restoredState.snapshot?.generation).toBe(3);
    expect(restoredState.history).toHaveLength(1);
    expect(restoredState.warningMessage).toBeUndefined();

    expect(restartedCoordinator.getLastKnownSnapshot()?.generation).toBe(3);
    expect(restartedCoordinator.getLastKnownHistory()).toHaveLength(1);

    // Subsequent scan on restarted coordinator resumes monotonically from generation 3 -> generation 4
    const outcome4 = await restartedCoordinator.runWorkspaceScan();
    expect(outcome4.status).toBe("success");
    expect(outcome4.generation).toBe(4);
    expect(outcome4.reconciliation?.previousSnapshot?.generation).toBe(3);
    expect(outcome4.reconciliation?.unchangedFindingCount).toBe(1);
    expect(outcome4.reconciliation?.eventsEmitted).toHaveLength(0);
    expect(outcome4.persistenceStatus).toBe("saved");
  });

  // 27. Regression test: runtime append failure with existing prior snapshot rolls back to prior snapshot and retries cleanly
  it("27. rolls back to prior snapshot on lifecycle-event append failure when prior snapshot exists and retries cleanly", async () => {
    const persistence = createPersistenceAdapter();

    // Seed prior snapshot at generation 10 with finding f1
    const priorFinding = createSampleFinding("f1");
    const priorSnapshot = createSampleSnapshot(testWorkspaceId, 10, [
      toPersistedFindingRecord(priorFinding, 1700000000000, 1700000010000)
    ]);
    await persistence.saveSnapshot(testWorkspaceId, priorSnapshot);

    const initialHistory: FindingLifecycleEvent[] = [
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
    await persistence.appendLifecycleEvents(testWorkspaceId, initialHistory);

    const wm = createMockWorkspaceManager({
      status: "success",
      workspaceRootUris: [testWorkspaceId],
      documents: [],
      failures: [],
      totalDiscovered: 1,
      totalAcquired: 1
    });

    // Engine detects f1 and new finding f2
    const engine = createMockEngine(async (req) => ({
      workspaceId: req.workspaceId,
      generation: req.generation,
      generatedAt: Date.now(),
      complete: true,
      observations: [],
      relationships: [],
      findings: [createSampleFinding("f1"), createSampleFinding("f2")],
      warnings: [],
      statistics: createSampleStatistics()
    }));

    // Inject append failure on next scan
    let failAppend = true;
    const realAppend = persistence.appendLifecycleEvents.bind(persistence);
    persistence.appendLifecycleEvents = async (ws, evts) => {
      if (failAppend) {
        throw new StorageIOError("Simulated disk error appending lifecycle events");
      }
      return realAppend(ws, evts);
    };

    const coordinator = new AnalysisCoordinator({
      workspaceManager: wm,
      engine,
      persistence,
      logger
    });

    await coordinator.restoreSession();
    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(10);

    // Scan 1: generation 11, append fails
    const outcome1 = await coordinator.runWorkspaceScan();
    expect(outcome1.status).toBe("success");
    expect(outcome1.generation).toBe(11);
    expect(outcome1.persistenceStatus).toBe("failed");
    expect(outcome1.persistenceError).toContain("appending lifecycle events");

    // In-memory coordinator snapshot is preserved at generation 10
    expect(coordinator.getLastKnownSnapshot()?.generation).toBe(10);
    expect(coordinator.getLastKnownSnapshot()?.findings).toHaveLength(1);

    // Disk snapshot is verified rolled back to generation 10
    persistence.appendLifecycleEvents = realAppend;
    const diskSnapshotAfterFail = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(diskSnapshotAfterFail?.generation).toBe(10);
    expect(diskSnapshotAfterFail?.findings).toHaveLength(1);
    expect(diskSnapshotAfterFail?.findings[0].id).toBe("finding:f1");

    // Disk history remains untouched with 1 event
    const diskHistoryAfterFail = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(diskHistoryAfterFail).toHaveLength(1);

    // Scan 2 (retry): transient failure cleared
    failAppend = false;
    const outcome2 = await coordinator.runWorkspaceScan();
    expect(outcome2.status).toBe("success");
    expect(outcome2.generation).toBe(12);
    expect(outcome2.persistenceStatus).toBe("saved");

    // Disk snapshot safely advanced to generation 12 with both findings
    const finalDiskSnapshot = await persistence.loadLatestSnapshot(testWorkspaceId);
    expect(finalDiskSnapshot?.generation).toBe(12);
    expect(finalDiskSnapshot?.findings).toHaveLength(2);

    // Disk history has exactly 2 events: f1 detected at gen 1, f2 detected at gen 12
    const finalDiskHistory = await persistence.loadLifecycleHistory(testWorkspaceId);
    expect(finalDiskHistory).toHaveLength(2);
    expect(finalDiskHistory.map((e) => e.findingId).sort()).toEqual(["finding:f1", "finding:f2"]);
    expect(finalDiskHistory.find((e) => e.findingId === "finding:f2")?.triggerGeneration).toBe(12);
  });
});
