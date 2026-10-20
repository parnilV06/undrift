// Analysis limitation rules for UND900, UND910, and UND920 as specified in LLD.md Section 11.1.
// Converts extractor warnings and parser limits into canonical Finding domain entities.

import type { AnalysisWarning, Finding } from "../domain/finding";
import { createFindingId } from "../domain/finding";
import type { DocumentUri, ObservationId, RelationshipId } from "../domain/types";
import { explainFinding, formatExplanationText } from "../explaining/finding-explainer";

/**
 * Supported analysis limitation rule identifiers as defined in LLD.md Section 11.1.
 */
export const LIMITATION_RULE_IDS = {
  UND900: "UND900",
  UND910: "UND910",
  UND920: "UND920"
} as const;

export type LimitationRuleId = (typeof LIMITATION_RULE_IDS)[keyof typeof LIMITATION_RULE_IDS];

/**
 * Context provided when evaluating a limitation warning.
 */
export interface LimitationWarningContext {
  warning: AnalysisWarning;
  observationId?: ObservationId;
  observationIds?: readonly ObservationId[];
  relationshipId?: RelationshipId;
  uri?: DocumentUri;
  targetKey?: string;
}

/**
 * Maps a single AnalysisWarning to an analysis-limitation Finding if it corresponds to
 * UND900, UND910, or UND920 per LLD.md Section 11.1.
 *
 * Returns undefined if the warning code does not belong to a limitation rule
 * (e.g. DYNAMIC_ROUTE, PARTIAL_SHAPE, CONFIGURATION_ERROR, ANALYZER_FAILURE).
 */
export function evaluateLimitationWarning(context: LimitationWarningContext): Finding | undefined {
  const { warning } = context;
  let ruleId: LimitationRuleId | undefined;
  let title: string;

  switch (warning.code) {
    case "UNSUPPORTED_PATTERN":
      ruleId = "UND900";
      title = "Unsupported pattern limits analysis";
      break;

    case "UNRESOLVED_REFERENCE":
      ruleId = "UND910";
      title = "Type or reference unresolved";
      break;

    case "PARSE_ERROR":
      ruleId = "UND920";
      title = "Parse error limits analysis coverage";
      break;

    case "INCOMPLETE_SCOPE":
      ruleId = "UND920";
      title = "Incomplete analysis scope affects coverage";
      break;

    default:
      // Other warning codes are not analysis-limitation rules under LLD Section 11.1
      return undefined;
  }

  const observationIds = context.observationIds
    ? [...context.observationIds]
    : context.observationId
      ? [context.observationId]
      : [];

  const sourceLocations = warning.source ? [warning.source] : [];
  const scopeUri = context.uri ?? warning.source?.uri;
  const targetKey = context.targetKey ?? warning.message;

  const id = createFindingId({
    ruleId,
    warningCode: warning.code,
    scopeUri,
    targetKey,
    observationIds
  });

  const structuredExplanation = explainFinding({
    ruleId,
    title,
    warningCode: warning.code,
    warningMessage: warning.message,
    sourceLocations,
    limitations: [warning],
    evidenceStrength: warning.source ? "direct" : "inferred"
  });

  // Severity follows LLD Section 11.1:
  // UND900: info/warning based on completeness impact
  // UND910: info/warning based on completeness impact
  // UND920: warning (parse/scope issue directly limits coverage)
  const severity =
    ruleId === "UND920" ? "warning" : warning.affectsCompleteness ? "warning" : "info";

  return {
    id,
    ruleId,
    category: "analysis-limit",
    severity,
    state: "active",
    title,
    summary: warning.message || structuredExplanation.summary,
    explanation: formatExplanationText(structuredExplanation),
    evidenceStrength: warning.source ? "direct" : "inferred",
    relationshipId: context.relationshipId,
    observationIds,
    sourceLocations,
    expected: undefined,
    observed: undefined,
    impactStatement: structuredExplanation.possibleImpact,
    limitations: [warning],
    fixProposalIds: [],
    structuredExplanation
  };
}

/**
 * Evaluates a collection of limitation warning contexts into deduplicated, deterministically ordered Findings.
 */
export function evaluateLimitationRules(contexts: readonly LimitationWarningContext[]): Finding[] {
  const seenIds = new Set<string>();
  const findings: Finding[] = [];

  for (const ctx of contexts) {
    const finding = evaluateLimitationWarning(ctx);
    if (finding && !seenIds.has(finding.id)) {
      seenIds.add(finding.id);
      findings.push(finding);
    }
  }

  // Deterministically sort findings by ID
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
