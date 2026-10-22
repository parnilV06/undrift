// Analysis coordinator orchestrating workspace snapshotting, core analysis engine execution,
// state persistence, and finding lifecycle reconciliation strictly adhering to
// LLD.md Sections 3, 4.14–4.16, 5.4, 5.6–5.7, 8.1–8.7, 14.1, 14.3, 14.10, and Chunk 4.3.

import * as crypto from "crypto";
import type {
  AnalysisCoverageSummary,
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisStatistics,
  AnalysisWarning,
  DocumentUri,
  FindingLifecycleEvent,
  LanguageAnalyzerPort,
  ParserPort,
  ReconciliationResult,
  ResolvedUndriftConfig,
  RetentionPolicy,
  StatePersistencePort,
  StateReconciliationPort,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine, StateReconciler } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import type { ExtensionLogger } from "../logging/output-channel";
import {
  CorruptedRecordError,
  StorageIOError,
  StorageUnavailableError,
  WorkspaceMismatchError
} from "../storage";
import {
  WorkspaceManager,
  type WorkspaceSnapshotFailure,
  type WorkspaceSnapshotResult
} from "../workspace";

/**
 * Outcome status classification returned by the analysis coordinator.
 */
export type CoordinatorOutcomeStatus = "success" | "incomplete" | "failed" | "no-workspace";

/**
 * Status of the session restoration attempt.
 */
export type SessionRestorationStatus =
  "restored" | "empty-baseline" | "corrupted-quarantined" | "storage-unavailable" | "no-workspace";

/**
 * Result of restoring a persisted session state for a workspace.
 */
export interface RestoredSessionState {
  readonly status: SessionRestorationStatus;
  readonly workspaceId?: WorkspaceId;
  readonly snapshot?: AnalysisSnapshot;
  readonly history?: readonly FindingLifecycleEvent[];
  readonly seededGeneration: number;
  readonly warningMessage?: string;
}

/**
 * Persistence outcome classification for a workspace scan run.
 */
export type PersistenceOutcomeStatus =
  "saved" | "skipped-incomplete" | "skipped-storage-unavailable" | "failed";

/**
 * Structured analysis outcome returned to callers and commands.
 */
export interface CoordinatorAnalysisResult {
  readonly status: CoordinatorOutcomeStatus;
  readonly workspaceId?: WorkspaceId;
  readonly generation?: number;
  readonly result?: AnalysisResult;
  readonly failures?: readonly WorkspaceSnapshotFailure[];
  readonly errorMessage?: string;
  readonly totalDiscovered?: number;
  readonly totalAcquired?: number;
  readonly reconciliation?: ReconciliationResult;
  readonly persistenceStatus?: PersistenceOutcomeStatus;
  readonly persistenceError?: string;
}

/**
 * Lightweight cancellation token abstraction compatible with VS Code CancellationToken.
 */
export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
}

/**
 * Configuration options for AnalysisCoordinator.
 */
export interface AnalysisCoordinatorOptions {
  /**
   * WorkspaceManager instance managing source discovery.
   * If omitted, a default instance is created.
   */
  workspaceManager?: WorkspaceManager;

  /**
   * Core analysis engine instance.
   * If omitted, a production AnalysisEngine is instantiated with standard parser and analyzers.
   */
  engine?: AnalysisEnginePort;

  /**
   * Parser port (optional if engine is provided).
   */
  parser?: ParserPort;

  /**
   * Language analyzer port (optional if engine is provided).
   */
  analyzer?: LanguageAnalyzerPort;

  /**
   * Resolved UNDRIFT configuration.
   */
  config?: ResolvedUndriftConfig;

  /**
   * Diagnostic logger seam.
   */
  logger?: ExtensionLogger;

  /**
   * Explicit flag indicating if coordinator owns the engine and should dispose it.
   */
  ownsEngine?: boolean;

  /**
   * Persistence port for saving/loading snapshots and lifecycle history.
   */
  persistence?: StatePersistencePort;

  /**
   * State reconciliation engine port.
   * If omitted, a default StateReconciler is instantiated.
   */
  reconciler?: StateReconciliationPort;

  /**
   * Optional retention policy configuration for pruning historical lifecycle events.
   */
  retentionPolicy?: RetentionPolicy;
}

/**
 * Default safe configuration if none is provided.
 */
const DEFAULT_CONFIG: ResolvedUndriftConfig = {
  version: 1
};

/**
 * Derives a deterministic, stable WorkspaceId from a set of workspace root URIs.
 *
 * Normalizes trailing slashes, removes duplicates, and sorts alphabetically so that
 * the same set of roots always produces the exact same WorkspaceId regardless of input order.
 */
export function deriveWorkspaceId(workspaceRootUris: readonly string[]): WorkspaceId {
  if (!workspaceRootUris || workspaceRootUris.length === 0) {
    throw new Error("Cannot derive workspaceId from an empty workspace root URI set.");
  }

  const normalized = Array.from(
    new Set(workspaceRootUris.map((u) => u.replace(/\/+$/, "")))
  ).sort();

  if (normalized.length === 1) {
    return normalized[0] as WorkspaceId;
  }

  const combined = normalized.join("::");
  const hash = crypto.createHash("sha256").update(combined, "utf8").digest("hex").slice(0, 16);
  return `multi-root:${hash}` as WorkspaceId;
}

/**
 * Coordinates workspace snapshot discovery, core analysis engine execution,
 * session state restoration, and snapshot reconciliation.
 */
export class AnalysisCoordinator {
  private readonly workspaceManager: WorkspaceManager;
  private readonly engine: AnalysisEnginePort;
  private readonly ownsEngine: boolean;
  private readonly logger?: ExtensionLogger;
  private readonly config: ResolvedUndriftConfig;
  private readonly persistence?: StatePersistencePort;
  private readonly reconciler: StateReconciliationPort;
  private readonly retentionPolicy?: RetentionPolicy;

  /** Monotonically increasing revision generation counter per workspace. */
  private readonly generations = new Map<WorkspaceId, number>();

  /** Restored or verified latest complete snapshot per workspace. */
  private readonly lastKnownSnapshots = new Map<WorkspaceId, AnalysisSnapshot>();

  /** Historical sequence of lifecycle events per workspace. */
  private readonly lastKnownHistories = new Map<WorkspaceId, readonly FindingLifecycleEvent[]>();

  /** Active workspace identifier currently focused. */
  private activeWorkspaceId?: WorkspaceId;

  private disposed = false;

  constructor(options: AnalysisCoordinatorOptions = {}) {
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.logger = options.logger;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.persistence = options.persistence;
    this.reconciler = options.reconciler ?? new StateReconciler();
    this.retentionPolicy = options.retentionPolicy;

    if (options.engine) {
      this.engine = options.engine;
      this.ownsEngine = options.ownsEngine ?? false;
    } else {
      const parser = options.parser ?? new TreeSitterParserAdapter();
      const analyzer = options.analyzer ?? new JsTsAnalyzer();
      this.engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer]
      });
      this.ownsEngine = true;
    }
  }

  /**
   * Whether the coordinator has been disposed.
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Retrieves and increments the generation counter for the given workspace.
   */
  public getNextGeneration(workspaceId: WorkspaceId): number {
    const current = this.generations.get(workspaceId) ?? 0;
    const next = current + 1;
    this.generations.set(workspaceId, next);
    return next;
  }

  /**
   * Retrieves the current generation counter for the given workspace.
   */
  public getCurrentGeneration(workspaceId: WorkspaceId): number {
    return this.generations.get(workspaceId) ?? 0;
  }

  /**
   * Sets the initial generation counter for a workspace (e.g. from a restored snapshot).
   */
  public setInitialGeneration(workspaceId: WorkspaceId, generation: number): void {
    this.generations.set(workspaceId, Math.max(0, generation));
  }

  /**
   * Read-only query for the last known complete snapshot of a workspace.
   */
  public getLastKnownSnapshot(workspaceId?: WorkspaceId): AnalysisSnapshot | undefined {
    const id = workspaceId ?? this.activeWorkspaceId;
    return id ? this.lastKnownSnapshots.get(id) : undefined;
  }

  /**
   * Read-only query for the last known lifecycle history of a workspace.
   */
  public getLastKnownHistory(
    workspaceId?: WorkspaceId
  ): readonly FindingLifecycleEvent[] | undefined {
    const id = workspaceId ?? this.activeWorkspaceId;
    return id ? this.lastKnownHistories.get(id) : undefined;
  }

  /**
   * Read-only query for the currently active workspace identifier.
   */
  public getActiveWorkspaceId(): WorkspaceId | undefined {
    return this.activeWorkspaceId;
  }

  /**
   * Restores persisted session state (latest complete snapshot and lifecycle history) for a workspace.
   * Seeds the generation counter from the restored snapshot so future scans continue monotonically.
   */
  public async restoreSession(targetWorkspaceId?: WorkspaceId): Promise<RestoredSessionState> {
    if (this.disposed) {
      throw new Error("Cannot restore session: AnalysisCoordinator is disposed.");
    }

    let workspaceId = targetWorkspaceId;
    if (!workspaceId) {
      const roots = this.workspaceManager.getWorkspaceRoots();
      if (roots.length === 0) {
        this.logger?.info("Session restoration skipped: no workspace folder open.");
        return {
          status: "no-workspace",
          seededGeneration: 0
        };
      }
      workspaceId = deriveWorkspaceId(roots);
    }

    this.activeWorkspaceId = workspaceId;

    if (!this.persistence) {
      this.logger?.info(
        `No persistence adapter configured for workspace "${workspaceId}". Clean baseline established.`
      );
      this.setInitialGeneration(workspaceId, 0);
      return {
        status: "storage-unavailable",
        workspaceId,
        seededGeneration: 0
      };
    }

    let isCorrupted = false;
    let warningMessage: string | undefined;
    let snapshot: AnalysisSnapshot | undefined;
    let history: readonly FindingLifecycleEvent[] = [];

    try {
      snapshot = await this.persistence.loadLatestSnapshot(workspaceId);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        this.logger?.info(
          `Workspace storage is unavailable for session restoration: ${err.message}`
        );
        this.setInitialGeneration(workspaceId, 0);
        return {
          status: "storage-unavailable",
          workspaceId,
          seededGeneration: 0
        };
      } else if (err instanceof CorruptedRecordError || err instanceof WorkspaceMismatchError) {
        isCorrupted = true;
        warningMessage = `Snapshot record invalid or corrupted and quarantined: ${err.message}`;
        this.logger?.warn(warningMessage, err);
        snapshot = undefined;
      } else {
        this.logger?.error(
          `Storage I/O failure while restoring snapshot for workspace ${workspaceId}`,
          err
        );
        throw err;
      }
    }

    try {
      history = await this.persistence.loadLifecycleHistory(workspaceId);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        history = [];
      } else if (err instanceof CorruptedRecordError || err instanceof WorkspaceMismatchError) {
        isCorrupted = true;
        const historyWarn = `Lifecycle history record invalid or corrupted and quarantined: ${err.message}`;
        warningMessage = warningMessage ? `${warningMessage}; ${historyWarn}` : historyWarn;
        this.logger?.warn(historyWarn, err);
        history = [];
      } else {
        this.logger?.error(
          `Storage I/O failure while restoring lifecycle history for workspace ${workspaceId}`,
          err
        );
        throw err;
      }
    }

    if (snapshot) {
      this.lastKnownSnapshots.set(workspaceId, snapshot);
      this.lastKnownHistories.set(workspaceId, history);
      this.setInitialGeneration(workspaceId, snapshot.generation);
      this.logger?.info(
        `Restored session for workspace ${workspaceId}: generation ${snapshot.generation}, ${snapshot.findings.length} findings, ${history.length} historical events.`
      );
      return {
        status: isCorrupted ? "corrupted-quarantined" : "restored",
        workspaceId,
        snapshot,
        history,
        seededGeneration: snapshot.generation,
        warningMessage
      };
    } else {
      this.lastKnownSnapshots.delete(workspaceId);
      this.lastKnownHistories.set(workspaceId, history);
      this.setInitialGeneration(workspaceId, 0);
      this.logger?.info(
        `No prior snapshot found for workspace ${workspaceId}. Established clean baseline with 0 findings and ${history.length} historical events.`
      );
      return {
        status: isCorrupted ? "corrupted-quarantined" : "empty-baseline",
        workspaceId,
        history,
        seededGeneration: 0,
        warningMessage
      };
    }
  }

  /**
   * Executes a full workspace scan and invokes the analysis engine and reconciler.
   */
  public async runWorkspaceScan(
    cancellationToken?: CancellationTokenLike
  ): Promise<CoordinatorAnalysisResult> {
    if (this.disposed) {
      return {
        status: "failed",
        errorMessage: "AnalysisCoordinator has already been disposed."
      };
    }

    if (cancellationToken?.isCancellationRequested) {
      return {
        status: "failed",
        errorMessage: "Workspace scan was cancelled before execution."
      };
    }

    // 1. Obtain workspace snapshot
    let snapshot: WorkspaceSnapshotResult;
    try {
      snapshot = await this.workspaceManager.createWorkspaceSnapshot(cancellationToken);
    } catch (err) {
      const msg = `Workspace snapshot acquisition threw an error: ${err instanceof Error ? err.message : String(err)}`;
      this.logger?.error(msg, err);
      return {
        status: "failed",
        errorMessage: msg
      };
    }

    // 2. Handle distinct snapshot statuses
    switch (snapshot.status) {
      case "no-workspace": {
        this.logger?.info("No workspace folder is currently open in VS Code.");
        return {
          status: "no-workspace",
          errorMessage: "No workspace folder is currently open in VS Code.",
          totalDiscovered: 0,
          totalAcquired: 0
        };
      }

      case "failed": {
        const failureReason =
          snapshot.failures.length > 0
            ? snapshot.failures.map((f) => `${f.uri}: ${f.error}`).join("; ")
            : "Workspace source file discovery failed.";
        this.logger?.error(`Workspace scan failed during discovery: ${failureReason}`);
        return {
          status: "failed",
          failures: snapshot.failures,
          errorMessage: failureReason,
          totalDiscovered: snapshot.totalDiscovered,
          totalAcquired: snapshot.totalAcquired
        };
      }

      case "empty": {
        // Legitimate empty workspace: workspace folder exists but contains 0 supported source files.
        const workspaceId = deriveWorkspaceId(snapshot.workspaceRootUris);
        this.activeWorkspaceId = workspaceId;
        const generation = this.getNextGeneration(workspaceId);

        const request: AnalysisRequest = {
          workspaceId,
          workspaceRootUris: snapshot.workspaceRootUris,
          generation,
          documents: [],
          config: this.config,
          mode: "workspace"
        };

        try {
          const result = await this.engine.analyze(request);
          return await this.processAnalysisResult(result, snapshot);
        } catch (err) {
          const msg = `Analysis engine failed on empty workspace: ${err instanceof Error ? err.message : String(err)}`;
          this.logger?.error(msg, err);
          return {
            status: "failed",
            workspaceId,
            generation,
            errorMessage: msg,
            totalDiscovered: 0,
            totalAcquired: 0
          };
        }
      }

      case "partial": {
        // If all files failed acquisition, no usable documents exist
        if (snapshot.documents.length === 0) {
          const failureReason =
            snapshot.failures.length > 0
              ? snapshot.failures.map((f) => `${f.uri}: ${f.error}`).join("; ")
              : "All discovered workspace files failed acquisition.";
          this.logger?.error(`Partial acquisition produced 0 usable documents: ${failureReason}`);
          return {
            status: "failed",
            failures: snapshot.failures,
            errorMessage: failureReason,
            totalDiscovered: snapshot.totalDiscovered,
            totalAcquired: 0
          };
        }

        const workspaceId = deriveWorkspaceId(snapshot.workspaceRootUris);
        this.activeWorkspaceId = workspaceId;
        const generation = this.getNextGeneration(workspaceId);

        const request: AnalysisRequest = {
          workspaceId,
          workspaceRootUris: snapshot.workspaceRootUris,
          generation,
          documents: snapshot.documents,
          config: this.config,
          mode: "workspace"
        };

        try {
          const rawResult = await this.engine.analyze(request);
          const adjustedResult = this.applyPartialScopeGating(rawResult, snapshot);
          return await this.processAnalysisResult(adjustedResult, snapshot);
        } catch (err) {
          const msg = `Analysis engine failed during partial workspace scan: ${err instanceof Error ? err.message : String(err)}`;
          this.logger?.error(msg, err);
          return {
            status: "failed",
            workspaceId,
            generation,
            errorMessage: msg,
            totalDiscovered: snapshot.totalDiscovered,
            totalAcquired: snapshot.totalAcquired
          };
        }
      }

      case "success": {
        const workspaceId = deriveWorkspaceId(snapshot.workspaceRootUris);
        this.activeWorkspaceId = workspaceId;
        const generation = this.getNextGeneration(workspaceId);

        const request: AnalysisRequest = {
          workspaceId,
          workspaceRootUris: snapshot.workspaceRootUris,
          generation,
          documents: snapshot.documents,
          config: this.config,
          mode: "workspace"
        };

        try {
          const result = await this.engine.analyze(request);
          return await this.processAnalysisResult(result, snapshot);
        } catch (err) {
          const msg = `Analysis engine failed during workspace scan: ${err instanceof Error ? err.message : String(err)}`;
          this.logger?.error(msg, err);
          return {
            status: "failed",
            workspaceId,
            generation,
            errorMessage: msg,
            totalDiscovered: snapshot.totalDiscovered,
            totalAcquired: snapshot.totalAcquired
          };
        }
      }

      default: {
        return {
          status: "failed",
          errorMessage: `Unknown workspace snapshot status: ${String((snapshot as { status: unknown }).status)}`
        };
      }
    }
  }

  /**
   * Reconciles fresh analysis results against the prior complete snapshot,
   * updates persistent storage when coverage is sufficient, and maintains in-memory state.
   */
  private async processAnalysisResult(
    result: AnalysisResult,
    snapshotResult: WorkspaceSnapshotResult
  ): Promise<CoordinatorAnalysisResult> {
    const workspaceId = result.workspaceId;
    const generation = result.generation;

    // Load persisted baseline if not already in memory
    if (!this.lastKnownSnapshots.has(workspaceId) && this.persistence) {
      try {
        const snap = await this.persistence.loadLatestSnapshot(workspaceId);
        if (snap) {
          this.lastKnownSnapshots.set(workspaceId, snap);
        }
      } catch (err) {
        if (!(err instanceof StorageUnavailableError) && !(err instanceof CorruptedRecordError)) {
          this.logger?.warn(
            `Could not load prior snapshot during scan: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    if (!this.lastKnownHistories.has(workspaceId) && this.persistence) {
      try {
        const hist = await this.persistence.loadLifecycleHistory(workspaceId);
        if (hist) {
          this.lastKnownHistories.set(workspaceId, hist);
        }
      } catch (err) {
        if (!(err instanceof StorageUnavailableError) && !(err instanceof CorruptedRecordError)) {
          this.logger?.warn(
            `Could not load prior lifecycle history during scan: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    const previousSnapshot = this.lastKnownSnapshots.get(workspaceId);
    const historicalEvents = this.lastKnownHistories.get(workspaceId) ?? [];

    // Perform state reconciliation
    const reconciliation = this.reconciler.reconcile(result, previousSnapshot, {
      historicalEvents
    });

    let persistenceStatus: PersistenceOutcomeStatus;
    let persistenceError: string | undefined;

    if (reconciliation.coverageSufficient && reconciliation.currentSnapshot) {
      if (this.persistence) {
        try {
          // 1. Atomically save candidate complete snapshot
          await this.persistence.saveSnapshot(workspaceId, reconciliation.currentSnapshot);

          // 2. Append newly emitted lifecycle events (if any)
          if (reconciliation.eventsEmitted.length > 0) {
            await this.persistence.appendLifecycleEvents(workspaceId, reconciliation.eventsEmitted);
          }

          // 3. Prune historical lifecycle events if policy configured
          if (this.retentionPolicy) {
            try {
              await this.persistence.pruneLifecycleHistory(workspaceId, this.retentionPolicy);
            } catch (pruneErr) {
              this.logger?.warn(
                "Failed to prune lifecycle history according to retention policy",
                pruneErr
              );
            }
          }

          persistenceStatus = "saved";

          // On persistence success, update coordinator in-memory state
          this.lastKnownSnapshots.set(workspaceId, reconciliation.currentSnapshot);
          this.lastKnownHistories.set(workspaceId, [
            ...historicalEvents,
            ...reconciliation.eventsEmitted
          ]);
        } catch (storageErr) {
          persistenceStatus = "failed";
          persistenceError = storageErr instanceof Error ? storageErr.message : String(storageErr);
          this.logger?.error(
            `Failed to persist reconciled state for workspace ${workspaceId}: ${persistenceError}`,
            storageErr
          );
        }
      } else {
        persistenceStatus = "skipped-storage-unavailable";
        // Update in-memory state for runtime operations when persistence is unconfigured
        this.lastKnownSnapshots.set(workspaceId, reconciliation.currentSnapshot);
        this.lastKnownHistories.set(workspaceId, [
          ...historicalEvents,
          ...reconciliation.eventsEmitted
        ]);
      }
    } else {
      // Incomplete or insufficient coverage: preserve previous snapshot intact!
      // Zero false resolution events emitted, no snapshot overwrite, no history appended.
      persistenceStatus = "skipped-incomplete";
    }

    const coordinatorStatus: CoordinatorOutcomeStatus = result.complete ? "success" : "incomplete";

    return {
      status: coordinatorStatus,
      workspaceId,
      generation,
      result,
      reconciliation,
      persistenceStatus,
      persistenceError,
      failures: snapshotResult.failures,
      totalDiscovered: snapshotResult.totalDiscovered,
      totalAcquired: snapshotResult.totalAcquired
    };
  }

  /**
   * Adjusts analysis results for partial acquisitions:
   * 1. Marks completeness as false.
   * 2. Attaches INCOMPLETE_SCOPE warnings for unacquired files.
   * 3. Suppresses unsafe absence claims (UND100 missing provider, UND110 orphaned provider)
   *    and uniqueness-dependent route conclusions (UND130).
   * 4. Updates statistics consistently.
   */
  private applyPartialScopeGating(
    result: AnalysisResult,
    snapshot: WorkspaceSnapshotResult
  ): AnalysisResult {
    const scopeWarnings: AnalysisWarning[] = snapshot.failures.map((f) => ({
      code: "INCOMPLETE_SCOPE",
      message: `Incomplete workspace scope: could not read source document ${f.uri}: ${f.error}`,
      source: {
        uri: f.uri,
        range: { start: 0, end: 0 },
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
      },
      affectsCompleteness: true
    }));

    const combinedWarnings = [...result.warnings, ...scopeWarnings];

    // Suppress absence claims and uniqueness-dependent suspected mismatches
    const safeFindings = result.findings.filter(
      (f) => f.ruleId !== "UND100" && f.ruleId !== "UND110" && f.ruleId !== "UND130"
    );

    const warningUris = new Set<DocumentUri>();
    for (const w of combinedWarnings) {
      if (w.source?.uri) {
        warningUris.add(w.source.uri);
      }
    }

    const updatedStatistics: AnalysisStatistics = {
      ...result.statistics,
      filesConsidered: snapshot.totalDiscovered,
      filesWithWarnings: warningUris.size,
      activeFindings: safeFindings.length
    };

    return {
      ...result,
      complete: false,
      findings: safeFindings,
      warnings: combinedWarnings,
      statistics: updatedStatistics
    };
  }

  /**
   * Safely disposes the coordinator and releases owned engine, parser, and persistence resources.
   */
  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    try {
      if (this.ownsEngine && this.engine) {
        await this.engine.dispose();
      }
    } catch (err) {
      this.logger?.warn("Error disposing analysis engine resources", err);
    }

    try {
      if (this.persistence) {
        await this.persistence.clearCache();
      }
    } catch (err) {
      this.logger?.warn("Error clearing persistence cache during coordinator disposal", err);
    }

    this.lastKnownSnapshots.clear();
    this.lastKnownHistories.clear();
  }
}
