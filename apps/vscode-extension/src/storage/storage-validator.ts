// Validation and schema enforcement for persisted snapshots and lifecycle events
// strictly adhering to LLD.md Sections 4.14–4.15, 14.10, 16.4, and 17.

import type {
  AnalysisCoverageSummary,
  AnalysisSnapshot,
  FindingLifecycleEvent,
  FindingLifecycleHistory,
  FindingLifecycleState,
  FindingLifecycleTransition,
  PersistedFindingRecord,
  WorkspaceId
} from "@undrift/core";
import { LIFECYCLE_HISTORY_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION } from "@undrift/core";
import { CorruptedRecordError, WorkspaceMismatchError } from "./errors";

const VALID_TRANSITION_KINDS: ReadonlySet<FindingLifecycleTransition> = new Set([
  "detected",
  "changed",
  "resolved",
  "reintroduced"
]);

const VALID_LIFECYCLE_STATES: ReadonlySet<FindingLifecycleState> = new Set([
  "active",
  "resolved",
  "suppressed"
]);

const VALID_FINDING_CATEGORIES = new Set([
  "existence",
  "route",
  "request-shape",
  "response-shape",
  "type",
  "analysis-limit",
  "protocol",
  "shape",
  "limitation"
]);
const VALID_FINDING_SEVERITIES = new Set(["error", "warning", "info"]);
const VALID_EVIDENCE_STRENGTHS = new Set([
  "direct",
  "resolved",
  "inferred",
  "unknown",
  "exact",
  "heuristic",
  "unresolved"
]);

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Validates that an error represents a file not found condition.
 */
export function isFileNotFound(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const e = err as { code?: string; name?: string; message?: string };
  if (e.code === "ENOENT" || e.code === "FileNotFound" || e.code === "EntryNotFound") {
    return true;
  }
  if (e.name === "FileNotFound" || e.name === "EntryNotFound") {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("not found") || msg.includes("filenotfound") || msg.includes("entrynotfound");
}

function validatePersistedFindingRecord(f: unknown, index: number): PersistedFindingRecord {
  if (!isObject(f)) {
    throw new CorruptedRecordError(`Finding at index ${index} is not an object.`);
  }

  if (typeof f.id !== "string" || f.id.trim() === "") {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'id'.`);
  }
  if (typeof f.ruleId !== "string" || f.ruleId.trim() === "") {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'ruleId'.`);
  }
  if (typeof f.category !== "string" || !VALID_FINDING_CATEGORIES.has(f.category)) {
    throw new CorruptedRecordError(
      `Finding at index ${index} has invalid 'category': ${String(f.category)}.`
    );
  }
  if (typeof f.severity !== "string" || !VALID_FINDING_SEVERITIES.has(f.severity)) {
    throw new CorruptedRecordError(
      `Finding at index ${index} has invalid 'severity': ${String(f.severity)}.`
    );
  }
  if (
    typeof f.state !== "string" ||
    !VALID_LIFECYCLE_STATES.has(f.state as FindingLifecycleState)
  ) {
    throw new CorruptedRecordError(
      `Finding at index ${index} has invalid 'state': ${String(f.state)}.`
    );
  }
  if (typeof f.title !== "string") {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'title'.`);
  }
  if (typeof f.summary !== "string") {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'summary'.`);
  }
  if (typeof f.evidenceStrength !== "string" || !VALID_EVIDENCE_STRENGTHS.has(f.evidenceStrength)) {
    throw new CorruptedRecordError(
      `Finding at index ${index} has invalid 'evidenceStrength': ${String(f.evidenceStrength)}.`
    );
  }
  if (!Array.isArray(f.sourceLocations)) {
    throw new CorruptedRecordError(`Finding at index ${index} missing 'sourceLocations' array.`);
  }
  if (!Array.isArray(f.limitations)) {
    throw new CorruptedRecordError(`Finding at index ${index} missing 'limitations' array.`);
  }
  if (typeof f.firstObservedAt !== "number" || isNaN(f.firstObservedAt)) {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'firstObservedAt'.`);
  }
  if (typeof f.lastConfirmedAt !== "number" || isNaN(f.lastConfirmedAt)) {
    throw new CorruptedRecordError(`Finding at index ${index} missing valid 'lastConfirmedAt'.`);
  }

  return f as unknown as PersistedFindingRecord;
}

function validateCoverageSummary(cov: unknown): AnalysisCoverageSummary {
  if (!isObject(cov)) {
    throw new CorruptedRecordError("Snapshot 'coverage' summary is missing or not an object.");
  }
  if (typeof cov.complete !== "boolean") {
    throw new CorruptedRecordError("Snapshot 'coverage.complete' must be a boolean.");
  }
  if (typeof cov.filesScanned !== "number" || cov.filesScanned < 0) {
    throw new CorruptedRecordError(
      "Snapshot 'coverage.filesScanned' must be a non-negative number."
    );
  }
  if (typeof cov.filesWithWarnings !== "number" || cov.filesWithWarnings < 0) {
    throw new CorruptedRecordError(
      "Snapshot 'coverage.filesWithWarnings' must be a non-negative number."
    );
  }
  if (typeof cov.unresolvedPatterns !== "number" || cov.unresolvedPatterns < 0) {
    throw new CorruptedRecordError(
      "Snapshot 'coverage.unresolvedPatterns' must be a non-negative number."
    );
  }
  if (!Array.isArray(cov.warnings)) {
    throw new CorruptedRecordError("Snapshot 'coverage.warnings' must be an array.");
  }
  return cov as unknown as AnalysisCoverageSummary;
}

/**
 * Validates that an unparsed or deserialized object matches the AnalysisSnapshot contract
 * and belongs to the specified workspaceId.
 */
export function validateSnapshot(raw: unknown, expectedWorkspaceId: WorkspaceId): AnalysisSnapshot {
  if (!isObject(raw)) {
    throw new CorruptedRecordError("Snapshot payload is not a valid JSON object.");
  }

  if (raw.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new CorruptedRecordError(
      `Unsupported snapshot schema version: ${String(raw.schemaVersion)} (expected ${SNAPSHOT_SCHEMA_VERSION}).`
    );
  }

  if (typeof raw.snapshotId !== "string" || raw.snapshotId.trim() === "") {
    throw new CorruptedRecordError("Snapshot payload missing valid 'snapshotId'.");
  }

  if (typeof raw.workspaceId !== "string" || raw.workspaceId.trim() === "") {
    throw new CorruptedRecordError("Snapshot payload missing valid 'workspaceId'.");
  }

  if (raw.workspaceId !== expectedWorkspaceId) {
    throw new WorkspaceMismatchError(
      `Snapshot workspaceId '${raw.workspaceId}' does not match expected workspace '${expectedWorkspaceId}'.`
    );
  }

  if (typeof raw.generation !== "number" || raw.generation < 0 || isNaN(raw.generation)) {
    throw new CorruptedRecordError("Snapshot payload has invalid 'generation'.");
  }

  if (typeof raw.analyzedAt !== "number" || raw.analyzedAt <= 0 || isNaN(raw.analyzedAt)) {
    throw new CorruptedRecordError("Snapshot payload has invalid 'analyzedAt' timestamp.");
  }

  const coverage = validateCoverageSummary(raw.coverage);

  if (!Array.isArray(raw.findings)) {
    throw new CorruptedRecordError("Snapshot payload 'findings' must be an array.");
  }

  const findings = raw.findings.map((f, i) => validatePersistedFindingRecord(f, i));

  return {
    schemaVersion: raw.schemaVersion,
    snapshotId: raw.snapshotId,
    workspaceId: raw.workspaceId,
    generation: raw.generation,
    analyzedAt: raw.analyzedAt,
    coverage,
    findings,
    integrityHash: typeof raw.integrityHash === "string" ? raw.integrityHash : undefined
  };
}

/**
 * Validates a single FindingLifecycleEvent record.
 */
export function validateLifecycleEvent(
  event: unknown,
  expectedWorkspaceId: WorkspaceId,
  index?: number
): FindingLifecycleEvent {
  const prefix = index !== undefined ? `Event at index ${index}` : "Lifecycle event";

  if (!isObject(event)) {
    throw new CorruptedRecordError(`${prefix} is not a valid object.`);
  }

  if (typeof event.eventId !== "string" || event.eventId.trim() === "") {
    throw new CorruptedRecordError(`${prefix} missing valid 'eventId'.`);
  }

  if (typeof event.workspaceId !== "string" || event.workspaceId.trim() === "") {
    throw new CorruptedRecordError(`${prefix} missing valid 'workspaceId'.`);
  }

  if (event.workspaceId !== expectedWorkspaceId) {
    throw new WorkspaceMismatchError(
      `${prefix} workspaceId '${event.workspaceId}' does not match expected '${expectedWorkspaceId}'.`
    );
  }

  if (typeof event.findingId !== "string" || event.findingId.trim() === "") {
    throw new CorruptedRecordError(`${prefix} missing valid 'findingId'.`);
  }

  if (
    typeof event.transitionKind !== "string" ||
    !VALID_TRANSITION_KINDS.has(event.transitionKind as FindingLifecycleTransition)
  ) {
    throw new CorruptedRecordError(
      `${prefix} has invalid 'transitionKind': ${String(event.transitionKind)}.`
    );
  }

  if (typeof event.observedAt !== "number" || event.observedAt <= 0 || isNaN(event.observedAt)) {
    throw new CorruptedRecordError(`${prefix} has invalid 'observedAt' timestamp.`);
  }

  if (
    typeof event.triggerGeneration !== "number" ||
    event.triggerGeneration < 0 ||
    isNaN(event.triggerGeneration)
  ) {
    throw new CorruptedRecordError(`${prefix} has invalid 'triggerGeneration'.`);
  }

  if (
    typeof event.newState !== "string" ||
    !VALID_LIFECYCLE_STATES.has(event.newState as FindingLifecycleState)
  ) {
    throw new CorruptedRecordError(`${prefix} has invalid 'newState': ${String(event.newState)}.`);
  }

  if (
    event.previousState !== undefined &&
    (!VALID_LIFECYCLE_STATES.has(event.previousState as FindingLifecycleState) ||
      typeof event.previousState !== "string")
  ) {
    throw new CorruptedRecordError(
      `${prefix} has invalid 'previousState': ${String(event.previousState)}.`
    );
  }

  if (event.context !== undefined && !isObject(event.context)) {
    throw new CorruptedRecordError(`${prefix} 'context' must be an object if present.`);
  }

  return event as unknown as FindingLifecycleEvent;
}

/**
 * Validates a full FindingLifecycleHistory payload.
 */
export function validateLifecycleHistory(
  raw: unknown,
  expectedWorkspaceId: WorkspaceId
): FindingLifecycleHistory {
  if (!isObject(raw)) {
    throw new CorruptedRecordError("Lifecycle history payload is not a valid JSON object.");
  }

  if (raw.schemaVersion !== LIFECYCLE_HISTORY_SCHEMA_VERSION) {
    throw new CorruptedRecordError(
      `Unsupported lifecycle history schema version: ${String(raw.schemaVersion)} (expected ${LIFECYCLE_HISTORY_SCHEMA_VERSION}).`
    );
  }

  if (typeof raw.workspaceId !== "string" || raw.workspaceId.trim() === "") {
    throw new CorruptedRecordError("Lifecycle history payload missing valid 'workspaceId'.");
  }

  if (raw.workspaceId !== expectedWorkspaceId) {
    throw new WorkspaceMismatchError(
      `Lifecycle history workspaceId '${raw.workspaceId}' does not match expected workspace '${expectedWorkspaceId}'.`
    );
  }

  if (!Array.isArray(raw.events)) {
    throw new CorruptedRecordError("Lifecycle history 'events' must be an array.");
  }

  const events = raw.events.map((e, i) => validateLifecycleEvent(e, expectedWorkspaceId, i));

  return {
    schemaVersion: raw.schemaVersion,
    workspaceId: raw.workspaceId,
    events
  };
}
