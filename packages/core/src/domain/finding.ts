// Foundational analysis warnings and warning codes as specified in LLD.md Section 4.11.
// Finding structures, severity levels, categories, and rule result representations
// will be implemented in their designated future chunks.

import type { SourceSpan } from "./evidence";

/**
 * Well-defined warning codes indicating limits, syntax errors, or unresolved patterns
 * encountered during analysis.
 */
export type WarningCode =
  | "PARSE_ERROR"
  | "UNSUPPORTED_PATTERN"
  | "UNRESOLVED_REFERENCE"
  | "DYNAMIC_ROUTE"
  | "PARTIAL_SHAPE"
  | "INCOMPLETE_SCOPE"
  | "CONFIGURATION_ERROR"
  | "ANALYZER_FAILURE";

/**
 * Analysis warning indicating a limitation or failure during extraction.
 * Analysis warnings are NOT automatically drift findings and must not all
 * become error-level diagnostics.
 */
export interface AnalysisWarning {
  code: WarningCode;
  message: string;
  source?: SourceSpan;
  analyzerId?: string;
  affectsCompleteness: boolean;
}
