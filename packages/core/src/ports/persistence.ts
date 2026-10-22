// State persistence and reconciliation ports strictly adhering to LLD.md Sections 5.6 and 5.7.
// Declares interfaces for snapshot loading/saving, lifecycle history, retention policy, and state reconciliation.

import type { AnalysisResult } from "./engine";
import type {
  AnalysisSnapshot,
  FindingLifecycleEvent,
  FindingLifecycleTransition,
  ReconciliationResult,
  StateReconciliationOptions
} from "../domain/snapshot";
import type { FindingId, WorkspaceId } from "../domain/types";

/**
 * Filter parameters for querying historical finding lifecycle events
 * as specified in LLD.md Section 5.6.
 */
export interface HistoryFilter {
  /** Optional filter by finding identifier. */
  findingId?: FindingId;
  /** Optional filter by transition kind ('detected' | 'changed' | 'resolved' | 'reintroduced'). */
  transitionKind?: FindingLifecycleTransition;
  /** Optional epoch timestamp lower bound (inclusive). */
  sinceTimestamp?: number;
  /** Maximum number of records to return. */
  limit?: number;
}

/**
 * Retention policy configuration for historical finding lifecycle events
 * as specified in LLD.md Section 5.6.
 */
export interface RetentionPolicy {
  /** Number of days to retain historical lifecycle events before pruning. */
  retentionDays?: number;
  /** Maximum number of historical events to retain per workspace. */
  maxEventsPerWorkspace?: number;
}

/**
 * Persistence port contract for managing snapshots and lifecycle event history
 * strictly adhering to LLD.md Section 5.6.
 *
 * Implemented in Phase 4 by the VS Code host layer using workspace-scoped extension storage
 * (ExtensionContext.storageUri and ExtensionContext.workspaceState).
 *
 * Note: Interface declaration only for Chunk 3.8. No persistence adapter or disk writes are implemented.
 */
export interface StatePersistencePort {
  /** Stable identifier of the persistence provider adapter. */
  readonly id: string;
  /** Loads the most recent verified complete analysis snapshot for a workspace, if one exists. */
  loadLatestSnapshot(workspaceId: WorkspaceId): Promise<AnalysisSnapshot | undefined>;
  /** Atomically persists an updated complete analysis snapshot for a workspace. */
  saveSnapshot(workspaceId: WorkspaceId, snapshot: AnalysisSnapshot): Promise<void>;
  /** Loads filtered historical finding lifecycle events for a workspace. */
  loadLifecycleHistory(
    workspaceId: WorkspaceId,
    filter?: HistoryFilter
  ): Promise<readonly FindingLifecycleEvent[]>;
  /** Appends newly derived finding lifecycle events to the workspace transition history. */
  appendLifecycleEvents(
    workspaceId: WorkspaceId,
    events: readonly FindingLifecycleEvent[]
  ): Promise<void>;
  /** Prunes historical lifecycle events according to retention policy without altering snapshots. */
  pruneLifecycleHistory(workspaceId: WorkspaceId, policy: RetentionPolicy): Promise<number>;
  /** Clears disposable in-memory caches without discarding snapshots or history. */
  clearCache(): Promise<void>;
  /** Resets snapshot and history storage for a workspace session. */
  resetHistory(workspaceId: WorkspaceId): Promise<void>;
  /** Deletes the persisted analysis snapshot for a workspace (e.g. for rollback). */
  deleteSnapshot?(workspaceId: WorkspaceId): Promise<void>;
}

/**
 * State reconciliation port contract for comparing a newly completed analysis against
 * the previous complete snapshot strictly adhering to LLD.md Section 5.7.
 */
export interface StateReconciliationPort {
  /** Stable identifier of the reconciliation engine. */
  readonly id: string;
  /**
   * Reconciles current analysis results with the prior snapshot to derive lifecycle transitions,
   * detect material changes, enforce coverage gating, and assemble candidate next snapshots.
   */
  reconcile(
    currentResult: AnalysisResult,
    previousSnapshot: AnalysisSnapshot | undefined,
    options?: StateReconciliationOptions
  ): ReconciliationResult;
}
