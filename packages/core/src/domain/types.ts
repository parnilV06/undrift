// Foundational domain types and identifiers as specified in LLD.md Section 4.1, 4.4, 4.14 and ERD.md.
// Additional domain types for API observations, endpoints, route patterns, and type shapes
// will be implemented in their designated chunks.

import type { AnalysisWarning } from "./finding";

/**
 * Stable identifier for a workspace or session.
 */
export type WorkspaceId = string;

/**
 * Universal document identifier (e.g. URI string).
 */
export type DocumentUri = string;

/**
 * Stable identifier for an observed API fact.
 */
export type ObservationId = string;

/**
 * Stable identifier for a candidate or matched contract relationship.
 */
export type RelationshipId = string;

/**
 * Stable identifier for an API drift or diagnostic finding.
 */
export type FindingId = string;

/**
 * Stable identifier for a proposed remediation edit.
 */
export type FixProposalId = string;

/**
 * Identifier of a drift verification rule.
 */
export type RuleId = string;

/**
 * Normalized HTTP methods supported by the domain model.
 * Non-literal or unsupported method expressions remain unresolved evidence
 * rather than being forced into this union.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/**
 * In-memory source document snapshot participating in analysis.
 * Represents a finite snapshot provided by the editor or workspace scanner.
 * Does not depend on VS Code TextDocument or filesystem APIs.
 */
export interface SourceDocument {
  uri: DocumentUri;
  languageId: string;
  text: string;
  contentHash: string;
  documentVersion?: number;
  isDirty?: boolean;
}

/**
 * Tri-state completeness indicator used by observations and shape models.
 * Preserves the distinction between an intentionally complete shape, a partially
 * extracted shape, and an unknown shape.
 */
export type CompletenessStatus = "complete" | "partial" | "unknown";

/**
 * Analysis run execution lifecycle states as specified in ERD.md Section 3.3 and 6.1.
 */
export type AnalysisStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

/**
 * Per-document parse status as specified in ERD.md Section 3.4.
 */
export type ParseStatus = "parsed" | "partial" | "failed" | "skipped";

/**
 * Coarse analysis completeness classification distinguishing complete, partial,
 * unknown, and failed analysis runs.
 */
export type AnalysisCompleteness = "complete" | "partial" | "unknown" | "failed";

/**
 * Summary of analysis coverage and completeness for a workspace generation.
 * Distinguishes a clean complete run from an incomplete or warning-gated run.
 */
export interface AnalysisCoverageSummary {
  complete: boolean;
  backendComplete?: boolean;
  consumerComplete?: boolean;
  filesScanned: number;
  filesWithWarnings: number;
  unresolvedPatterns: number;
  warnings: AnalysisWarning[];
}
