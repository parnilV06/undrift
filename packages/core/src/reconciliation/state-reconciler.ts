// In-memory state reconciliation engine strictly adhering to LLD.md Sections 4.14–4.16, 5.7, 10.6–10.7, 11.5–11.6, 13.1–13.4, and ERD.md Section 6.
// Compares AnalysisResult against an optional previous AnalysisSnapshot, preserves stable finding identity,
// derives lifecycle events with conservative coverage gating, and constructs updated candidate snapshots.

import * as crypto from "crypto";
import type { Finding } from "../domain/finding";
import type {
  AnalysisSnapshot,
  FindingLifecycleContext,
  FindingLifecycleEvent,
  FindingLifecycleState,
  FindingLifecycleTransition,
  PersistedFindingRecord,
  ReconciliationResult,
  StateReconciliationOptions
} from "../domain/snapshot";
import { SNAPSHOT_SCHEMA_VERSION, toPersistedFindingRecord } from "../domain/snapshot";
import type { AnalysisCoverageSummary, FindingId, WorkspaceId } from "../domain/types";
import type { AnalysisResult } from "../ports/engine";
import type { StateReconciliationPort } from "../ports/persistence";

/**
 * Result of evaluating whether a finding underwent a material difference
 * between completed analyses.
 */
interface MaterialChangeAssessment {
  isChanged: boolean;
  reason?: string;
}

/**
 * Evaluates whether a finding has materially changed between two completed analyses.
 *
 * Open Decision in LLD §4.15 & §13.2:
 * Material differences include:
 * - Finding severity updates (e.g. warning to error).
 * - Finding state updates (e.g. active to suppressed).
 * - Finding category classification updates.
 * - Expected or observed contract schema/value changes.
 *
 * Material differences strictly EXCLUDE:
 * - Minor wording or summary phrasing differences.
 * - Source location line offset updates (line drift) when the underlying finding nature is the same.
 */
function assessMaterialChange(
  prevRecord: PersistedFindingRecord,
  currFinding: Finding
): MaterialChangeAssessment {
  if (prevRecord.severity !== currFinding.severity) {
    return {
      isChanged: true,
      reason: `Severity changed from '${prevRecord.severity}' to '${currFinding.severity}'.`
    };
  }

  if (prevRecord.state !== currFinding.state) {
    return {
      isChanged: true,
      reason: `State changed from '${prevRecord.state}' to '${currFinding.state}'.`
    };
  }

  if (prevRecord.category !== currFinding.category) {
    return {
      isChanged: true,
      reason: `Category changed from '${prevRecord.category}' to '${currFinding.category}'.`
    };
  }

  // Contract value / expected shape difference check
  if (
    prevRecord.expected !== undefined &&
    currFinding.expected !== undefined &&
    JSON.stringify(prevRecord.expected) !== JSON.stringify(currFinding.expected)
  ) {
    return {
      isChanged: true,
      reason: "Expected contract shape or value changed."
    };
  }

  // Contract value / observed shape difference check
  if (
    prevRecord.observed !== undefined &&
    currFinding.observed !== undefined &&
    JSON.stringify(prevRecord.observed) !== JSON.stringify(currFinding.observed)
  ) {
    return {
      isChanged: true,
      reason: "Observed contract shape or value changed."
    };
  }

  return { isChanged: false };
}

interface HistoricalFindingAssessment {
  transition: FindingLifecycleTransition;
  previousState?: FindingLifecycleState;
  firstObservedAt: number;
  reason: string;
}

/**
 * Assesses whether a newly observed finding (absent from the previous snapshot)
 * represents a genuinely reintroduced finding or a new detection, based on
 * explicit historical evidence without guessing.
 */
function assessFindingHistory(
  findingId: FindingId,
  workspaceId: WorkspaceId,
  currentGeneratedAt: number,
  historicalEvents?: readonly FindingLifecycleEvent[]
): HistoricalFindingAssessment {
  if (!historicalEvents || historicalEvents.length === 0) {
    return {
      transition: "detected",
      previousState: undefined,
      firstObservedAt: currentGeneratedAt,
      reason: "First observed in completed analysis"
    };
  }

  // Filter events belonging to this workspace and finding
  const relevantEvents = historicalEvents.filter(
    (e) => e && e.findingId === findingId && e.workspaceId === workspaceId
  );

  if (relevantEvents.length === 0) {
    return {
      transition: "detected",
      previousState: undefined,
      firstObservedAt: currentGeneratedAt,
      reason: "First observed in completed analysis (no prior history)"
    };
  }

  // Find the earliest valid observation timestamp to preserve across reintroduction
  let earliestObservedAt = currentGeneratedAt;
  for (const e of relevantEvents) {
    if (typeof e.observedAt === "number" && e.observedAt < earliestObservedAt) {
      earliestObservedAt = e.observedAt;
    }
  }

  // Sort events to find the latest known event:
  // Primary key: observedAt ascending; Secondary key: triggerGeneration ascending
  const sorted = [...relevantEvents].sort((a, b) => {
    const timeDiff = (a.observedAt ?? 0) - (b.observedAt ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return (a.triggerGeneration ?? 0) - (b.triggerGeneration ?? 0);
  });

  const latestEvent = sorted[sorted.length - 1];

  // For a finding to be genuinely reintroduced, the latest known event must have been 'resolved'
  // (either newState === 'resolved' or transitionKind === 'resolved').
  // If the latest event indicates 'active' or 'suppressed' (contradictory with absence from previous snapshot),
  // or if event state is unknown/invalid (insufficient evidence), we do NOT guess resolution.
  const isResolvedInHistory =
    latestEvent.newState === "resolved" || latestEvent.transitionKind === "resolved";

  if (isResolvedInHistory) {
    return {
      transition: "reintroduced",
      previousState: "resolved",
      firstObservedAt: earliestObservedAt,
      reason: "Finding reintroduced after prior resolution in lifecycle history"
    };
  }

  // Contradictory or insufficient historical evidence:
  // e.g., latest event was not 'resolved', or event data was ambiguous.
  // Conservatively emit 'detected' without guessing historical resolution.
  return {
    transition: "detected",
    previousState: undefined,
    firstObservedAt: earliestObservedAt,
    reason: "First observed in completed analysis (prior history insufficient or contradictory)"
  };
}
function createSnapshotId(
  workspaceId: WorkspaceId,
  generation: number,
  analyzedAt: number
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${workspaceId}:${generation}:${analyzedAt}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `snap:${workspaceId}:${generation}:${hash}`;
}

/**
 * Derives a deterministic finding lifecycle event identifier.
 */
function createLifecycleEventId(
  workspaceId: WorkspaceId,
  generation: number,
  findingId: FindingId,
  transition: FindingLifecycleTransition
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${workspaceId}:${generation}:${findingId}:${transition}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `evt:${generation}:${hash}`;
}

/**
 * Assembles an AnalysisCoverageSummary from an AnalysisResult without overstating completeness.
 */
export function extractCoverageSummary(result: AnalysisResult): AnalysisCoverageSummary {
  const hasCriticalWarning =
    Array.isArray(result.warnings) && result.warnings.some((w) => w.affectsCompleteness);
  const complete = Boolean(result.complete && !hasCriticalWarning);

  return {
    complete,
    filesScanned: result.statistics?.filesConsidered ?? 0,
    filesWithWarnings: result.statistics?.filesWithWarnings ?? 0,
    unresolvedPatterns: result.statistics?.unresolvedPatterns ?? 0,
    warnings: Array.isArray(result.warnings) ? [...result.warnings] : []
  };
}

/**
 * In-memory reconciliation function comparing a new AnalysisResult with an optional prior AnalysisSnapshot
 * strictly adhering to LLD.md Section 13.1–13.4 and ERD.md Section 6.
 *
 * Primary Safety Invariant:
 * An incomplete, interrupted, or failed analysis must never produce false resolution events
 * or replace the last known complete snapshot with an incomplete snapshot.
 */
export function reconcileState(
  currentResult: AnalysisResult,
  previousSnapshot: AnalysisSnapshot | undefined,
  options?: StateReconciliationOptions
): ReconciliationResult {
  // 1. Input validation & workspace identity preservation
  if (
    !currentResult ||
    typeof currentResult.workspaceId !== "string" ||
    currentResult.workspaceId.trim().length === 0
  ) {
    throw new Error("Invalid AnalysisResult: workspaceId is required.");
  }

  if (previousSnapshot !== undefined && previousSnapshot !== null) {
    if (previousSnapshot.workspaceId !== currentResult.workspaceId) {
      throw new Error(
        `Cannot reconcile snapshots from different workspaces: current result has "${currentResult.workspaceId}", but previous snapshot has "${previousSnapshot.workspaceId}".`
      );
    }
  }

  // 2. Evaluate coverage sufficiency
  // Analysis is sufficient ONLY if result.complete is true AND no warning with affectsCompleteness is present
  const hasCriticalWarning =
    Array.isArray(currentResult.warnings) &&
    currentResult.warnings.some((w) => w.affectsCompleteness);
  const coverageSufficient = Boolean(currentResult.complete && !hasCriticalWarning);

  if (!coverageSufficient) {
    // PRESERVE PREVIOUS SNAPSHOT INTACT:
    // Do not construct a new snapshot, do not emit resolution events, do not overwrite history.
    return {
      workspaceId: currentResult.workspaceId,
      reconciledAt: currentResult.generatedAt,
      previousSnapshot,
      currentSnapshot: previousSnapshot,
      eventsEmitted: [],
      unchangedFindingCount: previousSnapshot?.findings ? previousSnapshot.findings.length : 0,
      coverageSufficient: false
    };
  }

  // 3. Index previous snapshot findings by stable FindingId
  const prevMap = new Map<FindingId, PersistedFindingRecord>();
  if (previousSnapshot?.findings) {
    for (const record of previousSnapshot.findings) {
      prevMap.set(record.id, record);
    }
  }

  // 4. Index current findings by stable FindingId with deterministic deduplication
  const currMap = new Map<FindingId, Finding>();
  if (Array.isArray(currentResult.findings)) {
    for (const finding of currentResult.findings) {
      if (!currMap.has(finding.id)) {
        currMap.set(finding.id, finding);
      }
    }
  }

  const newEvents: FindingLifecycleEvent[] = [];
  const persistedRecords: PersistedFindingRecord[] = [];
  let unchangedFindingCount = 0;

  // 5. Reconcile current findings
  for (const [id, currFinding] of currMap.entries()) {
    const prevRecord = prevMap.get(id);

    if (!prevRecord) {
      // Finding was not in previous snapshot
      // Evaluate against explicit historical evidence if provided in options
      const historyAssessment = assessFindingHistory(
        id,
        currentResult.workspaceId,
        currentResult.generatedAt,
        options?.historicalEvents
      );

      const event: FindingLifecycleEvent = {
        eventId: createLifecycleEventId(
          currentResult.workspaceId,
          currentResult.generation,
          id,
          historyAssessment.transition
        ),
        workspaceId: currentResult.workspaceId,
        findingId: id,
        transitionKind: historyAssessment.transition,
        observedAt: currentResult.generatedAt,
        triggerGeneration: currentResult.generation,
        previousState: historyAssessment.previousState,
        newState: currFinding.state === "suppressed" ? "suppressed" : "active",
        context: {
          newSeverity: currFinding.severity,
          newSummary: currFinding.summary,
          primaryLocation: currFinding.sourceLocations?.[0],
          reason: historyAssessment.reason
        }
      };
      newEvents.push(event);

      persistedRecords.push(
        toPersistedFindingRecord(
          currFinding,
          historyAssessment.firstObservedAt,
          currentResult.generatedAt
        )
      );
    } else if (prevRecord.state === "resolved") {
      // Finding was explicitly marked resolved in the prior record: reintroduced!
      const transition: FindingLifecycleTransition = "reintroduced";
      const event: FindingLifecycleEvent = {
        eventId: createLifecycleEventId(
          currentResult.workspaceId,
          currentResult.generation,
          id,
          transition
        ),
        workspaceId: currentResult.workspaceId,
        findingId: id,
        transitionKind: transition,
        observedAt: currentResult.generatedAt,
        triggerGeneration: currentResult.generation,
        previousState: "resolved",
        newState: currFinding.state === "suppressed" ? "suppressed" : "active",
        context: {
          newSeverity: currFinding.severity,
          newSummary: currFinding.summary,
          primaryLocation: currFinding.sourceLocations?.[0] ?? prevRecord.sourceLocations?.[0],
          reason: "Finding reintroduced after prior resolution"
        }
      };
      newEvents.push(event);

      persistedRecords.push(
        toPersistedFindingRecord(currFinding, prevRecord.firstObservedAt, currentResult.generatedAt)
      );
    } else {
      // Finding exists in both snapshots
      const diff = assessMaterialChange(prevRecord, currFinding);

      if (diff.isChanged) {
        const event: FindingLifecycleEvent = {
          eventId: createLifecycleEventId(
            currentResult.workspaceId,
            currentResult.generation,
            id,
            "changed"
          ),
          workspaceId: currentResult.workspaceId,
          findingId: id,
          transitionKind: "changed",
          observedAt: currentResult.generatedAt,
          triggerGeneration: currentResult.generation,
          previousState: prevRecord.state,
          newState: currFinding.state,
          context: {
            previousSeverity: prevRecord.severity,
            newSeverity: currFinding.severity,
            previousSummary: prevRecord.summary,
            newSummary: currFinding.summary,
            primaryLocation: currFinding.sourceLocations?.[0] ?? prevRecord.sourceLocations?.[0],
            reason: diff.reason
          }
        };
        newEvents.push(event);
      } else {
        // Materially identical finding: generate NO new lifecycle event
        unchangedFindingCount++;
      }

      // Preserve firstObservedAt and update lastConfirmedAt to current generation timestamp
      persistedRecords.push(
        toPersistedFindingRecord(currFinding, prevRecord.firstObservedAt, currentResult.generatedAt)
      );
    }
  }

  // 6. Reconcile resolved findings (findings present in previous snapshot, absent in current)
  const allowResolution = options?.allowResolutionOnlyIfCoverageComplete ?? true;

  if (allowResolution) {
    for (const [id, prevRecord] of prevMap.entries()) {
      if (!currMap.has(id)) {
        // Suppressed findings must NOT be silently treated as resolved
        if (prevRecord.state === "suppressed") {
          continue;
        }

        // Already resolved findings generate no duplicate resolution events
        if (prevRecord.state === "resolved") {
          continue;
        }

        const event: FindingLifecycleEvent = {
          eventId: createLifecycleEventId(
            currentResult.workspaceId,
            currentResult.generation,
            id,
            "resolved"
          ),
          workspaceId: currentResult.workspaceId,
          findingId: id,
          transitionKind: "resolved",
          observedAt: currentResult.generatedAt,
          triggerGeneration: currentResult.generation,
          previousState: prevRecord.state,
          newState: "resolved",
          context: {
            previousSeverity: prevRecord.severity,
            previousSummary: prevRecord.summary,
            primaryLocation: prevRecord.sourceLocations?.[0],
            reason: "Absent from completed analysis"
          }
        };
        newEvents.push(event);
      }
    }
  }

  // 7. Deterministic ordering:
  // Sort snapshot findings by findingId ascending
  persistedRecords.sort((a, b) => a.id.localeCompare(b.id));

  // Sort lifecycle events by findingId, then transitionKind
  newEvents.sort(
    (a, b) =>
      a.findingId.localeCompare(b.findingId) || a.transitionKind.localeCompare(b.transitionKind)
  );

  // 8. Assemble next AnalysisSnapshot
  const coverage: AnalysisCoverageSummary = {
    complete: true,
    filesScanned: currentResult.statistics?.filesConsidered ?? 0,
    filesWithWarnings: currentResult.statistics?.filesWithWarnings ?? 0,
    unresolvedPatterns: currentResult.statistics?.unresolvedPatterns ?? 0,
    warnings: Array.isArray(currentResult.warnings) ? [...currentResult.warnings] : []
  };

  const newSnapshot: AnalysisSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: createSnapshotId(
      currentResult.workspaceId,
      currentResult.generation,
      currentResult.generatedAt
    ),
    workspaceId: currentResult.workspaceId,
    generation: currentResult.generation,
    analyzedAt: currentResult.generatedAt,
    coverage,
    findings: persistedRecords
  };

  return {
    workspaceId: currentResult.workspaceId,
    reconciledAt: currentResult.generatedAt,
    previousSnapshot,
    currentSnapshot: newSnapshot,
    eventsEmitted: newEvents,
    unchangedFindingCount,
    coverageSufficient: true
  };
}

/**
 * StateReconciler class implementing the StateReconciliationPort.
 */
export class StateReconciler implements StateReconciliationPort {
  public readonly id = "core.state-reconciler";

  public reconcile(
    currentResult: AnalysisResult,
    previousSnapshot: AnalysisSnapshot | undefined,
    options?: StateReconciliationOptions
  ): ReconciliationResult {
    return reconcileState(currentResult, previousSnapshot, options);
  }
}
