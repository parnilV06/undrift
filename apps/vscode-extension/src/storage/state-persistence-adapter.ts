// Workspace state persistence adapter implementing StatePersistencePort strictly adhering to
// LLD.md Sections 4.14–4.16, 5.6, 14.10, 16.1–16.5, 17, 18, and 20 (POC-F).

import * as crypto from "crypto";
import * as path from "path";
import type {
  AnalysisSnapshot,
  FindingLifecycleEvent,
  FindingLifecycleHistory,
  HistoryFilter,
  RetentionPolicy,
  StatePersistencePort,
  WorkspaceId
} from "@undrift/core";
import { LIFECYCLE_HISTORY_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION } from "@undrift/core";
import type { UriLike } from "../workspace/source-snapshot-provider";
import {
  CorruptedRecordError,
  IncompleteSnapshotError,
  StorageIOError,
  StorageUnavailableError,
  WorkspaceMismatchError
} from "./errors";
import {
  createVsCodeStorageFileSystem,
  joinStorageUri,
  type StorageFileSystem
} from "./storage-filesystem";
import {
  isFileNotFound,
  validateLifecycleEvent,
  validateLifecycleHistory,
  validateSnapshot
} from "./storage-validator";

/**
 * Structured logger seam for persistent storage warnings and errors.
 */
export interface StorageLogger {
  warn(message: string, error?: unknown): void;
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

/**
 * Default fallback logger directing warnings to console.warn.
 */
const defaultLogger: StorageLogger = {
  warn: (msg, err) => {
    if (err !== undefined) {
      console.warn(`[UNDRIFT-Storage] ${msg}`, err);
    } else {
      console.warn(`[UNDRIFT-Storage] ${msg}`);
    }
  },
  info: (msg) => {
    console.info(`[UNDRIFT-Storage] ${msg}`);
  },
  error: (msg, err) => {
    if (err !== undefined) {
      console.error(`[UNDRIFT-Storage] ${msg}`, err);
    } else {
      console.error(`[UNDRIFT-Storage] ${msg}`);
    }
  }
};

/**
 * Options configuring the WorkspaceStatePersistenceAdapter.
 */
export interface StatePersistenceAdapterOptions {
  /**
   * Root directory managed by VS Code for workspace-scoped extension storage
   * (typically ExtensionContext.storageUri).
   */
  storageUri?: UriLike | (() => UriLike | undefined);

  /**
   * Filesystem abstraction (defaults to vscode.workspace.fs).
   */
  fileSystem?: StorageFileSystem;

  /**
   * Diagnostic logger seam.
   */
  logger?: StorageLogger;

  /**
   * Clock function returning epoch milliseconds (defaults to Date.now).
   */
  now?: () => number;
}

/**
 * Derives a deterministic, filesystem-safe directory key for a workspace identity.
 */
export function getWorkspaceStorageKey(workspaceId: WorkspaceId): string {
  const hash = crypto.createHash("sha256").update(workspaceId, "utf8").digest("hex").slice(0, 16);
  const sanitized = workspaceId
    .replace(/^[a-zA-Z0-9+-.]+:\/\//, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(-24);
  return sanitized ? `${sanitized}_${hash}` : `ws_${hash}`;
}

interface WorkspaceCacheEntry {
  snapshot?: AnalysisSnapshot;
  history?: FindingLifecycleEvent[];
}

/**
 * Concrete, workspace-scoped implementation of StatePersistencePort using VS Code-managed
 * storage directory (storageUri).
 */
export class WorkspaceStatePersistenceAdapter implements StatePersistencePort {
  readonly id = "vscode-workspace-state-persistence";

  private readonly options: StatePersistenceAdapterOptions;
  private readonly fs: StorageFileSystem;
  private readonly logger: StorageLogger;
  private readonly now: () => number;

  /** Disposable in-memory cache for fast repeated reads. */
  private readonly memoryCache = new Map<WorkspaceId, WorkspaceCacheEntry>();

  /** Promise chain mutex per workspace to serialize concurrent write operations. */
  private readonly writeLocks = new Map<WorkspaceId, Promise<unknown>>();

  constructor(options: StatePersistenceAdapterOptions = {}) {
    this.options = options;
    this.fs = options.fileSystem ?? createVsCodeStorageFileSystem();
    this.logger = options.logger ?? defaultLogger;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Resolves the storage root URI, throwing StorageUnavailableError if unavailable.
   */
  private resolveStorageUri(): UriLike {
    const uri =
      typeof this.options.storageUri === "function"
        ? this.options.storageUri()
        : this.options.storageUri;

    if (!uri) {
      throw new StorageUnavailableError();
    }
    return uri;
  }

  /**
   * Resolves the directory URI dedicated to the given workspace.
   */
  private getWorkspaceDir(storageRoot: UriLike, workspaceId: WorkspaceId): UriLike {
    const key = getWorkspaceStorageKey(workspaceId);
    return joinStorageUri(storageRoot, "workspaces", key);
  }

  /**
   * Resolves the snapshot.json URI for a workspace.
   */
  private getSnapshotUri(storageRoot: UriLike, workspaceId: WorkspaceId): UriLike {
    const wsDir = this.getWorkspaceDir(storageRoot, workspaceId);
    return joinStorageUri(wsDir, "snapshot.json");
  }

  /**
   * Resolves the history.json URI for a workspace.
   */
  private getHistoryUri(storageRoot: UriLike, workspaceId: WorkspaceId): UriLike {
    const wsDir = this.getWorkspaceDir(storageRoot, workspaceId);
    return joinStorageUri(wsDir, "history.json");
  }

  /**
   * Resolves parent URI for a file.
   */
  private getParentUri(fileUri: UriLike): UriLike {
    const str = fileUri.toString();
    const lastSlash = str.lastIndexOf("/");
    const parentStr = lastSlash > 0 ? str.slice(0, lastSlash) : str;
    const fsPath = fileUri.fsPath ? path.dirname(fileUri.fsPath) : undefined;
    const pathProp = fileUri.path ? path.posix.dirname(fileUri.path) : undefined;

    return {
      toString: () => parentStr,
      scheme: fileUri.scheme,
      path: pathProp,
      fsPath
    };
  }

  /**
   * Serializes async execution per workspace to coordinate concurrent writes.
   */
  private async withLock<T>(workspaceId: WorkspaceId, action: () => Promise<T>): Promise<T> {
    const currentLock = this.writeLocks.get(workspaceId) ?? Promise.resolve();
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.writeLocks.set(workspaceId, nextLock);

    try {
      await currentLock;
      return await action();
    } finally {
      releaseLock();
      if (this.writeLocks.get(workspaceId) === nextLock) {
        this.writeLocks.delete(workspaceId);
      }
    }
  }

  /**
   * Atomically writes data to a target URI by writing to a temporary file first
   * and renaming it over the destination.
   */
  private async writeJsonAtomically(targetUri: UriLike, data: unknown): Promise<void> {
    const jsonStr = JSON.stringify(data, null, 2);
    const content = Buffer.from(jsonStr, "utf8");
    const parentUri = this.getParentUri(targetUri);
    const randSuffix = Math.random().toString(36).slice(2, 8);
    const tempName = `tmp_${Date.now()}_${randSuffix}.json`;
    const tempUri = joinStorageUri(parentUri, tempName);

    try {
      await this.fs.createDirectory(parentUri);
      await this.fs.writeFile(tempUri, new Uint8Array(content));
      await this.fs.rename(tempUri, targetUri, { overwrite: true });
    } catch (err) {
      try {
        await this.fs.delete(tempUri, { recursive: false });
      } catch {
        // Ignore secondary cleanup error
      }
      throw new StorageIOError(
        `Failed to persist file ${targetUri.toString()}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  /**
   * Safely renames an invalid or corrupted file into the quarantine directory.
   */
  private async quarantineCorruptedFile(fileUri: UriLike, reason: string): Promise<void> {
    const timestamp = this.now();
    const parentUri = this.getParentUri(fileUri);
    const quarantineDir = joinStorageUri(parentUri, "quarantine");
    const baseName = fileUri.toString().split("/").pop() ?? "record.json";
    const quarantineFileUri = joinStorageUri(
      quarantineDir,
      `${baseName}.corrupt.${timestamp}.json`
    );

    try {
      await this.fs.createDirectory(quarantineDir);
      await this.fs.rename(fileUri, quarantineFileUri, { overwrite: true });
      this.logger.warn(
        `Quarantined corrupted file ${fileUri.toString()} to ${quarantineFileUri.toString()}: ${reason}`
      );
    } catch (qErr) {
      try {
        await this.fs.delete(fileUri, { recursive: false });
        this.logger.warn(
          `Could not rename corrupted file ${fileUri.toString()} to quarantine, removed it: ${reason}`,
          qErr
        );
      } catch (delErr) {
        this.logger.error(
          `Failed to quarantine or remove corrupted file ${fileUri.toString()}: ${reason}`,
          delErr
        );
        throw new StorageIOError(
          `Failed to quarantine corrupted file ${fileUri.toString()}: ${delErr instanceof Error ? delErr.message : String(delErr)}`,
          delErr
        );
      }
    }
  }

  /**
   * Reads raw unparsed events from storage or cache.
   */
  private async readRawLifecycleEvents(
    storageRoot: UriLike,
    workspaceId: WorkspaceId
  ): Promise<readonly FindingLifecycleEvent[]> {
    const cached = this.memoryCache.get(workspaceId)?.history;
    if (cached) {
      return cached;
    }

    const historyUri = this.getHistoryUri(storageRoot, workspaceId);
    let bytes: Uint8Array;
    try {
      bytes = await this.fs.readFile(historyUri);
    } catch (err) {
      if (isFileNotFound(err)) {
        return [];
      }
      throw new StorageIOError(
        `Failed reading lifecycle history for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    let raw: unknown;
    try {
      const text = Buffer.from(bytes).toString("utf8");
      raw = JSON.parse(text);
    } catch (parseErr) {
      const msg = `Malformed JSON in lifecycle history for workspace ${workspaceId}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
      this.logger.warn(msg);
      await this.quarantineCorruptedFile(historyUri, "Malformed JSON");
      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.history = undefined;
      }
      throw new CorruptedRecordError(msg, parseErr);
    }

    let validated: FindingLifecycleHistory;
    try {
      validated = validateLifecycleHistory(raw, workspaceId);
    } catch (valErr) {
      const msg = `Invalid lifecycle history record for workspace ${workspaceId}: ${valErr instanceof Error ? valErr.message : String(valErr)}`;
      this.logger.warn(msg);
      await this.quarantineCorruptedFile(
        historyUri,
        valErr instanceof Error ? valErr.message : "Validation error"
      );
      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.history = undefined;
      }
      throw valErr;
    }

    const entry = this.memoryCache.get(workspaceId) ?? {};
    entry.history = [...validated.events];
    this.memoryCache.set(workspaceId, entry);

    return validated.events;
  }

  /**
   * Loads the most recent verified complete analysis snapshot for a workspace, if one exists.
   */
  async loadLatestSnapshot(workspaceId: WorkspaceId): Promise<AnalysisSnapshot | undefined> {
    const storageRoot = this.resolveStorageUri();

    const cached = this.memoryCache.get(workspaceId)?.snapshot;
    if (cached) {
      return cached;
    }

    const snapshotUri = this.getSnapshotUri(storageRoot, workspaceId);
    let bytes: Uint8Array;
    try {
      bytes = await this.fs.readFile(snapshotUri);
    } catch (err) {
      if (isFileNotFound(err)) {
        return undefined;
      }
      throw new StorageIOError(
        `Failed reading snapshot for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    let raw: unknown;
    try {
      const text = Buffer.from(bytes).toString("utf8");
      raw = JSON.parse(text);
    } catch (parseErr) {
      const msg = `Malformed JSON in snapshot file for workspace ${workspaceId}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
      this.logger.warn(msg);
      await this.quarantineCorruptedFile(snapshotUri, "Malformed JSON");
      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.snapshot = undefined;
      }
      throw new CorruptedRecordError(msg, parseErr);
    }

    let validated: AnalysisSnapshot;
    try {
      validated = validateSnapshot(raw, workspaceId);
    } catch (valErr) {
      const msg = `Invalid snapshot record for workspace ${workspaceId}: ${valErr instanceof Error ? valErr.message : String(valErr)}`;
      this.logger.warn(msg);
      await this.quarantineCorruptedFile(
        snapshotUri,
        valErr instanceof Error ? valErr.message : "Validation error"
      );
      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.snapshot = undefined;
      }
      throw valErr;
    }

    const entry = this.memoryCache.get(workspaceId) ?? {};
    entry.snapshot = validated;
    this.memoryCache.set(workspaceId, entry);

    return validated;
  }

  /**
   * Atomically persists an updated complete analysis snapshot for a workspace.
   */
  async saveSnapshot(workspaceId: WorkspaceId, snapshot: AnalysisSnapshot): Promise<void> {
    const storageRoot = this.resolveStorageUri();

    if (snapshot.workspaceId !== workspaceId) {
      throw new WorkspaceMismatchError(
        `Snapshot workspaceId '${snapshot.workspaceId}' does not match target workspaceId '${workspaceId}'.`
      );
    }

    if (snapshot.coverage?.complete !== true) {
      throw new IncompleteSnapshotError(
        `Cannot save incomplete snapshot (coverage.complete is ${String(snapshot.coverage?.complete)}) as latest complete analysis snapshot.`
      );
    }

    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new CorruptedRecordError(
        `Unsupported snapshot schema version ${snapshot.schemaVersion} (expected ${SNAPSHOT_SCHEMA_VERSION}).`
      );
    }

    // Validate structure prior to write
    validateSnapshot(snapshot, workspaceId);

    await this.withLock(workspaceId, async () => {
      const snapshotUri = this.getSnapshotUri(storageRoot, workspaceId);
      await this.writeJsonAtomically(snapshotUri, snapshot);

      const entry = this.memoryCache.get(workspaceId) ?? {};
      entry.snapshot = snapshot;
      this.memoryCache.set(workspaceId, entry);
    });
  }

  /**
   * Loads filtered historical finding lifecycle events for a workspace.
   */
  async loadLifecycleHistory(
    workspaceId: WorkspaceId,
    filter?: HistoryFilter
  ): Promise<readonly FindingLifecycleEvent[]> {
    const storageRoot = this.resolveStorageUri();
    const events = await this.readRawLifecycleEvents(storageRoot, workspaceId);

    let filtered = events;
    if (filter?.findingId !== undefined) {
      filtered = filtered.filter((e) => e.findingId === filter.findingId);
    }
    if (filter?.transitionKind !== undefined) {
      filtered = filtered.filter((e) => e.transitionKind === filter.transitionKind);
    }
    if (filter?.sinceTimestamp !== undefined) {
      filtered = filtered.filter((e) => e.observedAt >= filter.sinceTimestamp!);
    }

    // Deterministic ordering: chronological by observedAt ascending, secondary by eventId ascending
    const sorted = [...filtered].sort(
      (a, b) => a.observedAt - b.observedAt || a.eventId.localeCompare(b.eventId)
    );

    if (filter?.limit !== undefined) {
      const limit = Math.max(0, filter.limit);
      return sorted.slice(0, limit);
    }

    return sorted;
  }

  /**
   * Appends newly derived finding lifecycle events to the workspace transition history.
   */
  async appendLifecycleEvents(
    workspaceId: WorkspaceId,
    events: readonly FindingLifecycleEvent[]
  ): Promise<void> {
    const storageRoot = this.resolveStorageUri();

    if (events.length === 0) {
      return;
    }

    // Pre-validate all events before acquiring lock or mutating state
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.workspaceId !== workspaceId) {
        throw new WorkspaceMismatchError(
          `Event at index ${i} has workspaceId '${e.workspaceId}' which does not match target workspace '${workspaceId}'.`
        );
      }
      validateLifecycleEvent(e, workspaceId, i);
    }

    await this.withLock(workspaceId, async () => {
      const currentEvents = await this.readRawLifecycleEvents(storageRoot, workspaceId);
      const existingIds = new Set(currentEvents.map((e) => e.eventId));
      const newUniqueEvents: FindingLifecycleEvent[] = [];

      for (const e of events) {
        if (!existingIds.has(e.eventId)) {
          existingIds.add(e.eventId);
          newUniqueEvents.push(e);
        }
      }

      if (newUniqueEvents.length === 0) {
        // Idempotent: all events already persisted
        return;
      }

      const merged = [...currentEvents, ...newUniqueEvents].sort(
        (a, b) => a.observedAt - b.observedAt || a.eventId.localeCompare(b.eventId)
      );

      const historyPayload: FindingLifecycleHistory = {
        schemaVersion: LIFECYCLE_HISTORY_SCHEMA_VERSION,
        workspaceId,
        events: merged
      };

      const historyUri = this.getHistoryUri(storageRoot, workspaceId);
      await this.writeJsonAtomically(historyUri, historyPayload);

      const entry = this.memoryCache.get(workspaceId) ?? {};
      entry.history = merged;
      this.memoryCache.set(workspaceId, entry);
    });
  }

  /**
   * Prunes historical lifecycle events according to retention policy without altering snapshots.
   */
  async pruneLifecycleHistory(workspaceId: WorkspaceId, policy: RetentionPolicy): Promise<number> {
    const storageRoot = this.resolveStorageUri();

    if (policy.retentionDays === undefined && policy.maxEventsPerWorkspace === undefined) {
      return 0;
    }

    return await this.withLock(workspaceId, async () => {
      const currentEvents = await this.readRawLifecycleEvents(storageRoot, workspaceId);
      if (currentEvents.length === 0) {
        return 0;
      }

      let kept = currentEvents;

      // Retention by duration (age)
      if (policy.retentionDays !== undefined && policy.retentionDays > 0) {
        const cutoff = this.now() - policy.retentionDays * 86_400_000;
        kept = kept.filter((e) => e.observedAt >= cutoff);
      }

      // Retention by maximum event count (keep newest maxEventsPerWorkspace)
      if (policy.maxEventsPerWorkspace !== undefined) {
        const max = Math.max(0, policy.maxEventsPerWorkspace);
        if (kept.length > max) {
          kept = kept.slice(kept.length - max);
        }
      }

      const prunedCount = currentEvents.length - kept.length;
      if (prunedCount === 0) {
        return 0;
      }

      const historyPayload: FindingLifecycleHistory = {
        schemaVersion: LIFECYCLE_HISTORY_SCHEMA_VERSION,
        workspaceId,
        events: kept
      };

      const historyUri = this.getHistoryUri(storageRoot, workspaceId);
      await this.writeJsonAtomically(historyUri, historyPayload);

      const entry = this.memoryCache.get(workspaceId) ?? {};
      entry.history = [...kept];
      this.memoryCache.set(workspaceId, entry);

      return prunedCount;
    });
  }

  /**
   * Clears disposable in-memory caches without discarding snapshots or history.
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();
  }

  /**
   * Resets lifecycle event history for a workspace session without deleting the latest complete snapshot.
   */
  async resetHistory(workspaceId: WorkspaceId): Promise<void> {
    const storageRoot = this.resolveStorageUri();

    await this.withLock(workspaceId, async () => {
      const historyUri = this.getHistoryUri(storageRoot, workspaceId);
      try {
        await this.fs.delete(historyUri, { recursive: false });
      } catch (err) {
        if (!isFileNotFound(err)) {
          throw new StorageIOError(
            `Failed resetting history for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
            err
          );
        }
      }

      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.history = undefined;
      }
    });
  }

  /**
   * Deletes the snapshot record for a workspace (e.g. during failed initial commit rollback).
   */
  async deleteSnapshot(workspaceId: WorkspaceId): Promise<void> {
    const storageRoot = this.resolveStorageUri();

    await this.withLock(workspaceId, async () => {
      const snapshotUri = this.getSnapshotUri(storageRoot, workspaceId);
      try {
        await this.fs.delete(snapshotUri, { recursive: false });
      } catch (err) {
        if (!isFileNotFound(err)) {
          throw new StorageIOError(
            `Failed deleting snapshot for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
            err
          );
        }
      }

      const entry = this.memoryCache.get(workspaceId);
      if (entry) {
        entry.snapshot = undefined;
      }
    });
  }
}
