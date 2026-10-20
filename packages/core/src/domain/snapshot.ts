// Foundational persisted snapshot, lifecycle events, and reconciliation domain models
// strictly adhering to LLD.md Sections 4.14–4.16, 5.6–5.7, 10.6–10.7, 11.5–11.6, and ERD.md Section 6.

import type { EvidenceStrength, SourceSpan } from "./evidence";
import type {
  AnalysisWarning,
  Finding,
  FindingCategory,
  FindingSeverity,
  FindingState
} from "./finding";
import type {
  AnalysisCoverageSummary,
  FindingId,
  RelationshipId,
  RuleId,
  WorkspaceId
} from "./types";

/**
 * Current serialization schema version for persisted analysis snapshots.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Current serialization schema version for persisted finding lifecycle history.
 */
export const LIFECYCLE_HISTORY_SCHEMA_VERSION = 1;

/**
 * Persistent snapshot record for an active, suppressed, or verified finding as specified in LLD.md Section 4.14.
 * Fully JSON-serializable, editor-neutral, omitting transient ASTs, parser objects, and VS Code instances.
 */
export interface PersistedFindingRecord {
  /** Stable finding identity. */
  id: FindingId;
  /** Drift verification rule identifier. */
  ruleId: RuleId;
  /** Category classification of the finding. */
  category: FindingCategory;
  /** Finding severity. */
  severity: FindingSeverity;
  /** Finding lifecycle state in the snapshot (active | suppressed | resolved). */
  state: FindingState;
  /** Concise finding title. */
  title: string;
  /** Structured finding summary. */
  summary: string;
  /** Confidence/evidence strength level supporting the finding. */
  evidenceStrength: EvidenceStrength;
  /** Optional contract relationship identifier. */
  relationshipId?: RelationshipId;
  /** Source locations across consumer and provider documents. */
  sourceLocations: SourceSpan[];
  /** Optional expected contract value or schema description. */
  expected?: unknown;
  /** Optional observed contract value or schema description. */
  observed?: unknown;
  /** Analysis warnings and limitations qualifying this finding. */
  limitations: AnalysisWarning[];
  /** Unix epoch timestamp when this finding was first observed in a completed analysis. */
  firstObservedAt: number;
  /** Unix epoch timestamp when this finding was most recently confirmed in a completed analysis. */
  lastConfirmedAt: number;
}

/**
 * Last known successfully completed analysis state for a workspace strictly adhering to LLD.md Section 4.14.
 * Restored on workspace opening and never overwritten by incomplete, failed, or cancelled runs.
 */
export interface AnalysisSnapshot {
  /** Format schema version for forward/backward compatibility. */
  schemaVersion: number;
  /** Stable snapshot identifier. */
  snapshotId: string;
  /** Owning workspace session identifier. */
  workspaceId: WorkspaceId;
  /** Monotonic analysis generation counter. */
  generation: number;
  /** Unix epoch timestamp when analysis completed. */
  analyzedAt: number;
  /** Coverage, completeness status, and limitations of this snapshot. */
  coverage: AnalysisCoverageSummary;
  /** Deduplicated, deterministically ordered persisted finding records. */
  findings: readonly PersistedFindingRecord[];
  /** Optional verification integrity hash for crash/corruption detection. */
  integrityHash?: string;
}

/**
 * Meaningful transition kinds in a finding's lifecycle across completed analyses
 * as specified in LLD.md Section 4.15 and ERD.md Section 6.3.
 */
export type FindingLifecycleTransition = "detected" | "changed" | "resolved" | "reintroduced";

/**
 * Finding state within the lifecycle model as specified in LLD.md Section 4.15.
 */
export type FindingLifecycleState = "active" | "resolved" | "suppressed";

/**
 * Contextual delta details attached to a finding lifecycle transition event
 * as specified in LLD.md Section 4.15.
 */
export interface FindingLifecycleContext {
  /** Previous severity prior to material change. */
  previousSeverity?: FindingSeverity;
  /** New severity resulting from material change. */
  newSeverity?: FindingSeverity;
  /** Previous summary text prior to change. */
  previousSummary?: string;
  /** New summary text resulting from change. */
  newSummary?: string;
  /** Primary source location of the finding. */
  primaryLocation?: SourceSpan;
  /** Human-readable explanation or justification for the transition. */
  reason?: string;
}

/**
 * Historical record of a finding lifecycle transition observed across completed analyses
 * strictly adhering to LLD.md Section 4.15 and ERD.md Section 3.16.
 */
export interface FindingLifecycleEvent {
  /** Stable, deterministic event identifier. */
  eventId: string;
  /** Owning workspace identifier. */
  workspaceId: WorkspaceId;
  /** Stable finding identity undergoing the transition. */
  findingId: FindingId;
  /** Lifecycle transition kind. */
  transitionKind: FindingLifecycleTransition;
  /** Unix epoch timestamp when the transition was observed/confirmed by analysis. */
  observedAt: number;
  /** Analysis generation that confirmed the transition. */
  triggerGeneration: number;
  /** Previous lifecycle state prior to transition (undefined for first detection). */
  previousState?: FindingLifecycleState;
  /** Resulting lifecycle state after transition. */
  newState: FindingLifecycleState;
  /** Contextual delta details supporting the event. */
  context?: FindingLifecycleContext;
}

/**
 * Historical sequence of lifecycle events persisted for a workspace
 * as specified in LLD.md Section 4.15.
 */
export interface FindingLifecycleHistory {
  /** Format schema version. */
  schemaVersion: number;
  /** Owning workspace identifier. */
  workspaceId: WorkspaceId;
  /** Historical sequence of lifecycle events. */
  events: readonly FindingLifecycleEvent[];
}

/**
 * Options controlling state reconciliation behavior as specified in LLD.md Section 4.16.
 */
export interface StateReconciliationOptions {
  /**
   * When true, absent findings emit 'resolved' ONLY if current analysis coverage is verified complete.
   * Defaults to true in core reconciliation.
   */
  allowResolutionOnlyIfCoverageComplete?: boolean;

  /**
   * Optional historical lifecycle events providing explicit historical evidence to distinguish
   * 'reintroduced' findings from newly 'detected' findings without embedding persistence I/O
   * into the pure reconciliation engine.
   */
  historicalEvents?: readonly FindingLifecycleEvent[];
}

/**
 * Output of the state reconciliation process comparing fresh analysis results against
 * the previous snapshot strictly adhering to LLD.md Section 4.16.
 */
export interface ReconciliationResult {
  /** Owning workspace identifier. */
  workspaceId: WorkspaceId;
  /** Unix epoch timestamp when reconciliation was executed. */
  reconciledAt: number;
  /** The previous snapshot input, if one existed. */
  previousSnapshot?: AnalysisSnapshot;
  /**
   * The reconciled snapshot representing the latest complete state.
   *
   * Note on LLD Contract Gap 2:
   * When an initial analysis run is incomplete (previousSnapshot is undefined and currentResult.complete is false),
   * no complete snapshot exists and none is fabricated. Therefore, currentSnapshot is typed as optional
   * (AnalysisSnapshot | undefined) to represent this incomplete initial condition safely.
   */
  currentSnapshot?: AnalysisSnapshot;
  /** Lifecycle transition events emitted during this reconciliation run. */
  eventsEmitted: readonly FindingLifecycleEvent[];
  /** Count of findings carried over from the previous snapshot without material change. */
  unchangedFindingCount: number;
  /** Whether the current analysis provided sufficient verified coverage to update state. */
  coverageSufficient: boolean;
}

function cloneSourceSpan(s: SourceSpan): SourceSpan {
  return {
    uri: s.uri,
    range: { start: s.range.start, end: s.range.end },
    start: { line: s.start.line, character: s.start.character },
    end: { line: s.end.line, character: s.end.character },
    byteRange: s.byteRange ? { start: s.byteRange.start, end: s.byteRange.end } : undefined
  };
}

function cloneAnalysisWarning(l: AnalysisWarning): AnalysisWarning {
  return {
    code: l.code,
    message: l.message,
    analyzerId: l.analyzerId,
    affectsCompleteness: l.affectsCompleteness,
    source: l.source ? cloneSourceSpan(l.source) : undefined
  };
}

/**
 * Converts a runtime Finding into a persisted finding record, omitting transient ASTs,
 * parser-specific structures, or UI objects.
 */
export function toPersistedFindingRecord(
  finding: Finding,
  firstObservedAt: number,
  lastConfirmedAt: number
): PersistedFindingRecord {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    state: finding.state,
    title: finding.title,
    summary: finding.summary,
    evidenceStrength: finding.evidenceStrength,
    relationshipId: finding.relationshipId,
    sourceLocations: Array.isArray(finding.sourceLocations)
      ? finding.sourceLocations.map(cloneSourceSpan)
      : [],
    expected: finding.expected !== undefined ? finding.expected : undefined,
    observed: finding.observed !== undefined ? finding.observed : undefined,
    limitations: Array.isArray(finding.limitations)
      ? finding.limitations.map(cloneAnalysisWarning)
      : [],
    firstObservedAt,
    lastConfirmedAt
  };
}
