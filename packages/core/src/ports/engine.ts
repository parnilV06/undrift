// Core engine port, request/result contracts, statistics, and pipeline interfaces
// as specified in LLD.md Section 4.4, 4.13, 5.4, and 8.1–8.2.

import type { ResolvedUndriftConfig } from "../config/undrift-config";
import type { AnalysisWarning, Finding } from "../domain/finding";
import type { ApiObservation } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type {
  AnalysisCoverageSummary,
  DocumentUri,
  SourceDocument,
  WorkspaceId
} from "../domain/types";
import type { LanguageAnalyzerPort } from "./analyzer";
import type { ParserPort } from "./parser";
import type { ContractMatcher } from "../matching/contract-matcher";
import type { RuleEngine } from "../rules/rule-engine";

export type { AnalysisCoverageSummary } from "../domain/types";

/**
 * Statistics summarizing the execution, resource counts, and duration of an analysis run
 * as specified in LLD.md Section 4.13.
 */
export interface AnalysisStatistics {
  /** Total number of source documents considered in the request. */
  filesConsidered: number;
  /** Number of source documents successfully parsed by eligible parsers. */
  filesParsed: number;
  /** Number of documents that produced parser or analyzer warnings. */
  filesWithWarnings: number;
  /** Number of extracted client-side consumer API observations. */
  consumerObservations: number;
  /** Number of extracted server-side provider API observations. */
  providerObservations: number;
  /** Number of candidate or matched contract relationships evaluated. */
  relationships: number;
  /** Total number of active drift and limitation findings emitted. */
  activeFindings: number;
  /** Count of dynamic, unresolved, or unsupported syntax and type patterns encountered. */
  unresolvedPatterns: number;
  /** Total elapsed execution duration in milliseconds. */
  durationMs: number;
}

/**
 * Analysis request specifying workspace scope, snapshot documents, and configuration
 * strictly adhering to LLD.md Section 4.4.
 */
export interface AnalysisRequest {
  /** Unique workspace session identifier. */
  workspaceId: WorkspaceId;
  /** Root filesystem URI strings belonging to this workspace. */
  workspaceRootUris: string[];
  /** Monotonically increasing revision generation counter preventing stale results. */
  generation: number;
  /** In-memory snapshot of source documents participating in this analysis. */
  documents: SourceDocument[];
  /** Resolved configuration controlling analyzer and rule behavior. */
  config: ResolvedUndriftConfig;
  /** Optional subset of document URIs that changed since previous generation. */
  changedUris?: DocumentUri[];
  /** Analysis mode: 'workspace' for full scan, 'scoped' for targeted re-analysis. */
  mode: "workspace" | "scoped";
}

/**
 * Structured result produced by the analysis engine pipeline strictly adhering to LLD.md Section 4.13.
 * Fully JSON-serializable, editor-neutral, and without mutable internal state.
 */
export interface AnalysisResult {
  /** The workspace identifier from the originating request. */
  workspaceId: WorkspaceId;
  /** Monotonic generation number from the originating request. */
  generation: number;
  /** Unix epoch timestamp in milliseconds when this result was assembled. */
  generatedAt: number;
  /** Whether the analysis was sufficiently complete within the requested scope. */
  complete: boolean;
  /** Extracted and normalized consumer and provider API observations. */
  observations: ApiObservation[];
  /** Matched and unmatched contract relationships between observations. */
  relationships: ContractRelationship[];
  /** Deduplicated, deterministically sorted drift and limitation findings. */
  findings: Finding[];
  /** Warnings and limitations collected across parsing, extraction, and rule evaluation. */
  warnings: AnalysisWarning[];
  /** Quantitative execution metrics and observation counts. */
  statistics: AnalysisStatistics;
}

/**
 * Documented pipeline dependencies contract as specified in LLD.md Section 8.2.
 *
 * Note: As specified in LLD.md Section 21 and the Phase 3 chunk boundary,
 * FixGeneratorRegistry (Phase 5) and AnalysisReportBuilder remain deferred beyond Chunk 3.7.
 * The in-memory AnalysisEngine in Chunk 3.7 accepts AnalysisEngineDependencies.
 */
export interface PipelineDependencies {
  readonly parsers: readonly ParserPort[];
  readonly analyzers: readonly LanguageAnalyzerPort[];
  readonly matcher: ContractMatcher;
  readonly ruleEngine: RuleEngine;
  readonly explainer?: unknown;
  readonly fixRegistry?: unknown;
  readonly reportBuilder?: unknown;
}

/**
 * In-memory analysis engine dependencies for Chunk 3.7.
 * Separated from the full LLD §8.2 PipelineDependencies contract to reflect
 * the established Chunk 3.7 boundaries without fabricating deferred registries.
 */
export interface AnalysisEngineDependencies {
  readonly parsers?: readonly ParserPort[];
  readonly analyzers?: readonly LanguageAnalyzerPort[];
  readonly matcher?: ContractMatcher;
  readonly ruleEngine?: RuleEngine;
}

/**
 * Pipeline orchestration interface as specified in LLD.md Section 8.2.
 */
export interface AnalysisPipeline {
  /**
   * Executes an end-to-end analysis run on the requested source documents.
   *
   * @param request The analysis request snapshot.
   * @param signal Optional cancellation signal.
   * @returns Structured, serializable AnalysisResult.
   */
  run(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
}

/**
 * Core engine port interface as specified in LLD.md Section 5.4.
 */
export interface AnalysisEnginePort {
  /**
   * Executes an analysis run on the requested workspace snapshot.
   */
  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
  /**
   * Disposes engine resources and cached parser trees.
   */
  dispose(): Promise<void>;
}
