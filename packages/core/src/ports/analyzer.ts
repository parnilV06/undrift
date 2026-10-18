// Analyzer port, request/response contracts, and project index view
// as specified in LLD.md Section 5.2 and Section 8.4.

import type { AnalysisWarning } from "../domain/finding";
import type { ApiObservation } from "../domain/observation";
import type { DocumentUri, SourceDocument } from "../domain/types";
import type { ParsedDocument } from "./parser";
import type { ResolvedUndriftConfig } from "../config/undrift-config";

export type { ResolvedUndriftConfig } from "../config/undrift-config";

/**
 * Read-only query view of the workspace project index provided to analyzers
 * for cross-file symbol, declaration, and route lookups as specified in LLD.md Section 5.2 and 8.4.
 */
export interface ProjectIndexView {
  /** Retrieves an indexed source document snapshot by URI, if available. */
  getDocument?(uri: DocumentUri): SourceDocument | undefined;
  /** Looks up an indexed symbol or declaration by name within document or workspace scope. */
  lookupSymbol?(name: string, fromUri?: DocumentUri): unknown;
  /** Allows index implementations to expose domain-specific views or metadata. */
  readonly [key: string]: unknown;
}

/**
 * Input bundle supplied to an analyzer for extracting API observations from a parsed document
 * as specified in LLD.md Section 5.2.
 */
export interface AnalyzerInput {
  /** The exact source document snapshot being analyzed. */
  document: SourceDocument;
  /** The parsed syntax tree facade of the source document. */
  parsed: ParsedDocument;
  /** Read-only query view of the project index for cross-reference resolution. */
  projectIndex: ProjectIndexView;
  /** Resolved configuration controlling analyzer behavior. */
  config: ResolvedUndriftConfig;
}

/**
 * Output produced by an analyzer execution on a single document as specified in LLD.md Section 5.2.
 */
export interface AnalyzerOutput {
  /** Extracted API observations (both consumers and providers). */
  observations: ApiObservation[];
  /** Analysis warnings, limitations, or unresolved syntax/pattern diagnostics encountered. */
  warnings: AnalysisWarning[];
}

/**
 * Core port for language and framework analyzers as specified in LLD.md Section 5.2.
 * Analyzers consume parsed documents and produce normalized API observations and warnings
 * without performing consumer-to-provider matching or UI diagnostics.
 */
export interface LanguageAnalyzerPort {
  /** Stable identifier for this analyzer (e.g., 'analyzer-js-ts', 'analyzer-express'). */
  readonly id: string;
  /** Determines if this analyzer supports the given language and document URI. */
  supports(languageId: string, uri: DocumentUri): boolean;
  /**
   * Analyzes the supplied parsed document and returns extracted observations and warnings.
   * Accepts an optional AbortSignal for cancellation.
   */
  analyze(input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput>;
}

/**
 * Type alias for LanguageAnalyzerPort matching the general AnalyzerPort convention.
 */
export type AnalyzerPort = LanguageAnalyzerPort;
