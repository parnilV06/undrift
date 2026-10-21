// Phase 4, Chunk 4.1: Workspace State Persistence Adapter Tests
// Covers all 17 requirements specified in the Chunk 4.1 contract.

import { beforeEach, describe, expect, it } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisSnapshot,
  FindingLifecycleEvent,
  PersistedFindingRecord,
  WorkspaceId
} from "@undrift/core";
import { LIFECYCLE_HISTORY_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION } from "@undrift/core";
import {
  createInMemoryStorageFileSystem,
  type InMemoryStorageFileSystem,
  IncompleteSnapshotError,
  type StorageLogger,
  StorageUnavailableError,
  WorkspaceMismatchError,
  WorkspaceStatePersistenceAdapter
} from "../../apps/vscode-extension/src/storage";
import type { UriLike } from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";

function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "/")
  };
}

class TestLogger implements StorageLogger {
  readonly warnings: { message: string; error?: unknown }[] = [];
  readonly infos: string[] = [];
  readonly errors: { message: string; error?: unknown }[] = [];

  warn(message: string, error?: unknown): void {
    this.warnings.push({ message, error });
  }

  info(message: string): void {
    this.infos.push(message);
  }

  error(message: string, error?: unknown): void {
    this.errors.push({ message, error });
  }
}

function createSampleFinding(
  id: string,
  overrides?: Partial<PersistedFindingRecord>
): PersistedFindingRecord {
  return {
    id: `finding:${id}`,
    ruleId: "UND100",
    category: "protocol",
    severity: "error",
    state: "active",
    title: `Sample finding ${id}`,
    summary: `Structured summary for finding ${id}`,
    evidenceStrength: "exact",
    relationshipId: `rel:${id}`,
    sourceLocations: [
      {
        uri: "file:///workspace/src/client.ts",
        range: { start: 10, end: 50 },
        start: { line: 1, character: 0 },
        end: { line: 2, character: 10 }
      }
    ],
    expected: { method: "POST", path: "/api/users" },
    observed: { method: "GET", path: "/api/users" },
    limitations: [],
    firstObservedAt: 1000,
    lastConfirmedAt: 2000,
    ...overrides
  };
}

function createSampleCoverage(
  overrides?: Partial<AnalysisCoverageSummary>
): AnalysisCoverageSummary {
  return {
    complete: true,
    filesScanned: 5,
    filesWithWarnings: 0,
    unresolvedPatterns: 0,
    warnings: [],
    ...overrides
  };
}

function createSampleSnapshot(
  workspaceId: WorkspaceId,
  overrides?: Partial<AnalysisSnapshot>
): AnalysisSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: `snap-${workspaceId}-gen1`,
    workspaceId,
    generation: 1,
    analyzedAt: 1700000000000,
    coverage: createSampleCoverage(overrides?.coverage),
    findings: [createSampleFinding("1"), createSampleFinding("2")],
    integrityHash: "sha256-sample-hash",
    ...overrides
  };
}

function createSampleEvent(
  workspaceId: WorkspaceId,
  eventId: string,
  overrides?: Partial<FindingLifecycleEvent>
): FindingLifecycleEvent {
  return {
    eventId,
    workspaceId,
    findingId: `finding:${eventId}`,
    transitionKind: "detected",
    observedAt: 1700000001000,
    triggerGeneration: 1,
    newState: "active",
    context: {
      reason: "Initial detection during analysis"
    },
    ...overrides
  };
}

describe("Phase 4, Chunk 4.1: WorkspaceStatePersistenceAdapter", () => {
  let inMemoryFs: InMemoryStorageFileSystem;
  let logger: TestLogger;
  let adapter: WorkspaceStatePersistenceAdapter;
  const storageRoot = makeUri("vscode-storage:/test-storage-root");
  let simulatedTime: number;

  beforeEach(() => {
    inMemoryFs = createInMemoryStorageFileSystem();
    logger = new TestLogger();
    simulatedTime = 1700000000000;

    adapter = new WorkspaceStatePersistenceAdapter({
      storageUri: storageRoot,
      fileSystem: inMemoryFs,
      logger,
      now: () => simulatedTime
    });
  });

  // 1. Snapshot save/load round trip
  it("1. saves and loads a complete analysis snapshot preserving all fields and types", async () => {
    const ws: WorkspaceId = "ws-roundtrip";
    const snapshot = createSampleSnapshot(ws);

    await adapter.saveSnapshot(ws, snapshot);
    const loaded = await adapter.loadLatestSnapshot(ws);

    expect(loaded).toBeDefined();
    expect(loaded).toEqual(snapshot);
    expect(loaded?.findings).toHaveLength(2);
    expect(loaded?.findings[0]?.expected).toEqual({ method: "POST", path: "/api/users" });
    expect(loaded?.findings[0]?.sourceLocations[0]?.uri).toBe("file:///workspace/src/client.ts");
  });

  // 2. Lifecycle-event append/load
  it("2. appends lifecycle events and loads complete event history", async () => {
    const ws: WorkspaceId = "ws-events";
    const events: FindingLifecycleEvent[] = [
      createSampleEvent(ws, "evt-1", { transitionKind: "detected", observedAt: 100 }),
      createSampleEvent(ws, "evt-2", {
        transitionKind: "changed",
        observedAt: 200,
        context: { previousSeverity: "warning", newSeverity: "error" }
      }),
      createSampleEvent(ws, "evt-3", { transitionKind: "resolved", observedAt: 300 })
    ];

    await adapter.appendLifecycleEvents(ws, events);
    const loaded = await adapter.loadLifecycleHistory(ws);

    expect(loaded).toHaveLength(3);
    expect(loaded[0]?.eventId).toBe("evt-1");
    expect(loaded[1]?.context?.previousSeverity).toBe("warning");
    expect(loaded[2]?.transitionKind).toBe("resolved");
  });

  // 3. Isolation between different workspace IDs
  it("3. strictly isolates snapshots and event history between different workspaces", async () => {
    const wsA: WorkspaceId = "workspace-alpha";
    const wsB: WorkspaceId = "workspace-beta";

    const snapA = createSampleSnapshot(wsA, { snapshotId: "snap-alpha" });
    const snapB = createSampleSnapshot(wsB, { snapshotId: "snap-beta" });

    const evtA = [createSampleEvent(wsA, "evt-a")];
    const evtB = [createSampleEvent(wsB, "evt-b")];

    await adapter.saveSnapshot(wsA, snapA);
    await adapter.saveSnapshot(wsB, snapB);
    await adapter.appendLifecycleEvents(wsA, evtA);
    await adapter.appendLifecycleEvents(wsB, evtB);

    const loadedA = await adapter.loadLatestSnapshot(wsA);
    const loadedB = await adapter.loadLatestSnapshot(wsB);
    const histA = await adapter.loadLifecycleHistory(wsA);
    const histB = await adapter.loadLifecycleHistory(wsB);

    expect(loadedA?.snapshotId).toBe("snap-alpha");
    expect(loadedB?.snapshotId).toBe("snap-beta");
    expect(histA).toHaveLength(1);
    expect(histA[0]?.eventId).toBe("evt-a");
    expect(histB).toHaveLength(1);
    expect(histB[0]?.eventId).toBe("evt-b");
  });

  // 4. Missing records versus unavailable storage
  it("4. distinguishes genuinely missing records from unavailable storage", async () => {
    const ws: WorkspaceId = "ws-missing";

    // Storage is available, but records don't exist yet: returns undefined / empty array
    const snapshot = await adapter.loadLatestSnapshot(ws);
    const history = await adapter.loadLifecycleHistory(ws);
    expect(snapshot).toBeUndefined();
    expect(history).toEqual([]);

    // Unavailable storage: throws StorageUnavailableError
    const unavailableAdapter = new WorkspaceStatePersistenceAdapter({
      storageUri: undefined,
      fileSystem: inMemoryFs
    });

    await expect(unavailableAdapter.loadLatestSnapshot(ws)).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(unavailableAdapter.loadLifecycleHistory(ws)).rejects.toThrow(
      StorageUnavailableError
    );
  });

  // 5. Filtering by finding ID, transition kind, timestamp, and limit
  it("5. filters lifecycle history by findingId, transitionKind, timestamp, and limit", async () => {
    const ws: WorkspaceId = "ws-filter";
    const events: FindingLifecycleEvent[] = [
      createSampleEvent(ws, "evt-1", {
        findingId: "f:1",
        transitionKind: "detected",
        observedAt: 1000
      }),
      createSampleEvent(ws, "evt-2", {
        findingId: "f:1",
        transitionKind: "changed",
        observedAt: 2000
      }),
      createSampleEvent(ws, "evt-3", {
        findingId: "f:2",
        transitionKind: "detected",
        observedAt: 3000
      }),
      createSampleEvent(ws, "evt-4", {
        findingId: "f:1",
        transitionKind: "resolved",
        observedAt: 4000
      })
    ];

    await adapter.appendLifecycleEvents(ws, events);

    // Filter by findingId
    const byFinding = await adapter.loadLifecycleHistory(ws, { findingId: "f:1" });
    expect(byFinding.map((e) => e.eventId)).toEqual(["evt-1", "evt-2", "evt-4"]);

    // Filter by transitionKind
    const byKind = await adapter.loadLifecycleHistory(ws, { transitionKind: "detected" });
    expect(byKind.map((e) => e.eventId)).toEqual(["evt-1", "evt-3"]);

    // Filter by sinceTimestamp (inclusive)
    const byTime = await adapter.loadLifecycleHistory(ws, { sinceTimestamp: 2000 });
    expect(byTime.map((e) => e.eventId)).toEqual(["evt-2", "evt-3", "evt-4"]);

    // Filter with limit
    const withLimit = await adapter.loadLifecycleHistory(ws, { limit: 2 });
    expect(withLimit.map((e) => e.eventId)).toEqual(["evt-1", "evt-2"]);

    // Combined filter
    const combined = await adapter.loadLifecycleHistory(ws, {
      findingId: "f:1",
      sinceTimestamp: 2000,
      limit: 1
    });
    expect(combined.map((e) => e.eventId)).toEqual(["evt-2"]);
  });

  // 6. Deterministic ordering and duplicate event handling
  it("6. guarantees deterministic chronological ordering and idempotent duplicate handling", async () => {
    const ws: WorkspaceId = "ws-ordering";

    // Append events out of chronological order
    await adapter.appendLifecycleEvents(ws, [
      createSampleEvent(ws, "evt-c", { observedAt: 300 }),
      createSampleEvent(ws, "evt-a", { observedAt: 100 }),
      createSampleEvent(ws, "evt-b", { observedAt: 200 })
    ]);

    const ordered = await adapter.loadLifecycleHistory(ws);
    expect(ordered.map((e) => e.eventId)).toEqual(["evt-a", "evt-b", "evt-c"]);

    // Append duplicate event with same eventId
    await adapter.appendLifecycleEvents(ws, [
      createSampleEvent(ws, "evt-b", { observedAt: 200, context: { reason: "duplicate" } })
    ]);

    const deduplicated = await adapter.loadLifecycleHistory(ws);
    expect(deduplicated).toHaveLength(3);
    expect(deduplicated.map((e) => e.eventId)).toEqual(["evt-a", "evt-b", "evt-c"]);
  });

  // 7. Retention by age and maximum event count
  it("7. prunes lifecycle history by duration and maxEventsPerWorkspace limits", async () => {
    const ws: WorkspaceId = "ws-retention";
    const dayMs = 86_400_000;
    simulatedTime = 100 * dayMs;

    const events: FindingLifecycleEvent[] = [
      createSampleEvent(ws, "evt-day10", { observedAt: 10 * dayMs }),
      createSampleEvent(ws, "evt-day20", { observedAt: 20 * dayMs }),
      createSampleEvent(ws, "evt-day80", { observedAt: 80 * dayMs }),
      createSampleEvent(ws, "evt-day90", { observedAt: 90 * dayMs }),
      createSampleEvent(ws, "evt-day95", { observedAt: 95 * dayMs })
    ];

    await adapter.appendLifecycleEvents(ws, events);

    // Prune events older than 30 days (older than day 70)
    const prunedByAge = await adapter.pruneLifecycleHistory(ws, { retentionDays: 30 });
    expect(prunedByAge).toBe(2);

    let remaining = await adapter.loadLifecycleHistory(ws);
    expect(remaining.map((e) => e.eventId)).toEqual(["evt-day80", "evt-day90", "evt-day95"]);

    // Prune by max events count (keep 2 newest)
    const prunedByCount = await adapter.pruneLifecycleHistory(ws, { maxEventsPerWorkspace: 2 });
    expect(prunedByCount).toBe(1);

    remaining = await adapter.loadLifecycleHistory(ws);
    expect(remaining.map((e) => e.eventId)).toEqual(["evt-day90", "evt-day95"]);

    // No policy specified: no pruning occurs
    const prunedNone = await adapter.pruneLifecycleHistory(ws, {});
    expect(prunedNone).toBe(0);
  });

  // 8. Pruning never alters the latest complete snapshot
  it("8. ensures retention pruning never deletes or alters the latest complete snapshot", async () => {
    const ws: WorkspaceId = "ws-prune-protect";
    const snapshot = createSampleSnapshot(ws);
    const event = createSampleEvent(ws, "evt-1", { observedAt: 100 });

    await adapter.saveSnapshot(ws, snapshot);
    await adapter.appendLifecycleEvents(ws, [event]);

    // Prune all events
    await adapter.pruneLifecycleHistory(ws, { maxEventsPerWorkspace: 0 });

    const history = await adapter.loadLifecycleHistory(ws);
    const loadedSnapshot = await adapter.loadLatestSnapshot(ws);

    expect(history).toHaveLength(0);
    expect(loadedSnapshot).toEqual(snapshot);
  });

  // 9. Cache clearing does not erase durable state
  it("9. clears in-memory caches without erasing durable persisted data on disk", async () => {
    const ws: WorkspaceId = "ws-cache-clear";
    const snapshot = createSampleSnapshot(ws);
    const event = createSampleEvent(ws, "evt-1");

    await adapter.saveSnapshot(ws, snapshot);
    await adapter.appendLifecycleEvents(ws, [event]);

    // Clear cache
    await adapter.clearCache();

    // Data should reload intact from disk
    const reloadedSnapshot = await adapter.loadLatestSnapshot(ws);
    const reloadedHistory = await adapter.loadLifecycleHistory(ws);

    expect(reloadedSnapshot).toEqual(snapshot);
    expect(reloadedHistory).toEqual([event]);
  });

  // 10. History reset respects snapshot ownership
  it("10. resets history without deleting the latest snapshot", async () => {
    const ws: WorkspaceId = "ws-reset-history";
    const snapshot = createSampleSnapshot(ws);
    const event = createSampleEvent(ws, "evt-1");

    await adapter.saveSnapshot(ws, snapshot);
    await adapter.appendLifecycleEvents(ws, [event]);

    await adapter.resetHistory(ws);

    const historyAfterReset = await adapter.loadLifecycleHistory(ws);
    const snapshotAfterReset = await adapter.loadLatestSnapshot(ws);

    expect(historyAfterReset).toEqual([]);
    expect(snapshotAfterReset).toEqual(snapshot);
  });

  // 11. Malformed JSON and unsupported schema recovery
  it("11. recovers safely from malformed JSON and unsupported schema versions by quarantining", async () => {
    const ws: WorkspaceId = "ws-corruption";
    const snapshot = createSampleSnapshot(ws);
    await adapter.saveSnapshot(ws, snapshot);

    await adapter.clearCache();

    // Corrupt the snapshot file with malformed JSON
    const snapshotFile = Array.from(inMemoryFs.files.keys()).find((k) =>
      k.endsWith("snapshot.json")
    );
    expect(snapshotFile).toBeDefined();
    inMemoryFs.files.set(snapshotFile!, new TextEncoder().encode("{ malformed json: true, "));

    // loadLatestSnapshot should log warning, quarantine file, and return undefined
    const recoveredSnapshot = await adapter.loadLatestSnapshot(ws);
    expect(recoveredSnapshot).toBeUndefined();
    expect(logger.warnings.some((w) => w.message.includes("Malformed JSON"))).toBe(true);

    // Corrupted file moved to quarantine
    const quarantined = Array.from(inMemoryFs.files.keys()).some(
      (k) => k.includes("quarantine") && k.includes(".corrupt.")
    );
    expect(quarantined).toBe(true);

    // Now test unsupported schema version in history
    await adapter.appendLifecycleEvents(ws, [createSampleEvent(ws, "evt-ok")]);
    await adapter.clearCache();

    const historyFile = Array.from(inMemoryFs.files.keys()).find((k) => k.endsWith("history.json"));
    expect(historyFile).toBeDefined();
    const badSchemaPayload = JSON.stringify({
      schemaVersion: 9999,
      workspaceId: ws,
      events: []
    });
    inMemoryFs.files.set(historyFile!, new TextEncoder().encode(badSchemaPayload));

    const recoveredHistory = await adapter.loadLifecycleHistory(ws);
    expect(recoveredHistory).toEqual([]);
    expect(
      logger.warnings.some((w) => w.message.includes("Unsupported lifecycle history schema"))
    ).toBe(true);
  });

  // 12. Wrong workspace identity rejection
  it("12. rejects records and operations with mismatched workspace identities", async () => {
    const ws1: WorkspaceId = "workspace-1";
    const ws2: WorkspaceId = "workspace-2";

    const snapWs2 = createSampleSnapshot(ws2);
    const eventWs2 = createSampleEvent(ws2, "evt-ws2");

    // Rejection on save
    await expect(adapter.saveSnapshot(ws1, snapWs2)).rejects.toThrow(WorkspaceMismatchError);

    // Rejection on append
    await expect(adapter.appendLifecycleEvents(ws1, [eventWs2])).rejects.toThrow(
      WorkspaceMismatchError
    );

    // Rejection on load if file contains mismatched workspaceId
    const snapWs1 = createSampleSnapshot(ws1);
    await adapter.saveSnapshot(ws1, snapWs1);
    await adapter.clearCache();

    const snapshotFile = Array.from(inMemoryFs.files.keys()).find((k) =>
      k.endsWith("snapshot.json")
    );
    const modifiedPayload = JSON.stringify({
      ...snapWs1,
      workspaceId: "rogue-workspace-id"
    });
    inMemoryFs.files.set(snapshotFile!, new TextEncoder().encode(modifiedPayload));

    const result = await adapter.loadLatestSnapshot(ws1);
    expect(result).toBeUndefined();
    expect(
      logger.warnings.some((w) => w.message.includes("does not match expected workspace"))
    ).toBe(true);
  });

  // 13. Invalid events are not accepted as valid history
  it("13. rejects invalid lifecycle events and quarantined corrupted event records", async () => {
    const ws: WorkspaceId = "ws-invalid-events";

    // Rejects event with invalid transition kind
    const badEvent = {
      ...createSampleEvent(ws, "evt-bad"),
      transitionKind: "invalid-transition" as unknown as FindingLifecycleEvent["transitionKind"]
    };

    await expect(adapter.appendLifecycleEvents(ws, [badEvent])).rejects.toThrow();

    // Verify empty
    const history = await adapter.loadLifecycleHistory(ws);
    expect(history).toEqual([]);
  });

  // 14. Incomplete snapshots cannot replace valid complete snapshots
  it("14. rejects incomplete snapshots and preserves the existing complete snapshot", async () => {
    const ws: WorkspaceId = "ws-incomplete-guard";
    const completeSnapshot = createSampleSnapshot(ws, {
      coverage: {
        complete: true,
        filesScanned: 10,
        filesWithWarnings: 0,
        unresolvedPatterns: 0,
        warnings: []
      }
    });

    await adapter.saveSnapshot(ws, completeSnapshot);

    const incompleteSnapshot = createSampleSnapshot(ws, {
      snapshotId: "incomplete-run-attempt",
      coverage: {
        complete: false,
        filesScanned: 2,
        filesWithWarnings: 1,
        unresolvedPatterns: 1,
        warnings: []
      }
    });

    await expect(adapter.saveSnapshot(ws, incompleteSnapshot)).rejects.toThrow(
      IncompleteSnapshotError
    );

    // Existing snapshot must remain intact
    const loaded = await adapter.loadLatestSnapshot(ws);
    expect(loaded?.snapshotId).toBe(completeSnapshot.snapshotId);
  });

  // 15. Failed writes preserve the previous valid snapshot
  it("15. preserves previous valid snapshot if a subsequent write fails", async () => {
    const ws: WorkspaceId = "ws-write-failure";
    const initialSnapshot = createSampleSnapshot(ws, { snapshotId: "snap-initial" });
    await adapter.saveSnapshot(ws, initialSnapshot);

    // Simulate failure during rename/promotion of the new snapshot
    inMemoryFs.faultInjection = { failOnRename: true };

    const nextSnapshot = createSampleSnapshot(ws, { snapshotId: "snap-next" });
    await expect(adapter.saveSnapshot(ws, nextSnapshot)).rejects.toThrow();

    // Clear fault injection and verify the original snapshot is still intact
    inMemoryFs.faultInjection = undefined;
    await adapter.clearCache();

    const loaded = await adapter.loadLatestSnapshot(ws);
    expect(loaded?.snapshotId).toBe("snap-initial");
  });

  // 16. Unavailable workspace storage is reported honestly
  it("16. explicitly reports unavailable workspace storage for all persistence operations", async () => {
    const ws: WorkspaceId = "ws-unavailable";
    const unavailableAdapter = new WorkspaceStatePersistenceAdapter({
      storageUri: undefined,
      fileSystem: inMemoryFs
    });

    const snapshot = createSampleSnapshot(ws);
    const event = createSampleEvent(ws, "evt-1");

    await expect(unavailableAdapter.loadLatestSnapshot(ws)).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(unavailableAdapter.saveSnapshot(ws, snapshot)).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(unavailableAdapter.loadLifecycleHistory(ws)).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(unavailableAdapter.appendLifecycleEvents(ws, [event])).rejects.toThrow(
      StorageUnavailableError
    );
    await expect(
      unavailableAdapter.pruneLifecycleHistory(ws, { maxEventsPerWorkspace: 5 })
    ).rejects.toThrow(StorageUnavailableError);
    await expect(unavailableAdapter.resetHistory(ws)).rejects.toThrow(StorageUnavailableError);
  });

  // 17. Concurrent event writes do not silently lose independent events
  it("17. coordinates concurrent event appends without losing independent events", async () => {
    const ws: WorkspaceId = "ws-concurrency";
    const concurrencyCount = 15;

    // Concurrently trigger independent appends
    const appendPromises = Array.from({ length: concurrencyCount }, (_, i) => {
      const evt = createSampleEvent(ws, `evt-concurrent-${i}`, {
        observedAt: 1000 + i
      });
      return adapter.appendLifecycleEvents(ws, [evt]);
    });

    await Promise.all(appendPromises);

    const history = await adapter.loadLifecycleHistory(ws);
    expect(history).toHaveLength(concurrencyCount);

    const eventIds = history.map((e) => e.eventId);
    for (let i = 0; i < concurrencyCount; i++) {
      expect(eventIds).toContain(`evt-concurrent-${i}`);
    }
  });
});

describe("WorkspaceStatePersistenceAdapter with real NodeStorageFileSystem", () => {
  it("persists and restores snapshots and lifecycle events on disk", async () => {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const { createNodeStorageFileSystem } = await import("../../apps/vscode-extension/src/storage");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "undrift-test-storage-"));

    try {
      const nodeFs = createNodeStorageFileSystem();
      const nodeAdapter = new WorkspaceStatePersistenceAdapter({
        storageUri: {
          toString: () => `file://${tmpDir.replace(/\\/g, "/")}`,
          fsPath: tmpDir
        },
        fileSystem: nodeFs
      });

      const ws: WorkspaceId = "node-disk-ws";
      const snapshot = createSampleSnapshot(ws);
      const events = [createSampleEvent(ws, "evt-node-1")];

      await nodeAdapter.saveSnapshot(ws, snapshot);
      await nodeAdapter.appendLifecycleEvents(ws, events);

      await nodeAdapter.clearCache();

      const loadedSnap = await nodeAdapter.loadLatestSnapshot(ws);
      const loadedHist = await nodeAdapter.loadLifecycleHistory(ws);

      expect(loadedSnap).toEqual(snapshot);
      expect(loadedHist).toEqual(events);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
