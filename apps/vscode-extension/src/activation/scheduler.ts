// AnalysisScheduler orchestrating debounced workspace analysis, change coalescing,
// live event registration, and cancellation of obsolete in-progress work as specified in
// LLD.md Sections 3, 4.4, 8.7, 14.1–14.3, and Chunk 4.4.

import type { WorkspaceId } from "@undrift/core";
import type { ExtensionLogger } from "../logging/output-channel";
import {
  DEFAULT_EXCLUDE_GLOBS,
  isPathExcluded,
  isSupportedSourceFile,
  type UriLike,
  WorkspaceManager
} from "../workspace";
import {
  type AnalysisCoordinator,
  type CancellationTokenLike,
  type CoordinatorAnalysisResult,
  deriveWorkspaceId
} from "./coordinator";

/**
 * Lightweight abstraction over VS Code workspace change event subscriptions.
 * Allows deterministic unit and integration testing without a running VS Code extension host.
 */
export interface WorkspaceEventSource {
  onDidChangeTextDocument(
    listener: (e: {
      document: { uri: UriLike; languageId?: string };
      contentChanges: readonly unknown[];
    }) => void
  ): { dispose(): void };
  onDidOpenTextDocument(listener: (doc: { uri: UriLike; languageId?: string }) => void): {
    dispose(): void;
  };
  onDidSaveTextDocument(listener: (doc: { uri: UriLike; languageId?: string }) => void): {
    dispose(): void;
  };
  onDidCreateFiles(listener: (e: { files: readonly UriLike[] }) => void): { dispose(): void };
  onDidDeleteFiles(listener: (e: { files: readonly UriLike[] }) => void): { dispose(): void };
  onDidRenameFiles(
    listener: (e: { files: readonly { oldUri: UriLike; newUri: UriLike }[] }) => void
  ): { dispose(): void };
}

/**
 * Options for configuring the AnalysisScheduler.
 */
export interface AnalysisSchedulerOptions {
  /** The coordinator executing analysis runs and managing generation state. */
  readonly coordinator: AnalysisCoordinator;
  /** WorkspaceManager providing active workspace roots and file discovery. */
  readonly workspaceManager?: WorkspaceManager;
  /**
   * Debounce delay window in milliseconds for coalescing rapid keystrokes/edits.
   * Default: 300ms.
   */
  readonly debounceDelayMs?: number;
  /** Additional glob exclusion patterns beyond defaults. */
  readonly additionalExcludeGlobs?: readonly string[];
  /** Optional diagnostic logger. */
  readonly logger?: ExtensionLogger;
}

interface PendingDeferred {
  readonly resolve: (result: CoordinatorAnalysisResult) => void;
  readonly reject: (err: unknown) => void;
}

/**
 * Default debounce delay window for coalescing rapid keystrokes/edits.
 */
export const DEFAULT_DEBOUNCE_DELAY_MS = 300;

/**
 * Manages debounced analysis scheduling for workspace source changes.
 * Coalesces rapid change bursts into a single scheduled scan, cancels in-progress obsolete work,
 * and maintains independent scheduling queues per workspace identity.
 */
export class AnalysisScheduler {
  private readonly coordinator: AnalysisCoordinator;
  private readonly workspaceManager: WorkspaceManager;
  private readonly debounceDelayMs: number;
  private readonly excludePatterns: readonly string[];
  private readonly logger?: ExtensionLogger;

  /** Active debounce timer handles keyed by WorkspaceId. */
  private readonly timers = new Map<WorkspaceId, NodeJS.Timeout>();

  /** Queued promises awaiting the outcome of the coalesced debounce burst. */
  private readonly pendingDeferreds = new Map<WorkspaceId, PendingDeferred[]>();

  /** Registered event subscriptions. */
  private readonly subscriptions: { dispose(): void }[] = [];

  private disposed = false;

  constructor(options: AnalysisSchedulerOptions) {
    this.coordinator = options.coordinator;
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.debounceDelayMs = options.debounceDelayMs ?? DEFAULT_DEBOUNCE_DELAY_MS;
    this.logger = options.logger;

    this.excludePatterns = [...DEFAULT_EXCLUDE_GLOBS, ...(options.additionalExcludeGlobs ?? [])];
  }

  /**
   * Schedules a debounced workspace scan.
   * If rapid calls arrive within the debounce delay, previous timers are cancelled
   * and the changes are coalesced into the single upcoming scan.
   */
  public scheduleScan(options?: {
    delayMs?: number;
    targetWorkspaceId?: WorkspaceId;
  }): Promise<CoordinatorAnalysisResult> {
    if (this.disposed) {
      return Promise.resolve({
        status: "failed",
        errorMessage: "AnalysisScheduler has already been disposed."
      });
    }

    const workspaceId = options?.targetWorkspaceId ?? this.resolveActiveWorkspaceId();
    if (!workspaceId) {
      return this.coordinator.runWorkspaceScan();
    }

    // When a newer scan is scheduled, immediately signal cancellation on any
    // obsolete in-progress scan for this workspace so computing resources are not wasted
    this.coordinator.supersedeActiveScan(workspaceId);

    // Clear existing debounce timer if one is already ticking for this workspace
    const existingTimer = this.timers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(workspaceId);
    }

    const delay = options?.delayMs ?? this.debounceDelayMs;

    return new Promise<CoordinatorAnalysisResult>((resolve, reject) => {
      let deferreds = this.pendingDeferreds.get(workspaceId);
      if (!deferreds) {
        deferreds = [];
        this.pendingDeferreds.set(workspaceId, deferreds);
      }
      deferreds.push({ resolve, reject });

      const timer = setTimeout(async () => {
        this.timers.delete(workspaceId);
        const callers = this.pendingDeferreds.get(workspaceId) ?? [];
        this.pendingDeferreds.delete(workspaceId);

        if (this.disposed) {
          for (const c of callers) {
            c.resolve({
              status: "failed",
              errorMessage: "AnalysisScheduler was disposed before scheduled scan executed."
            });
          }
          return;
        }

        try {
          const outcome = await this.coordinator.runWorkspaceScan();
          for (const c of callers) {
            c.resolve(outcome);
          }
        } catch (err) {
          for (const c of callers) {
            c.reject(err);
          }
        }
      }, delay);

      this.timers.set(workspaceId, timer);
    });
  }

  /**
   * Executes an immediate scan (e.g. from the explicit undrift.scanWorkspace command).
   * Cancels any pending debounce timer for the active workspace and resolves any queued
   * debounce callers with the fresh immediate result.
   */
  public async runImmediateScan(
    cancellationToken?: CancellationTokenLike
  ): Promise<CoordinatorAnalysisResult> {
    if (this.disposed) {
      return {
        status: "failed",
        errorMessage: "AnalysisScheduler has already been disposed."
      };
    }

    const workspaceId = this.resolveActiveWorkspaceId();
    if (workspaceId) {
      const existingTimer = this.timers.get(workspaceId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.timers.delete(workspaceId);
      }
    }

    const outcome = await this.coordinator.runWorkspaceScan(cancellationToken);

    if (workspaceId) {
      const callers = this.pendingDeferreds.get(workspaceId);
      if (callers && callers.length > 0) {
        this.pendingDeferreds.delete(workspaceId);
        for (const c of callers) {
          c.resolve(outcome);
        }
      }
    }

    return outcome;
  }

  /**
   * Cancels any pending debounce timer for the specified workspace.
   */
  public cancelPendingScan(workspaceId?: WorkspaceId): boolean {
    const id = workspaceId ?? this.resolveActiveWorkspaceId();
    if (!id) return false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);

      const callers = this.pendingDeferreds.get(id);
      if (callers) {
        this.pendingDeferreds.delete(id);
        for (const c of callers) {
          c.resolve({
            status: "cancelled",
            workspaceId: id,
            errorMessage: "Scheduled scan was cancelled before debounce timer fired."
          });
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Checks whether a debounced scan is currently pending for the specified workspace.
   */
  public hasPendingScan(workspaceId?: WorkspaceId): boolean {
    const id = workspaceId ?? this.resolveActiveWorkspaceId();
    return id ? this.timers.has(id) : false;
  }

  /**
   * Handles text document edit events.
   * Filters out irrelevant files (non-supported extensions, exclusions, outside workspace  /**
   * Helper extracting string URI from raw string, UriLike, or event document wrapper.
   */
  private extractUriString(param: unknown): string | undefined {
    if (!param) return undefined;
    if (typeof param === "string") return param;
    if (typeof param === "object") {
      const maybeDoc = (param as { document?: { uri?: unknown } }).document;
      if (maybeDoc && maybeDoc.uri) {
        return typeof maybeDoc.uri === "string"
          ? maybeDoc.uri
          : (maybeDoc.uri as { toString(): string }).toString();
      }
      const maybeUri = (param as { uri?: unknown }).uri;
      if (maybeUri) {
        return typeof maybeUri === "string"
          ? maybeUri
          : (maybeUri as { toString(): string }).toString();
      }
      if (typeof (param as { toString(): string }).toString === "function") {
        return (param as { toString(): string }).toString();
      }
    }
    return undefined;
  }

  /**
   * Handles text document edit events.
   * Filters out irrelevant files (non-supported extensions, exclusions, outside workspace)
   * and empty edits before scheduling a debounced scan.
   */
  public handleDocumentChange(
    param: UriLike | string | { uri?: UriLike | string; document?: { uri?: UriLike | string } },
    contentChangesLength?: number
  ): Promise<CoordinatorAnalysisResult> | undefined {
    if (contentChangesLength === 0) {
      return undefined;
    }
    const uriStr = this.extractUriString(param);
    if (!uriStr || !this.isRelevantUri(uriStr)) {
      return undefined;
    }
    const wsId = this.resolveWorkspaceForUri(uriStr);
    return this.scheduleScan({ targetWorkspaceId: wsId });
  }

  /**
   * Handles document open events.
   */
  public handleDocumentOpen(
    param: UriLike | string | { uri?: UriLike | string; document?: { uri?: UriLike | string } }
  ): Promise<CoordinatorAnalysisResult> | undefined {
    const uriStr = this.extractUriString(param);
    if (!uriStr || !this.isRelevantUri(uriStr)) {
      return undefined;
    }
    const wsId = this.resolveWorkspaceForUri(uriStr);
    return this.scheduleScan({ targetWorkspaceId: wsId });
  }

  /**
   * Handles document save events.
   */
  public handleDocumentSave(
    param: UriLike | string | { uri?: UriLike | string; document?: { uri?: UriLike | string } }
  ): Promise<CoordinatorAnalysisResult> | undefined {
    const uriStr = this.extractUriString(param);
    if (!uriStr || !this.isRelevantUri(uriStr)) {
      return undefined;
    }
    const wsId = this.resolveWorkspaceForUri(uriStr);
    return this.scheduleScan({ targetWorkspaceId: wsId });
  }

  /**
   * Handles file creation events.
   */
  public handleFilesCreated(
    files: readonly (UriLike | string | { uri?: UriLike | string })[]
  ): Promise<CoordinatorAnalysisResult> | undefined {
    for (const file of files) {
      const uriStr = this.extractUriString(file);
      if (uriStr && this.isRelevantUri(uriStr)) {
        const wsId = this.resolveWorkspaceForUri(uriStr);
        return this.scheduleScan({ targetWorkspaceId: wsId });
      }
    }
    return undefined;
  }

  /**
   * Handles file deletion events.
   */
  public handleFilesDeleted(
    files: readonly (UriLike | string | { uri?: UriLike | string })[]
  ): Promise<CoordinatorAnalysisResult> | undefined {
    for (const file of files) {
      const uriStr = this.extractUriString(file);
      if (uriStr && this.isRelevantUri(uriStr)) {
        const wsId = this.resolveWorkspaceForUri(uriStr);
        return this.scheduleScan({ targetWorkspaceId: wsId });
      }
    }
    return undefined;
  }

  /**
   * Handles file rename events.
   */
  public handleFilesRenamed(
    files: readonly { oldUri: UriLike | string; newUri: UriLike | string }[]
  ): Promise<CoordinatorAnalysisResult> | undefined {
    for (const item of files) {
      const oldStr = this.extractUriString(item.oldUri);
      const newStr = this.extractUriString(item.newUri);
      if ((oldStr && this.isRelevantUri(oldStr)) || (newStr && this.isRelevantUri(newStr))) {
        const wsId =
          (newStr ? this.resolveWorkspaceForUri(newStr) : undefined) ??
          (oldStr ? this.resolveWorkspaceForUri(oldStr) : undefined);
        return this.scheduleScan({ targetWorkspaceId: wsId });
      }
    }
    return undefined;
  }

  /**
   * Evaluates whether a file URI is relevant to UNDRIFT analysis:
   * 1. Has a supported extension (.js, .ts, .jsx, .tsx, etc.)
   * 2. Is not matched by default or configured exclusion globs
   * 3. Resides within an open workspace folder
   */
  public isRelevantUri(uriStr: string): boolean {
    if (!isSupportedSourceFile(uriStr)) {
      return false;
    }
    if (isPathExcluded(uriStr, this.excludePatterns)) {
      return false;
    }
    const roots = this.workspaceManager.getWorkspaceRoots();
    if (roots.length === 0) {
      return false;
    }

    const normalizedUri = uriStr.replace(/\\/g, "/");
    return roots.some((root) => {
      const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalizedUri.startsWith(normalizedRoot + "/") || normalizedUri === normalizedRoot;
    });
  }

  /**
   * Registers document and workspace event listeners with the provided event source,
   * or defaults to live VS Code workspace events if running in extension host.
   */
  public registerWorkspaceEvents(eventSource?: WorkspaceEventSource): { dispose(): void } {
    const source = eventSource ?? this.resolveDefaultVsCodeEventSource();
    if (!source) {
      return { dispose: () => {} };
    }

    const subs: { dispose(): void }[] = [];

    subs.push(
      source.onDidChangeTextDocument((e) => {
        const changesCount = e.contentChanges ? e.contentChanges.length : undefined;
        this.handleDocumentChange(e.document.uri, changesCount);
      })
    );

    subs.push(
      source.onDidOpenTextDocument((doc) => {
        this.handleDocumentOpen(doc.uri);
      })
    );

    subs.push(
      source.onDidSaveTextDocument((doc) => {
        this.handleDocumentSave(doc.uri);
      })
    );

    subs.push(
      source.onDidCreateFiles((e) => {
        this.handleFilesCreated(e.files);
      })
    );

    subs.push(
      source.onDidDeleteFiles((e) => {
        this.handleFilesDeleted(e.files);
      })
    );

    subs.push(
      source.onDidRenameFiles((e) => {
        this.handleFilesRenamed(e.files);
      })
    );

    for (const s of subs) {
      this.subscriptions.push(s);
    }

    return {
      dispose: () => {
        for (const s of subs) {
          try {
            s.dispose();
          } catch {
            // ignore cleanup error
          }
        }
      }
    };
  }

  /**
   * Resolves the WorkspaceId for a specific file URI.
   */
  public resolveWorkspaceForUri(uriStr: string): WorkspaceId | undefined {
    const roots = this.workspaceManager.getWorkspaceRoots();
    if (roots.length === 0) {
      return undefined;
    }
    const normalizedUri = uriStr.replace(/\\/g, "/");
    const matchingRoots = roots.filter((root) => {
      const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalizedUri.startsWith(normalizedRoot + "/") || normalizedUri === normalizedRoot;
    });

    if (matchingRoots.length > 0) {
      return deriveWorkspaceId(roots);
    }
    return undefined;
  }

  /**
   * Resolves the current active WorkspaceId from workspace roots.
   */
  public resolveActiveWorkspaceId(): WorkspaceId | undefined {
    const roots = this.workspaceManager.getWorkspaceRoots();
    return roots.length > 0 ? deriveWorkspaceId(roots) : undefined;
  }

  /**
   * Disposes the scheduler, clearing all pending timers, rejecting queued promises,
   * and unregistering all event subscriptions.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const callers of this.pendingDeferreds.values()) {
      for (const c of callers) {
        c.resolve({
          status: "failed",
          errorMessage: "AnalysisScheduler was disposed."
        });
      }
    }
    this.pendingDeferreds.clear();

    for (const s of this.subscriptions) {
      try {
        s.dispose();
      } catch {
        // ignore
      }
    }
    this.subscriptions.length = 0;
  }

  /**
   * Resolves live vscode.workspace event source if running in VS Code.
   */
  private resolveDefaultVsCodeEventSource(): WorkspaceEventSource | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require("vscode");
      if (vscode && vscode.workspace) {
        return vscode.workspace;
      }
    } catch {
      // Not running in VS Code runtime (e.g. Vitest test runner)
    }
    return undefined;
  }
}
