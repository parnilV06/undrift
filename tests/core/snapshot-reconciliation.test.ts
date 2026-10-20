import { describe, expect, it } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisWarning,
  Finding,
  FindingId,
  FindingLifecycleEvent,
  FindingSeverity,
  FindingState,
  PersistedFindingRecord,
  SourceSpan,
  WorkspaceId
} from "../../packages/core/src/index";
import {
  extractCoverageSummary,
  reconcileState,
  SNAPSHOT_SCHEMA_VERSION,
  StateReconciler,
  toPersistedFindingRecord
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.8: Snapshot Reconciliation & Finding Lifecycle", () => {
  const TEST_WORKSPACE_ID: WorkspaceId = "ws-test-snapshot-recon";

  function createSpan(uri: string, line = 10): SourceSpan {
    return {
      uri,
      range: { start: 100, end: 150 },
      start: { line, character: 1 },
      end: { line, character: 25 }
    };
  }

  function createFinding(overrides: Partial<Finding> = {}): Finding {
    const id = overrides.id ?? ("find:UND100:test-hash" as FindingId);
    return {
      id,
      ruleId: overrides.ruleId ?? "UND100",
      category: overrides.category ?? "existence",
      severity: overrides.severity ?? "warning",
      state: overrides.state ?? "active",
      title: overrides.title ?? "Missing provider",
      summary: overrides.summary ?? "No compatible provider found in scope.",
      explanation: overrides.explanation ?? "Detailed explanation.",
      evidenceStrength: overrides.evidenceStrength ?? "strong",
      observationIds: overrides.observationIds ?? ["obs-1"],
      sourceLocations: overrides.sourceLocations ?? [createSpan("file:///src/client.ts", 12)],
      limitations: overrides.limitations ?? [],
      fixProposalIds: overrides.fixProposalIds ?? [],
      expected: overrides.expected,
      observed: overrides.observed,
      ...overrides
    };
  }

  function createPersistedRecord(
    overrides: Partial<PersistedFindingRecord> = {}
  ): PersistedFindingRecord {
    const finding = createFinding(overrides);
    return toPersistedFindingRecord(
      finding,
      overrides.firstObservedAt ?? 1_000_000,
      overrides.lastConfirmedAt ?? 1_000_000
    );
  }

  function createCoverageSummary(
    overrides: Partial<AnalysisCoverageSummary> = {}
  ): AnalysisCoverageSummary {
    return {
      complete: overrides.complete ?? true,
      filesScanned: overrides.filesScanned ?? 5,
      filesWithWarnings: overrides.filesWithWarnings ?? 0,
      unresolvedPatterns: overrides.unresolvedPatterns ?? 0,
      warnings: overrides.warnings ?? []
    };
  }

  function createSnapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
    return {
      schemaVersion: overrides.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION,
      snapshotId: overrides.snapshotId ?? "snap:ws-test:1:abcd1234",
      workspaceId: overrides.workspaceId ?? TEST_WORKSPACE_ID,
      generation: overrides.generation ?? 1,
      analyzedAt: overrides.analyzedAt ?? 1_000_000,
      coverage: overrides.coverage ?? createCoverageSummary(),
      findings: overrides.findings ?? [],
      integrityHash: overrides.integrityHash
    };
  }

  function createResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
    return {
      workspaceId: overrides.workspaceId ?? TEST_WORKSPACE_ID,
      generation: overrides.generation ?? 2,
      generatedAt: overrides.generatedAt ?? 2_000_000,
      complete: overrides.complete ?? true,
      observations: overrides.observations ?? [],
      relationships: overrides.relationships ?? [],
      findings: overrides.findings ?? [],
      warnings: overrides.warnings ?? [],
      statistics: overrides.statistics ?? {
        filesConsidered: 5,
        filesParsed: 5,
        filesWithWarnings: 0,
        consumerObservations: 1,
        providerObservations: 1,
        relationships: 1,
        activeFindings: overrides.findings ? overrides.findings.length : 0,
        unresolvedPatterns: 0,
        durationMs: 15
      }
    };
  }

  // 1. Complete first analysis with findings
  it("Scenario 1: complete first analysis with findings constructs snapshot and emits detected events", () => {
    const finding1 = createFinding({ id: "find:UND100:abc" as FindingId, severity: "warning" });
    const finding2 = createFinding({
      id: "find:UND120:def" as FindingId,
      ruleId: "UND120",
      category: "route",
      severity: "error"
    });
    const result = createResult({
      findings: [finding1, finding2],
      generatedAt: 2_000_000,
      generation: 1
    });

    const reconciliation = reconcileState(result, undefined);

    expect(reconciliation.coverageSufficient).toBe(true);
    expect(reconciliation.previousSnapshot).toBeUndefined();
    expect(reconciliation.currentSnapshot).toBeDefined();
    expect(reconciliation.currentSnapshot?.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(reconciliation.currentSnapshot?.workspaceId).toBe(TEST_WORKSPACE_ID);
    expect(reconciliation.currentSnapshot?.generation).toBe(1);
    expect(reconciliation.currentSnapshot?.analyzedAt).toBe(2_000_000);
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(2);

    // Records have firstObservedAt and lastConfirmedAt initialized to result.generatedAt
    const rec1 = reconciliation.currentSnapshot?.findings.find((f) => f.id === finding1.id);
    expect(rec1?.firstObservedAt).toBe(2_000_000);
    expect(rec1?.lastConfirmedAt).toBe(2_000_000);

    // Events emitted: detected for each finding
    expect(reconciliation.eventsEmitted).toHaveLength(2);
    expect(reconciliation.eventsEmitted[0].transitionKind).toBe("detected");
    expect(reconciliation.eventsEmitted[0].previousState).toBeUndefined();
    expect(reconciliation.eventsEmitted[0].newState).toBe("active");
    expect(reconciliation.eventsEmitted[0].context?.primaryLocation).toBeDefined();
    expect(reconciliation.unchangedFindingCount).toBe(0);
  });

  // 2. Complete first analysis with no findings
  it("Scenario 2: complete first analysis with no findings constructs clean snapshot with zero events", () => {
    const result = createResult({ findings: [], generation: 1, generatedAt: 1_500_000 });

    const reconciliation = reconcileState(result, undefined);

    expect(reconciliation.coverageSufficient).toBe(true);
    expect(reconciliation.currentSnapshot).toBeDefined();
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(0);
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.unchangedFindingCount).toBe(0);
  });

  // 3. Matching, materially unchanged findings produce no new lifecycle event
  it("Scenario 3: materially unchanged findings produce no events and advance lastConfirmedAt", () => {
    const findingId = "find:UND100:stable" as FindingId;
    const priorRecord = createPersistedRecord({
      id: findingId,
      severity: "warning",
      category: "existence",
      firstObservedAt: 1_000_000,
      lastConfirmedAt: 1_000_000,
      summary: "Prior wording of summary."
    });
    const priorSnapshot = createSnapshot({
      generation: 1,
      analyzedAt: 1_000_000,
      findings: [priorRecord]
    });

    // Current run finds the same finding; summary phrasing differs slightly but severity/facts unchanged
    const currentFinding = createFinding({
      id: findingId,
      severity: "warning",
      category: "existence",
      summary: "Updated wording of summary." // wording change is NOT material
    });
    const result = createResult({
      generation: 2,
      generatedAt: 2_000_000,
      findings: [currentFinding]
    });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(true);
    expect(reconciliation.eventsEmitted).toHaveLength(0); // NO EVENT EMITTED
    expect(reconciliation.unchangedFindingCount).toBe(1);

    const updatedRecord = reconciliation.currentSnapshot?.findings[0];
    expect(updatedRecord?.firstObservedAt).toBe(1_000_000); // Preserved
    expect(updatedRecord?.lastConfirmedAt).toBe(2_000_000); // Advanced
  });

  // 4. Changed severity or another clearly material finding fact produces an appropriate changed event
  it("Scenario 4: material difference in severity or contract schema emits changed event", () => {
    const findingId = "find:UND120:conflict" as FindingId;
    const priorRecord = createPersistedRecord({
      id: findingId,
      severity: "warning",
      expected: { method: "POST" },
      observed: { method: "GET" }
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Current finding escalated from warning to error
    const currentFinding = createFinding({
      id: findingId,
      severity: "error",
      expected: { method: "POST" },
      observed: { method: "GET" }
    });
    const result = createResult({ findings: [currentFinding], generatedAt: 2_000_000 });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.eventsEmitted).toHaveLength(1);
    const event = reconciliation.eventsEmitted[0];
    expect(event.transitionKind).toBe("changed");
    expect(event.findingId).toBe(findingId);
    expect(event.previousState).toBe("active");
    expect(event.newState).toBe("active");
    expect(event.context?.previousSeverity).toBe("warning");
    expect(event.context?.newSeverity).toBe("error");
    expect(event.context?.reason).toContain("Severity changed");
    expect(reconciliation.unchangedFindingCount).toBe(0);
  });

  it("Scenario 4b: material difference in expected contract payload emits changed event", () => {
    const findingId = "find:UND200:shape" as FindingId;
    const priorRecord = createPersistedRecord({
      id: findingId,
      severity: "error",
      expected: { field: "name", type: "string" }
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    const currentFinding = createFinding({
      id: findingId,
      severity: "error",
      expected: { field: "username", type: "string" } // Field expectation changed
    });
    const result = createResult({ findings: [currentFinding] });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.eventsEmitted).toHaveLength(1);
    expect(reconciliation.eventsEmitted[0].transitionKind).toBe("changed");
    expect(reconciliation.eventsEmitted[0].context?.reason).toContain(
      "Expected contract shape or value changed"
    );
  });

  // 5. Resolved findings retain their prior location and evidence in lifecycle context when available
  it("Scenario 5: absent finding from complete analysis emits resolved event with prior context", () => {
    const findingId = "find:UND100:to-resolve" as FindingId;
    const priorLocation = createSpan("file:///src/routes/user.ts", 42);
    const priorRecord = createPersistedRecord({
      id: findingId,
      severity: "error",
      summary: "Provider was missing.",
      sourceLocations: [priorLocation]
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // New analysis is completely clean (finding resolved)
    const result = createResult({ findings: [], complete: true });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(true);
    expect(reconciliation.eventsEmitted).toHaveLength(1);
    const event = reconciliation.eventsEmitted[0];
    expect(event.transitionKind).toBe("resolved");
    expect(event.findingId).toBe(findingId);
    expect(event.previousState).toBe("active");
    expect(event.newState).toBe("resolved");
    expect(event.context?.primaryLocation?.uri).toBe("file:///src/routes/user.ts");
    expect(event.context?.primaryLocation?.start.line).toBe(42);
    expect(event.context?.previousSummary).toBe("Provider was missing.");
    expect(event.context?.reason).toBe("Absent from completed analysis");
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(0);
  });

  // 6. firstObservedAt remains unchanged for existing findings
  it("Scenario 6: firstObservedAt is strictly preserved across repeated analysis runs", () => {
    const findingId = "find:UND100:persist-time" as FindingId;
    const FIRST_TIME = 1_234_567;
    const priorRecord = createPersistedRecord({
      id: findingId,
      firstObservedAt: FIRST_TIME,
      lastConfirmedAt: 1_300_000
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    const currentFinding = createFinding({ id: findingId });
    const result = createResult({ findings: [currentFinding], generatedAt: 1_800_000 });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.currentSnapshot?.findings[0].firstObservedAt).toBe(FIRST_TIME);
    expect(reconciliation.currentSnapshot?.findings[0].lastConfirmedAt).toBe(1_800_000);
  });

  // 7. lastConfirmedAt advances only when a completed analysis confirms the finding
  it("Scenario 7: lastConfirmedAt advances on complete run but is preserved unchanged on incomplete run", () => {
    const findingId = "find:UND100:confirmed-time" as FindingId;
    const priorRecord = createPersistedRecord({
      id: findingId,
      firstObservedAt: 1_000_000,
      lastConfirmedAt: 1_100_000
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Incomplete run
    const incompleteResult = createResult({
      findings: [createFinding({ id: findingId })],
      complete: false,
      generatedAt: 1_500_000
    });
    const reconIncomplete = reconcileState(incompleteResult, priorSnapshot);
    expect(reconIncomplete.coverageSufficient).toBe(false);
    expect(reconIncomplete.currentSnapshot?.findings[0].lastConfirmedAt).toBe(1_100_000); // Unaltered

    // Complete run
    const completeResult = createResult({
      findings: [createFinding({ id: findingId })],
      complete: true,
      generatedAt: 1_900_000
    });
    const reconComplete = reconcileState(completeResult, priorSnapshot);
    expect(reconComplete.coverageSufficient).toBe(true);
    expect(reconComplete.currentSnapshot?.findings[0].lastConfirmedAt).toBe(1_900_000); // Advanced
  });

  // 8. Newly discovered findings are detected when no previous resolved state is known
  it("Scenario 8: newly discovered findings are detected alongside existing unchanged findings", () => {
    const existingId = "find:UND100:existing" as FindingId;
    const newId = "find:UND120:new" as FindingId;

    const priorSnapshot = createSnapshot({
      findings: [createPersistedRecord({ id: existingId })]
    });

    const result = createResult({
      findings: [createFinding({ id: existingId }), createFinding({ id: newId, ruleId: "UND120" })]
    });

    const reconciliation = reconcileState(result, priorSnapshot);

    expect(reconciliation.eventsEmitted).toHaveLength(1);
    expect(reconciliation.eventsEmitted[0].findingId).toBe(newId);
    expect(reconciliation.eventsEmitted[0].transitionKind).toBe("detected");
    expect(reconciliation.unchangedFindingCount).toBe(1);
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(2);
  });

  // 9. Deterministic output ordering and deduplication
  it("Scenario 9: findings are deduplicated by ID and sorted deterministically", () => {
    const idA = "find:UND100:aaa" as FindingId;
    const idB = "find:UND110:bbb" as FindingId;
    const idZ = "find:UND300:zzz" as FindingId;

    // Provide duplicate finding with idA and scrambled input order: idZ, idB, idA, duplicate idA
    const findingA1 = createFinding({ id: idA, summary: "Original A" });
    const findingA2 = createFinding({ id: idA, summary: "Duplicate A" });
    const findingB = createFinding({ id: idB, ruleId: "UND110" });
    const findingZ = createFinding({ id: idZ, ruleId: "UND300" });

    const result = createResult({
      findings: [findingZ, findingB, findingA1, findingA2]
    });

    const reconciliation = reconcileState(result, undefined);

    // Deduplication check: 3 distinct findings
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(3);
    // Deterministic sorting check: sorted alphabetically by ID
    const ids = reconciliation.currentSnapshot?.findings.map((f) => f.id);
    expect(ids).toEqual([idA, idB, idZ]);

    // Events emitted sorted deterministically by findingId
    const eventIds = reconciliation.eventsEmitted.map((e) => e.findingId);
    expect(eventIds).toEqual([idA, idB, idZ]);
  });

  // 10. Incomplete current analysis preserves the prior snapshot and emits no resolution events
  it("Scenario 10: incomplete current analysis preserves prior snapshot intact and emits no events", () => {
    const priorRecord = createPersistedRecord({ id: "find:UND100:must-survive" as FindingId });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Fresh run is incomplete and reports 0 findings
    const incompleteResult = createResult({
      complete: false,
      findings: []
    });

    const reconciliation = reconcileState(incompleteResult, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.eventsEmitted).toHaveLength(0); // NO FALSE RESOLUTION!
    expect(reconciliation.currentSnapshot).toBe(priorSnapshot); // Exactly identical
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(1);
    expect(reconciliation.unchangedFindingCount).toBe(1);
  });

  // 11. Incomplete analysis with no prior snapshot does not fabricate a completed snapshot
  it("Scenario 11: incomplete analysis with no prior snapshot produces undefined currentSnapshot", () => {
    const incompleteResult = createResult({
      complete: false,
      findings: [createFinding()]
    });

    const reconciliation = reconcileState(incompleteResult, undefined);

    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.previousSnapshot).toBeUndefined();
    expect(reconciliation.currentSnapshot).toBeUndefined(); // Does not fabricate dummy snapshot!
    expect(reconciliation.unchangedFindingCount).toBe(0);
  });

  // 12. Cancelled or failed analyses cannot cause false resolution
  it("Scenario 12: cancelled or failed analysis marked complete=false cannot cause false resolution", () => {
    const priorRecord = createPersistedRecord({ id: "find:UND100:cancelled-case" as FindingId });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    const cancelledResult = createResult({
      complete: false,
      findings: [],
      warnings: [
        {
          code: "ANALYZER_FAILURE",
          message: "Operation was aborted by user signal.",
          affectsCompleteness: true
        }
      ]
    });

    const reconciliation = reconcileState(cancelledResult, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.currentSnapshot).toBe(priorSnapshot);
  });

  // 13. Coverage-affecting warnings block resolution as specified by the documented warning contract
  it("Scenario 13a: warnings with affectsCompleteness=true block resolution", () => {
    const priorRecord = createPersistedRecord({ id: "find:UND100:warn-gated" as FindingId });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Result claims complete=true, but has a completeness-affecting warning
    const resultWithWarning = createResult({
      complete: true,
      findings: [],
      warnings: [
        {
          code: "INCOMPLETE_SCOPE",
          message: "Backend directory skipped due to parse limits.",
          affectsCompleteness: true
        }
      ]
    });

    const reconciliation = reconcileState(resultWithWarning, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(false);
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.currentSnapshot).toBe(priorSnapshot);
  });

  it("Scenario 13b: warnings with affectsCompleteness=false do NOT block resolution", () => {
    const priorRecord = createPersistedRecord({ id: "find:UND100:non-critical-warn" as FindingId });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Result has an informational warning that does not affect coverage completeness
    const resultWithInfo = createResult({
      complete: true,
      findings: [],
      warnings: [
        {
          code: "UNSUPPORTED_PATTERN",
          message: "Optional pattern not recognized but scope complete.",
          affectsCompleteness: false
        }
      ]
    });

    const reconciliation = reconcileState(resultWithInfo, priorSnapshot);

    expect(reconciliation.coverageSufficient).toBe(true);
    expect(reconciliation.eventsEmitted).toHaveLength(1);
    expect(reconciliation.eventsEmitted[0].transitionKind).toBe("resolved");
  });

  // 14. Suppressed findings are not silently treated as resolved
  it("Scenario 14: suppressed finding absent from scan is not silently treated as resolved", () => {
    const suppressedId = "find:UND100:suppressed-item" as FindingId;
    const priorRecord = createPersistedRecord({
      id: suppressedId,
      state: "suppressed"
    });
    const priorSnapshot = createSnapshot({ findings: [priorRecord] });

    // Finding is absent from current findings
    const result = createResult({ findings: [], complete: true });

    const reconciliation = reconcileState(result, priorSnapshot);

    // Suppressed finding MUST NOT emit 'resolved' event
    expect(reconciliation.eventsEmitted).toHaveLength(0);
    expect(reconciliation.currentSnapshot?.findings).toHaveLength(0);
  });

  it("Scenario 14b: current finding with suppressed state retains suppressed in snapshot and event", () => {
    const suppressedFinding = createFinding({
      id: "find:UND100:current-suppressed" as FindingId,
      state: "suppressed"
    });
    const result = createResult({ findings: [suppressedFinding], complete: true });

    const reconciliation = reconcileState(result, undefined);

    expect(reconciliation.eventsEmitted).toHaveLength(1);
    expect(reconciliation.eventsEmitted[0].newState).toBe("suppressed");
    expect(reconciliation.currentSnapshot?.findings[0].state).toBe("suppressed");
  });

  // 15. Workspace identity is preserved and inconsistent inputs are handled according to existing validation conventions
  it("Scenario 15: workspace identity mismatch between result and snapshot throws descriptive error", () => {
    const priorSnapshot = createSnapshot({ workspaceId: "ws-workspace-A" });
    const currentResult = createResult({ workspaceId: "ws-workspace-B" });

    expect(() => reconcileState(currentResult, priorSnapshot)).toThrow(
      /Cannot reconcile snapshots from different workspaces/
    );
  });

  it("Scenario 15b: missing or empty workspaceId throws descriptive error", () => {
    const invalidResult = createResult({ workspaceId: "" });
    expect(() => reconcileState(invalidResult, undefined)).toThrow(/workspaceId is required/);
  });

  // 16. Optional source locations, expected/observed values, and limitations are preserved without fabricated evidence
  it("Scenario 16: undefined optional values and empty collections are preserved without dummy values", () => {
    const minimalFinding = createFinding({
      sourceLocations: [],
      expected: undefined,
      observed: undefined,
      limitations: []
    });
    const result = createResult({ findings: [minimalFinding], complete: true });

    const reconciliation = reconcileState(result, undefined);
    const record = reconciliation.currentSnapshot?.findings[0];

    expect(record).toBeDefined();
    expect(record?.sourceLocations).toEqual([]);
    expect(record?.expected).toBeUndefined();
    expect(record?.observed).toBeUndefined();
    expect(record?.limitations).toEqual([]);
  });

  // 17. Contract Alignment: Gap A (Historical Evidence & Reintroduced) and Gap B (Incomplete Analysis)
  describe("Scenario 17: Contract Alignment for Lifecycle History & Snapshot Promotion", () => {
    it("Gap A: genuinely reintroduced finding emits reintroduced when historical evidence confirms prior resolution", () => {
      const findingId = "find:UND100:gapA-reintro" as FindingId;
      const originalObservedAt = 100_000;
      const resolvedAt = 200_000;

      // Historical lifecycle event log proving the finding was detected then resolved
      const historicalEvents: FindingLifecycleEvent[] = [
        {
          eventId: "evt:gen1:detect",
          workspaceId: TEST_WORKSPACE_ID,
          findingId,
          transitionKind: "detected",
          observedAt: originalObservedAt,
          triggerGeneration: 1,
          previousState: undefined,
          newState: "active"
        },
        {
          eventId: "evt:gen2:resolve",
          workspaceId: TEST_WORKSPACE_ID,
          findingId,
          transitionKind: "resolved",
          observedAt: resolvedAt,
          triggerGeneration: 2,
          previousState: "active",
          newState: "resolved"
        }
      ];

      // Current analysis re-detects the finding; previous snapshot did not contain it
      const currentFinding = createFinding({ id: findingId, state: "active" });
      const currentResult = createResult({
        generation: 3,
        generatedAt: 300_000,
        findings: [currentFinding],
        complete: true
      });
      const emptyPreviousSnapshot = createSnapshot({ findings: [] });

      const recon = reconcileState(currentResult, emptyPreviousSnapshot, { historicalEvents });

      expect(recon.coverageSufficient).toBe(true);
      expect(recon.eventsEmitted).toHaveLength(1);
      const event = recon.eventsEmitted[0];
      expect(event.findingId).toBe(findingId);
      expect(event.transitionKind).toBe("reintroduced");
      expect(event.previousState).toBe("resolved");
      expect(event.newState).toBe("active");

      // Verify that firstObservedAt was preserved from the earliest historical observation
      const persistedRecord = recon.currentSnapshot?.findings[0];
      expect(persistedRecord).toBeDefined();
      expect(persistedRecord?.firstObservedAt).toBe(originalObservedAt);
      expect(persistedRecord?.lastConfirmedAt).toBe(300_000);
    });

    it("Gap A: genuinely new finding with no prior history emits detected", () => {
      const findingId = "find:UND100:gapA-brand-new" as FindingId;
      const currentFinding = createFinding({ id: findingId, state: "active" });
      const currentResult = createResult({
        generation: 1,
        generatedAt: 100_000,
        findings: [currentFinding],
        complete: true
      });

      // Pass historical events belonging to a DIFFERENT finding
      const historicalEvents: FindingLifecycleEvent[] = [
        {
          eventId: "evt:other:1",
          workspaceId: TEST_WORKSPACE_ID,
          findingId: "find:UND120:other" as FindingId,
          transitionKind: "resolved",
          observedAt: 50_000,
          triggerGeneration: 1,
          previousState: "active",
          newState: "resolved"
        }
      ];

      const recon = reconcileState(currentResult, undefined, { historicalEvents });

      expect(recon.coverageSufficient).toBe(true);
      expect(recon.eventsEmitted).toHaveLength(1);
      expect(recon.eventsEmitted[0].findingId).toBe(findingId);
      expect(recon.eventsEmitted[0].transitionKind).toBe("detected");
      expect(recon.eventsEmitted[0].previousState).toBeUndefined();
      expect(recon.eventsEmitted[0].newState).toBe("active");
    });

    it("Gap A: contradictory or insufficient historical evidence safely emits detected without guessing", () => {
      const findingId = "find:UND100:gapA-ambiguous" as FindingId;
      const currentFinding = createFinding({ id: findingId, state: "active" });
      const currentResult = createResult({
        generation: 3,
        generatedAt: 300_000,
        findings: [currentFinding],
        complete: true
      });

      // Contradictory evidence: latest historical event says 'active', not 'resolved'
      const contradictoryHistory: FindingLifecycleEvent[] = [
        {
          eventId: "evt:gen1:detect",
          workspaceId: TEST_WORKSPACE_ID,
          findingId,
          transitionKind: "detected",
          observedAt: 100_000,
          triggerGeneration: 1,
          previousState: undefined,
          newState: "active"
        }
      ];

      const recon = reconcileState(currentResult, undefined, {
        historicalEvents: contradictoryHistory
      });

      // Must not guess resolution: falls back to 'detected'
      expect(recon.eventsEmitted).toHaveLength(1);
      expect(recon.eventsEmitted[0].transitionKind).toBe("detected");
      expect(recon.eventsEmitted[0].previousState).toBeUndefined();

      // Workspace mismatch: event belonging to a different workspace must be ignored
      const otherWorkspaceHistory: FindingLifecycleEvent[] = [
        {
          eventId: "evt:other-ws",
          workspaceId: "ws-different" as WorkspaceId,
          findingId,
          transitionKind: "resolved",
          observedAt: 100_000,
          triggerGeneration: 1,
          previousState: "active",
          newState: "resolved"
        }
      ];

      const reconOtherWs = reconcileState(currentResult, undefined, {
        historicalEvents: otherWorkspaceHistory
      });
      expect(reconOtherWs.eventsEmitted[0].transitionKind).toBe("detected");
    });

    it("Gap B: incomplete first analysis returns undefined currentSnapshot without fabricating a snapshot", () => {
      const incompleteFirstRun = createResult({
        complete: false,
        findings: [createFinding()]
      });

      const reconciliation = reconcileState(incompleteFirstRun, undefined);
      expect(reconciliation.coverageSufficient).toBe(false);
      expect(reconciliation.previousSnapshot).toBeUndefined();
      expect(reconciliation.currentSnapshot).toBeUndefined();
      expect(reconciliation.eventsEmitted).toHaveLength(0);
    });

    it("Gap B: incomplete subsequent analysis preserves previous snapshot intact and suppresses false resolution", () => {
      const priorSnapshot = createSnapshot({
        findings: [createPersistedRecord({ id: "find:prior" as FindingId })]
      });

      const incompleteSecondRun = createResult({
        complete: false,
        findings: [] // Finding absent because scan was incomplete!
      });

      const reconciliation = reconcileState(incompleteSecondRun, priorSnapshot);
      expect(reconciliation.coverageSufficient).toBe(false);
      expect(reconciliation.previousSnapshot).toBe(priorSnapshot);
      expect(reconciliation.currentSnapshot).toBe(priorSnapshot); // Intact, not modified
      expect(reconciliation.eventsEmitted).toHaveLength(0); // ZERO false resolution events
    });
  });

  // Verify StateReconciler class conforms to StateReconciliationPort
  it("StateReconciler class implements StateReconciliationPort correctly", () => {
    const reconciler = new StateReconciler();
    expect(reconciler.id).toBe("core.state-reconciler");

    const result = createResult({ findings: [], complete: true });
    const outcome = reconciler.reconcile(result, undefined);
    expect(outcome.coverageSufficient).toBe(true);
    expect(outcome.currentSnapshot).toBeDefined();
  });

  // Verify extractCoverageSummary helper
  it("extractCoverageSummary correctly reflects complete and warning-affected runs", () => {
    const cleanResult = createResult({ complete: true, warnings: [] });
    const cleanCoverage = extractCoverageSummary(cleanResult);
    expect(cleanCoverage.complete).toBe(true);
    expect(cleanCoverage.filesScanned).toBe(5);

    const warnedResult = createResult({
      complete: true,
      warnings: [{ code: "PARSE_ERROR", message: "fail", affectsCompleteness: true }]
    });
    const warnedCoverage = extractCoverageSummary(warnedResult);
    expect(warnedCoverage.complete).toBe(false);
  });
});
