// Diagnostic explanation and resolution guidance domain contracts
// adhering to LLD.md Section 12, PRD.md Section 12, and Phase 6.4.

import type { Finding } from "../domain/finding";
import type { RuleId } from "../domain/types";

/**
 * Resolution mode indicating whether automated repair, guided manual remediation,
 * or exploratory investigation is appropriate for a finding.
 */
export type ResolutionMode = "automatic" | "guided" | "investigation";

/**
 * Production-grade guidance contract providing structured, human-oriented explanation
 * and actionable next steps for a diagnostic finding or analysis limitation.
 */
export interface DiagnosticGuidance {
  /** Canonical rule or limitation code (e.g. 'UND100', 'UND110', 'DYNAMIC_ROUTE'). */
  readonly ruleCode: string;
  /** Human-readable title describing the contract condition. */
  readonly title: string;
  /** Context-aware explanation of what condition was observed. */
  readonly whatDetected: string;
  /** Conceptual explanation of what this finding represents and why it was flagged. */
  readonly whatItMeans: string;
  /** Description of operational and runtime consequences if left unaddressed. */
  readonly whyItMatters: string;
  /** Rationale explaining why automated code repair is unavailable or unsafe. */
  readonly whyNoAutomatedFix?: string;
  /** Ordered, actionable steps for a human developer to investigate and resolve the finding. */
  readonly suggestedSteps: readonly string[];
  /** Recommended resolution mode for this condition. */
  readonly resolutionMode: ResolutionMode;
}

/**
 * Input parameters for contextual guidance interpolation.
 */
export interface ContextualGuidanceInput {
  /** The rule or limitation identifier. */
  readonly ruleId: RuleId | string;
  /** Associated HTTP method if applicable. */
  readonly method?: string;
  /** Associated route pattern or path string if applicable. */
  readonly route?: string;
  /** Associated payload or response field name if applicable. */
  readonly targetKey?: string;
  /** Description of expected contract value or type. */
  readonly expectedDescription?: string;
  /** Description of observed contract value or type. */
  readonly observedDescription?: string;
  /** Partial shape limitation reason code if applicable. */
  readonly reasonCode?: string;
  /** Coverage warning code if applicable. */
  readonly warningCode?: string;
  /** Custom summary message from finding. */
  readonly summary?: string;
  /** Custom impact statement from finding. */
  readonly possibleImpact?: string;
  /** Whether safe automated repair proposals are available for this specific instance. */
  readonly hasAutomatedFix?: boolean;
  /** Optional source finding reference. */
  readonly finding?: Finding;
}

