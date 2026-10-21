// Analysis coordinator orchestrating workspace snapshotting and core analysis engine execution
// strictly adhering to LLD.md Sections 3, 5.4, 8.1–8.7, 14.1, 14.3, and Chunk 4.2.

import * as crypto from "crypto";
import type {
  AnalysisCoverageSummary,
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisStatistics,
  AnalysisWarning,
  DocumentUri,
  LanguageAnalyzerPort,
  ParserPort,
  ResolvedUndriftConfig,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import type { ExtensionLogger } from "../logging/output-channel";
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
 * Coordinates workspace snapshot discovery and core analysis engine execution.
 */
export class AnalysisCoordinator {
  private readonly workspaceManager: WorkspaceManager;
  private readonly engine: AnalysisEnginePort;
  private readonly ownsEngine: boolean;
  private readonly logger?: ExtensionLogger;
  private readonly config: ResolvedUndriftConfig;

  /** Monotonically increasing revision generation counter per workspace. */
  private readonly generations = new Map<WorkspaceId, number>();

  private disposed = false;

  constructor(options: AnalysisCoordinatorOptions = {}) {
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.logger = options.logger;
    this.config = options.config ?? DEFAULT_CONFIG;

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
   * Executes a full workspace scan and invokes the analysis engine.
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
          return {
            status: result.complete ? "success" : "incomplete",
            workspaceId,
            generation,
            result,
            totalDiscovered: 0,
            totalAcquired: 0
          };
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

          // Apply conservative partial-scope adjustments
          const adjustedResult = this.applyPartialScopeGating(rawResult, snapshot);

          return {
            status: "incomplete",
            workspaceId,
            generation,
            result: adjustedResult,
            failures: snapshot.failures,
            totalDiscovered: snapshot.totalDiscovered,
            totalAcquired: snapshot.totalAcquired
          };
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
          const status: CoordinatorOutcomeStatus = result.complete ? "success" : "incomplete";

          return {
            status,
            workspaceId,
            generation,
            result,
            totalDiscovered: snapshot.totalDiscovered,
            totalAcquired: snapshot.totalAcquired
          };
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
   * Safely disposes the coordinator and releases owned engine and parser resources.
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
  }
}
