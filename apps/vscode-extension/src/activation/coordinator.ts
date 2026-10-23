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
import type { DriftDiagnosticProvider } from "../diagnostics";
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
import { AnalysisScheduler } from "./scheduler";

/**
 * Outcome status classification returned by the analysis coordinator.
 */
export type CoordinatorOutcomeStatus =
  "success" | "incomplete" | "failed" | "no-workspace" | "cancelled" | "superseded";

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
  "saved" | "skipped-incomplete" | "skipped-storage-unavailable" | "skipped-stale" | "failed";

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
  onCancellationRequested?(listener: () => void): { dispose(): void };
}

/**
 * Standalone cancellation token source compatible with VS Code CancellationTokenSource.
 */
export class CancellationTokenSourceLike {
  private _isCancelled = false;
  private readonly _listeners = new Set<() => void>();

  get token(): CancellationTokenLike {
    return {
      isCancellationRequested: this._isCancelled,
      onCancellationRequested: (listener: () => void) => {
        if (this._isCancelled) {
          listener();
          return { dispose: () => {} };
        }
        this._listeners.add(listener);
        return {
          dispose: () => {
            this._listeners.delete(listener);
          }
        };
      }
    };
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const listener of Array.from(this._listeners)) {
      try {
        listener();
      } catch {
        // ignore listener failures during cancellation broadcast
      }
    }
    this._listeners.clear();
  }

  dispose(): void {
    this._listeners.clear();
  }
}

/**
 * Internal tracking context for an in-progress workspace scan.
 */
interface ActiveScanContext {
  readonly workspaceId: WorkspaceId;
  readonly generation: number;
  readonly scanCts: CancellationTokenSourceLike;
  readonly abortController: AbortController;
  isObsolete: boolean;
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

  /**
   * Optional debounce delay in milliseconds for coalescing live source changes.
   */
  debounceDelayMs?: number;

  /**
   * Optional diagnostic provider port for publishing accepted findings to VS Code diagnostics.
   */
  diagnosticProvider?: DriftDiagnosticProvider;
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

  /** In-flight or completed restoration promises per workspace to prevent concurrent races. */
  private readonly restorationPromises = new Map<WorkspaceId, Promise<RestoredSessionState>>();

  /** Active workspace identifier currently focused. */
  private activeWorkspaceId?: WorkspaceId;

  /** Currently in-progress scans per workspace. */
  private readonly activeScans = new Map<WorkspaceId, ActiveScanContext>();

  /** Latest accepted and persisted generation per workspace for stale-result rejection. */
  private readonly latestAcceptedGenerations = new Map<WorkspaceId, number>();

  /** Debounced analysis scheduler. */
  private readonly scheduler: AnalysisScheduler;

  /** Diagnostic provider for publishing accepted findings to VS Code diagnostics. */
  private diagnosticProvider?: DriftDiagnosticProvider;

  /** Listeners notified of accepted or finalized analysis outcomes. */
  private readonly analysisResultListeners = new Set<(result: CoordinatorAnalysisResult) => void>();

  private disposed = false;

  constructor(options: AnalysisCoordinatorOptions = {}) {
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.logger = options.logger;
    this.config = options.config ?? DEFAULT_CONFIG;
    this.persistence = options.persistence;
    this.reconciler = options.reconciler ?? new StateReconciler();
    this.retentionPolicy = options.retentionPolicy;
    this.diagnosticProvider = options.diagnosticProvider;

    this.scheduler = new AnalysisScheduler({
      coordinator: this,
      workspaceManager: this.workspaceManager,
      debounceDelayMs: options.debounceDelayMs,
      logger: this.logger
    });

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
   * Returns the debounced analysis scheduler component.
   */
  public getScheduler(): AnalysisScheduler {
    return this.scheduler;
  }

  /**
   * Returns the attached diagnostic provider if configured.
   */
  public getDiagnosticProvider(): DriftDiagnosticProvider | undefined {
    return this.diagnosticProvider;
  }

  /**
   * Attaches or updates the diagnostic provider.
   */
  public setDiagnosticProvider(provider?: DriftDiagnosticProvider): void {
    this.diagnosticProvider = provider;
  }

  /**
   * Registers a listener notified on any accepted or finalized scan result.
   */
  public onAnalysisCompleted(listener: (result: CoordinatorAnalysisResult) => void): {
    dispose(): void;
  } {
    this.analysisResultListeners.add(listener);
    return {
      dispose: () => {
        this.analysisResultListeners.delete(listener);
      }
    };
  }

  /**
   * Emits an analysis outcome to the diagnostic provider and registered listeners.
   */
  private emitAnalysisOutcome(outcome: CoordinatorAnalysisResult): CoordinatorAnalysisResult {
    if (this.disposed) {
      return outcome;
    }

    if (this.diagnosticProvider) {
      try {
        this.diagnosticProvider.updateDiagnostics(outcome);
      } catch (err) {
        this.logger?.error("Diagnostic provider failed to update diagnostics", err);
      }
    }

    for (const listener of Array.from(this.analysisResultListeners)) {
      try {
        listener(outcome);
      } catch (err) {
        this.logger?.error("Analysis result listener failed", err);
      }
    }

    return outcome;
  }

  /**
   * Schedules a debounced workspace scan.
   */
  public scheduleScan(options?: {
    delayMs?: number;
    targetWorkspaceId?: WorkspaceId;
  }): Promise<CoordinatorAnalysisResult> {
    return this.scheduler.scheduleScan(options);
  }

  /**
   * Explicitly marks any active scan for a workspace as superseded by a newer scan.
   */
  public supersedeActiveScan(workspaceId?: WorkspaceId): boolean {
    const id = workspaceId ?? this.activeWorkspaceId;
    if (!id) return false;
    const active = this.activeScans.get(id);
    if (active && !active.isObsolete) {
      active.isObsolete = true;
      active.scanCts.cancel();
      active.abortController.abort();
      this.logger?.info(
        `Superseded active scan for workspace ${id} (generation ${active.generation}).`
      );
      return true;
    }
    return false;
  }

  /**
   * Explicitly signals cancellation on the currently active scan for a workspace.
   */
  public cancelActiveScan(workspaceId?: WorkspaceId): boolean {
    const id = workspaceId ?? this.activeWorkspaceId;
    if (!id) return false;
    const active = this.activeScans.get(id);
    if (active) {
      active.scanCts.cancel();
      active.abortController.abort();
      this.logger?.info(
        `Cancelled active scan for workspace ${id} (generation ${active.generation}).`
      );
      return true;
    }
    return false;
  }

  /**
   * Returns the active scan info for a workspace if one is currently in-flight.
   */
  public getActiveScan(
    workspaceId?: WorkspaceId
  ): { generation: number; isObsolete: boolean } | undefined {
    const id = workspaceId ?? this.activeWorkspaceId;
    if (!id) return undefined;
    const active = this.activeScans.get(id);
    return active ? { generation: active.generation, isObsolete: active.isObsolete } : undefined;
  }

  /**
   * Returns the latest accepted generation for a workspace.
   */
  public getLatestAcceptedGeneration(workspaceId?: WorkspaceId): number | undefined {
    const id = workspaceId ?? this.activeWorkspaceId;
    return id ? this.latestAcceptedGenerations.get(id) : undefined;
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
   * Resets persisted lifecycle event history for a workspace without altering the latest complete snapshot or source code.
   */
  public async resetHistory(workspaceId?: WorkspaceId): Promise<void> {
    if (this.disposed) return;
    const wsId = workspaceId ?? this.activeWorkspaceId;
    if (!wsId) return;

    if (this.persistence) {
      await this.persistence.resetHistory(wsId);
    }
    this.lastKnownHistories.set(wsId, []);
    this.logger?.info(`Reset lifecycle history for workspace ${wsId}.`);
  }

  /**
   * Clears in-memory cached copies of persisted workspace state without deleting saved snapshots or lifecycle history.
   */
  public async clearCache(): Promise<void> {
    if (this.disposed) return;
    if (this.persistence) {
      await this.persistence.clearCache();
    }
    this.logger?.info("Cleared in-memory workspace state cache.");
  }

  /**
   * Ensures that persisted session state (snapshot and history) has been restored
   * for the specified workspace. Reuses any in-flight or completed restoration promise.
   */
  public ensureRestored(workspaceId: WorkspaceId): Promise<RestoredSessionState> {
    const existing = this.restorationPromises.get(workspaceId);
    if (existing) {
      return existing;
    }
    return this.restoreSession(workspaceId);
  }

  /**
   * Restores persisted session state (latest complete snapshot and lifecycle history) for a workspace.
   * Seeds the generation counter from the restored snapshot so future scans continue monotonically.
   */
  public restoreSession(targetWorkspaceId?: WorkspaceId): Promise<RestoredSessionState> {
    if (this.disposed) {
      return Promise.reject(new Error("Cannot restore session: AnalysisCoordinator is disposed."));
    }

    let workspaceId = targetWorkspaceId;
    if (!workspaceId) {
      const roots = this.workspaceManager.getWorkspaceRoots();
      if (roots.length === 0) {
        this.logger?.info("Session restoration skipped: no workspace folder open.");
        return Promise.resolve({
          status: "no-workspace",
          seededGeneration: 0
        });
      }
      workspaceId = deriveWorkspaceId(roots);
    }

    this.activeWorkspaceId = workspaceId;

    // Deduplicate concurrent restoration calls for the same workspace
    const existingPromise = this.restorationPromises.get(workspaceId);
    if (existingPromise) {
      return existingPromise;
    }

    const restorationPromise = (async () => {
      try {
        return await this.executeSessionRestoration(workspaceId);
      } catch (err) {
        // Delete failed promise so retry is possible
        this.restorationPromises.delete(workspaceId);
        throw err;
      }
    })();

    this.restorationPromises.set(workspaceId, restorationPromise);
    return restorationPromise;
  }

  /**
   * Internal session restoration execution loading snapshot and history.
   */
  private async executeSessionRestoration(workspaceId: WorkspaceId): Promise<RestoredSessionState> {
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

      if (this.diagnosticProvider) {
        try {
          this.diagnosticProvider.publishSnapshot(workspaceId, snapshot);
        } catch (err) {
          this.logger?.warn("Failed to publish restored snapshot diagnostics", err);
        }
      }

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

      if (this.diagnosticProvider) {
        try {
          this.diagnosticProvider.clearForWorkspace(workspaceId);
        } catch (err) {
          this.logger?.warn("Failed to clear workspace diagnostics on clean baseline", err);
        }
      }

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
    const outcome = await this.executeWorkspaceScan(cancellationToken);
    return this.emitAnalysisOutcome(outcome);
  }

  /**
   * Internal execution of full workspace scan and reconciliation.
   */
  private async executeWorkspaceScan(
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
        status: "cancelled",
        errorMessage: "Workspace scan was cancelled before execution."
      };
    }

    // 1. Resolve workspace roots and supersede any existing in-flight scan for this workspace early
    const initialRoots = this.workspaceManager.getWorkspaceRoots();
    const candidateWorkspaceId =
      initialRoots.length > 0 ? deriveWorkspaceId(initialRoots) : undefined;
    if (candidateWorkspaceId) {
      this.supersedeActiveScan(candidateWorkspaceId);
    }

    // 2. Set up explicitly owned cancellation resources for this scan
    const scanCts = new CancellationTokenSourceLike();
    const abortController = new AbortController();

    // Link cancellation: scanCts cancellation aborts abortController
    scanCts.token.onCancellationRequested?.(() => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    });

    // Link external cancellation token if provided
    let cleanupExternalToken: (() => void) | undefined;
    if (cancellationToken) {
      if (cancellationToken.isCancellationRequested) {
        scanCts.cancel();
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      } else if (cancellationToken.onCancellationRequested) {
        const sub = cancellationToken.onCancellationRequested(() => {
          scanCts.cancel();
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
        });
        cleanupExternalToken = () => sub.dispose();
      }
    }

    let scanContext: ActiveScanContext | undefined;
    let workspaceId: WorkspaceId | undefined;

    try {
      // 3. Obtain workspace snapshot with cancellation propagation
      let snapshot: WorkspaceSnapshotResult;
      try {
        snapshot = await this.workspaceManager.createWorkspaceSnapshot(scanCts.token);
      } catch (err) {
        const msg = `Workspace snapshot acquisition threw an error: ${err instanceof Error ? err.message : String(err)}`;
        this.logger?.error(msg, err);
        return {
          status: "failed",
          errorMessage: msg
        };
      }

      // Check if cancelled during snapshot discovery
      if (scanCts.token.isCancellationRequested || abortController.signal.aborted) {
        return {
          status: "cancelled",
          errorMessage: "Workspace scan was cancelled during snapshot acquisition."
        };
      }

      // 4. Handle distinct snapshot statuses
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

        case "empty":
        case "partial":
        case "success": {
          // If all files failed acquisition, no usable documents exist
          if (snapshot.status === "partial" && snapshot.documents.length === 0) {
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

          workspaceId = deriveWorkspaceId(snapshot.workspaceRootUris);
          this.activeWorkspaceId = workspaceId;

          // If workspaceId was not known beforehand, check and supersede any active scan now
          // If workspaceId was not known beforehand, check and supersede any active scan now
          if (!candidateWorkspaceId || candidateWorkspaceId !== workspaceId) {
            this.supersedeActiveScan(workspaceId);
          }

          // Ensure session restoration has completed for this workspace before proceeding
          try {
            await this.ensureRestored(workspaceId);
          } catch (err) {
            const msg = `Workspace scan aborted: storage I/O failure during state restoration: ${err instanceof Error ? err.message : String(err)}`;
            this.logger?.error(msg, err);
            return {
              status: "failed",
              workspaceId,
              errorMessage: msg,
              totalDiscovered: snapshot.totalDiscovered,
              totalAcquired: snapshot.totalAcquired
            };
          }

          // Check if cancelled or superseded while waiting for restoration
          if (scanCts.token.isCancellationRequested || abortController.signal.aborted) {
            return {
              status: "cancelled",
              workspaceId,
              errorMessage: "Workspace scan was cancelled during state restoration."
            };
          }

          // Monotonically allocate generation after restoration has succeeded
          const generation = this.getNextGeneration(workspaceId);

          scanContext = {
            workspaceId,
            generation,
            scanCts,
            abortController,
            isObsolete: false
          };
          this.activeScans.set(workspaceId, scanContext);

          const request: AnalysisRequest = {
            workspaceId,
            workspaceRootUris: snapshot.workspaceRootUris,
            generation,
            documents: snapshot.documents,
            config: this.config,
            mode: "workspace"
          };

          try {
            const rawResult = await this.engine.analyze(request, abortController.signal);

            // ==============================================================
            // CRITICAL INVARIANT: Race-Safe Acceptance Boundary
            // Must verify validity BEFORE reconciliation, lifecycle events,
            // snapshot writes, or in-memory state updates!
            // ==============================================================

            // 1. Check if this scan was marked obsolete (superseded by a newer scan)
            if (
              scanContext.isObsolete ||
              (this.activeScans.has(workspaceId) &&
                this.activeScans.get(workspaceId) !== scanContext)
            ) {
              this.logger?.info(
                `Discarding obsolete analysis result for workspace ${workspaceId} (generation ${generation} was superseded).`
              );
              return {
                status: "superseded",
                workspaceId,
                generation,
                persistenceStatus: "skipped-stale",
                errorMessage: `Analysis result for generation ${generation} was superseded by a newer scan.`
              };
            }

            // 2. Check if cancellation was requested
            if (scanCts.token.isCancellationRequested || abortController.signal.aborted) {
              this.logger?.info(
                `Discarding cancelled analysis result for workspace ${workspaceId} (generation ${generation}).`
              );
              return {
                status: "cancelled",
                workspaceId,
                generation,
                persistenceStatus: "skipped-stale",
                errorMessage: `Analysis result for generation ${generation} was cancelled.`
              };
            }

            // 3. Verify workspace identity
            if (rawResult.workspaceId !== workspaceId) {
              throw new Error(
                `Analysis result workspaceId '${rawResult.workspaceId}' does not match expected '${workspaceId}'.`
              );
            }

            // 4. Verify generation monotonicity against latest accepted generation
            const latestAccepted = this.latestAcceptedGenerations.get(workspaceId) ?? 0;
            if (generation <= latestAccepted) {
              this.logger?.info(
                `Discarding stale analysis result: generation ${generation} is <= latest accepted ${latestAccepted}.`
              );
              return {
                status: "superseded",
                workspaceId,
                generation,
                persistenceStatus: "skipped-stale",
                errorMessage: `Analysis result generation ${generation} is stale (latest accepted is ${latestAccepted}).`
              };
            }

            // Mark this generation as accepted before proceeding to reconciliation
            this.latestAcceptedGenerations.set(workspaceId, generation);

            const resultToProcess =
              snapshot.status === "partial"
                ? this.applyPartialScopeGating(rawResult, snapshot)
                : rawResult;

            return await this.processAnalysisResult(resultToProcess, snapshot);
          } catch (err) {
            // Check if error was due to superseding or cancellation
            if (
              scanContext.isObsolete ||
              (this.activeScans.has(workspaceId) &&
                this.activeScans.get(workspaceId) !== scanContext)
            ) {
              return {
                status: "superseded",
                workspaceId,
                generation,
                persistenceStatus: "skipped-stale",
                errorMessage: `Analysis for generation ${generation} was superseded by a newer scan.`
              };
            }
            if (scanCts.token.isCancellationRequested || abortController.signal.aborted) {
              return {
                status: "cancelled",
                workspaceId,
                generation,
                persistenceStatus: "skipped-stale",
                errorMessage: `Analysis for generation ${generation} was cancelled.`
              };
            }

            const scanKind =
              snapshot.status === "empty"
                ? "empty workspace"
                : snapshot.status === "partial"
                  ? "partial workspace scan"
                  : "workspace scan";
            const msg = `Analysis engine failed during ${scanKind}: ${err instanceof Error ? err.message : String(err)}`;
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
    } finally {
      cleanupExternalToken?.();
      if (workspaceId && scanContext && this.activeScans.get(workspaceId) === scanContext) {
        this.activeScans.delete(workspaceId);
      }
      scanCts.dispose();
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
        let snapshotSaved = false;
        let eventsAppended = false;
        try {
          // 1. Atomically save candidate complete snapshot
          await this.persistence.saveSnapshot(workspaceId, reconciliation.currentSnapshot);
          snapshotSaved = true;

          // 2. Append newly emitted lifecycle events (if any)
          if (reconciliation.eventsEmitted.length > 0) {
            await this.persistence.appendLifecycleEvents(workspaceId, reconciliation.eventsEmitted);
          }
          eventsAppended = true;

          // 3. Prune historical lifecycle events if policy configured
          if (this.retentionPolicy) {
            await this.persistence.pruneLifecycleHistory(workspaceId, this.retentionPolicy);
          }

          persistenceStatus = "saved";

          // On complete persistence success, update coordinator in-memory state
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

          // Partial-write rollback:
          // If snapshot was saved but subsequent appendLifecycleEvents failed,
          // do NOT leave durable snapshot silently advanced without its events!
          // Rollback snapshot to previousSnapshot (or delete if no prior snapshot).
          if (snapshotSaved && !eventsAppended) {
            try {
              if (previousSnapshot) {
                await this.persistence.saveSnapshot(workspaceId, previousSnapshot);
                this.logger?.info(
                  `Rolled back snapshot for workspace ${workspaceId} to generation ${previousSnapshot.generation} after lifecycle event write failure.`
                );
              } else if (this.persistence.deleteSnapshot) {
                await this.persistence.deleteSnapshot(workspaceId);
                this.logger?.info(
                  `Deleted candidate snapshot for workspace ${workspaceId} after initial lifecycle event write failure.`
                );
              }
            } catch (rollbackErr) {
              this.logger?.error(
                `Failed to rollback snapshot for workspace ${workspaceId}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
                rollbackErr
              );
            }
          } else if (snapshotSaved && eventsAppended) {
            // Retention pruning failed after both snapshot and events were safely persisted.
            // Preserve the valid complete snapshot in memory while truthfully reporting failure.
            this.lastKnownSnapshots.set(workspaceId, reconciliation.currentSnapshot);
            this.lastKnownHistories.set(workspaceId, [
              ...historicalEvents,
              ...reconciliation.eventsEmitted
            ]);
          }
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
      this.scheduler.dispose();
    } catch (err) {
      this.logger?.warn("Error disposing scheduler", err);
    }

    for (const active of this.activeScans.values()) {
      active.scanCts.cancel();
      active.abortController.abort();
      active.scanCts.dispose();
    }
    this.activeScans.clear();
    this.latestAcceptedGenerations.clear();

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

    this.restorationPromises.clear();
    this.lastKnownSnapshots.clear();
    this.lastKnownHistories.clear();
    this.analysisResultListeners.clear();
    this.diagnosticProvider = undefined;
  }
}
