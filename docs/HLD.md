# UNDRIFT — High-Level Design (HLD)

**Document:** `HLD.md`  
**Version:** 1.0-draft  
**Status:** Architecture review  
**Date:** 2026-10-09  
**Project:** UNDRIFT — personal developer-tool project  
**Primary interface:** VS Code extension  
**Architecture style:** Local-first extension with an editor-independent analysis core  
**Related documents:** `PRD.md`, `TRD.md`  
**Supersedes:** Earlier hackathon-oriented HLD assumptions

---

## 1. Purpose

This document describes UNDRIFT's high-level system architecture: the major components, their responsibilities, the flow of source evidence through the analysis pipeline, how findings reach the developer, and how accepted repairs are verified.

It intentionally defines logical responsibilities and interactions rather than final TypeScript interfaces, class layouts, algorithms, or UI implementation details. Those belong in the LLD, after the proof of concept validates the relevant boundaries.

UNDRIFT's core product loop is:

```text
DISCOVER → NORMALIZE → MATCH → DETECT → EXPLAIN
       → PROPOSE → REVIEW / APPLY → RE-ANALYZE → VERIFY
```

The initial release targets JavaScript/TypeScript frontend code—including JSX/TSX—with supported React/client patterns and Node.js/Express backend routes. The architecture is designed for future language and framework adapters, but adding a grammar alone does not make a language supported.

---

## 2. Architecture Goals

The design must:

1. Keep routine analysis local to the developer's workspace.
2. Separate the VS Code user interface from analysis and drift rules.
3. Use Tree-sitter as the shared syntax-parsing foundation.
4. Keep language-specific extraction and optional semantic resolution behind adapters.
5. Pass normalized evidence—not parser-specific nodes—into the language-neutral contract and drift engine.
6. Keep evidence, source locations, confidence, and analysis limitations attached to observations and findings.
7. Support explicit user review before source changes are applied.
8. Re-analyze current source after an edit before marking a finding as resolved.
9. Permit future CLI, Git, CI, and other editor consumers to reuse core behavior.
10. Avoid introducing a cloud backend, database, required LLM, or language server before demonstrated need.
11. Persist the latest complete analysis snapshot and finding lifecycle history across VS Code sessions in workspace-scoped extension storage, reconciling state reliably while separating current source authority from historical observations.

### 2.1 Non-goals of this HLD

This document does not define:

- every supported syntax pattern;
- final public/internal TypeScript types;
- final route-normalization or matching algorithms;
- a complete language-independent type system;
- exact severity/confidence thresholds;
- the final configuration schema;
- final VS Code visual design;
- performance claims that have not yet been benchmarked.

These details must be made explicit and testable in the LLD or technical proof of concept.

---

## 3. System Context

UNDRIFT sits between a developer's local source workspace and the VS Code experience used to inspect integration drift.

```text
┌──────────────────────────────┐
│          Developer           │
│ edits, inspects, accepts fix │
└──────────────┬───────────────┘
               │ VS Code interaction
┌──────────────▼───────────────┐
│      VS Code Extension       │
│ events, views, diagnostics,   │
│ commands, reviewed edits,    │
│ workspace storage persistence│
└──────┬───────────────┬───────┘
       │               │
       │ in-process    │ reads / writes (latest complete snapshot
       │ analysis API  │ & finding lifecycle history)
       │               ▼
       │      ┌─────────────────────────────────┐
       │      │ VS Code Workspace Storage       │
       │      │ (storageUri / workspaceState)   │
       │      └─────────────────────────────────┘
┌──────▼───────────────────────┐
│       UNDRIFT Core            │
│ parse coordination, evidence, │
│ matching, drift, fix plans,   │
│ state reconciliation engine   │
└──────────────┬───────────────┘
               │ local file/document access
┌──────────────▼───────────────┐
│      Open Workspace           │
│ frontend, backend, configs,   │
│ supported source files        │
└──────────────────────────────┘
```

The system does not execute the user's application to infer runtime behavior. Initial analysis is static. It does not upload source or derived contract data to a hosted service and does not require a network connection, model API key, account, or database to perform core analysis after the extension and parser assets are installed.

Analysis state and finding history are persisted locally within VS Code-managed, workspace-scoped storage: `ExtensionContext.storageUri` (workspace storage directory) is evaluated as the candidate location for structured analysis snapshots and finding lifecycle history files, while `ExtensionContext.workspaceState` (VS Code-managed workspace-scoped key-value persistence) is a possible mechanism for lightweight metadata. The exact division of storage responsibilities is provisional and subject to POC-F validation; duplicated metadata must never become an independent source of truth and must remain recoverable. Persistence does not write history into a `.undrift/` repository directory, does not require SQLite or an embedded database, and does not depend on remote persistence servers or cloud databases.

VS Code is the initial host and presentation layer. It must not own contract matching or drift classification; otherwise later CLI and CI workflows would need a second implementation.

---

## 4. Architectural Style and Deployment Shape

### 4.1 Initial deployment

The first version is a VS Code extension executing in the local/remote Node.js extension host, with an in-process TypeScript analysis core and workspace-scoped local persistence.

```text
VS Code Extension Host
┌───────────────────────────────────────────────────┐
│ VS Code Adapter                                   │
│  - activation, commands, workspace/document events│
│  - diagnostics, views, and report presentation    │
│  - reviewed WorkspaceEdit application             │
│  - persistent storage read/write coordination     │
│                                                   │
│ Analysis Orchestrator                             │
│  - revisions, debounce, cancellation              │
│  - coordinates parse/extract/match/reconcile      │
│                                                   │
│ State Persistence & Reconciliation Manager        │
│  - loads/saves latest complete analysis snapshot  │
│  - derives finding lifecycle history transitions  │
│  - enforces coverage sufficiency failure semantics│
│  - handles retention pruning & crash-safe writes  │
│                                                   │
│ Shared Analysis Core                              │
│  - normalized evidence and contracts              │
│  - matching and drift rules                       │
│  - explanation data and fix proposals             │
│                                                   │
│ Parser + Language/Framework Adapters              │
│  - Tree-sitter runtime and grammars               │
│  - JS/TS/JSX/TSX extraction                       │
│  - supported client and Express patterns          │
└──────────────┬──────────────────┬─────────────────┘
               │                  │                 │
               ▼                  ▼                 ▼
      Current editor buffers  Workspace files   VS Code Workspace Storage
                              and config        (snapshot & lifecycle history)
```

This diagram expresses logical components. They need not map one-to-one to independently published npm packages in the first implementation. Keep the codebase modular, but avoid unnecessary package and process boundaries before the product loop is proven.

### 4.2 In-process boundary

The extension invokes the core through an asynchronous, editor-independent interface. The core does not import the VS Code API. The core receives source text, workspace scope, configuration, and change/revision information; it returns observations, findings, explanations, warnings, reports, and fix proposals.

The initial architecture does not use Language Server Protocol (LSP), a local HTTP service, a database process, or a cloud API. These may be evaluated later based on evidence—such as a real requirement for other editor hosts or process isolation—not as prerequisites for the first release.

### 4.3 Future consumers

```text
                   ┌───────────────────────┐
                   │ Shared Analysis Core  │
                   └───────────┬───────────┘
                               │
                ┌──────────────┼─────────────────┐
                ▼              ▼                 ▼
         VS Code Extension  Future CLI     Future CI/Git
```

Future integrations should reuse analysis and finding semantics. They may provide different input adapters and output formatters, but must not fork the core drift rules.

---

## 5. Logical Component Architecture

### 5.1 VS Code adapter

**Responsibilities**

- activate the extension and register commands;
- detect workspace roots and supported documents;
- deliver open-document buffers and source changes to the analysis orchestrator;
- expose sidebar/tree, diagnostics, hover/detail views, status, report, and output logging;
- clearly distinguish in the UI between the **last known persisted state** (e.g., on session restore) and a **freshly verified analysis** of current source code;
- expose finding lifecycle history (transitions: detected, changed, resolved, reintroduced) with observation timestamps;
- coordinate workspace-scoped persistent storage reads and writes (`ExtensionContext.storageUri` directory candidate for structured snapshot/history files; `ExtensionContext.workspaceState` for key-value metadata);
- translate a selected fix proposal to a native VS Code workspace edit;
- ask for review/acceptance and report the resulting analysis state.

**Must not**

- parse raw code independently of the core pipeline;
- implement duplicate route matching or drift rules;
- treat successful file writing as proof that a mismatch is resolved;
- write history to the user repository (e.g. `.undrift/` directory);
- silently apply source edits.

### 5.2 Analysis orchestrator

This component coordinates the phases and controls lifecycle behavior.

**Responsibilities**

- receive initial-workspace and changed-file analysis requests;
- debounce bursts of edits;
- assign analysis revision/generation identifiers;
- cancel or supersede obsolete work when practical;
- ensure current editor buffers take priority over stale disk contents;
- coordinate parsing, extraction, normalization, matching, drift detection, explanation, report construction, state reconciliation, and result delivery;
- coordinate with the State Persistence & Reconciliation Manager to reconcile completed analyses against the previous complete snapshot;
- prevent stale results from replacing results for a newer workspace state;
- enforce failure semantics: an incomplete, interrupted, or failed analysis must never overwrite a valid persisted complete snapshot or emit false resolution events;
- provide a safe fallback to scoped or full re-analysis when incremental dependencies are uncertain.

The orchestrator is not responsible for deciding whether a particular field mismatch is a defect. Those decisions belong to normalized rule logic in the core.

### 5.3 Workspace and source provider

This logical service describes the analysis scope and provides file contents.

**Responsibilities**

- identify the opened workspace/folders and supported source files;
- respect workspace exclusions and UNDRIFT configuration;
- omit dependency, vendor, build, and generated output from default scanning where appropriate;
- prefer in-memory text for open documents;
- track document versions or content hashes for caching and edit invalidation;
- safely scope file access to the workspace and extension-owned resources.

The provider should not execute project code or package scripts to discover routes.

### 5.4 Tree-sitter parser adapter

This component hides the concrete Tree-sitter binding and grammar lifecycle from the rest of UNDRIFT.

**Responsibilities**

- load the selected Tree-sitter runtime and pinned grammar assets;
- select the grammar based on file type;
- parse source into syntax trees;
- retain source ranges, node kinds, syntax errors, and incomplete-region information;
- expose the syntax information needed by extractors through an internal parser abstraction;
- support incremental edit parsing where the selected binding and lifecycle permit it.

The preferred binding candidate is `web-tree-sitter` with packaged WebAssembly grammars, subject to a technical proof of concept. The official Node.js binding remains an alternative behind the same boundary if WASM packaging or performance is unacceptable.

No domain module should depend directly on binding-specific parser objects. A parser or grammar error affecting one document should become a scoped analysis warning rather than crash the extension.

### 5.5 Language and framework extractors

Extractors recognize useful source constructs and convert them into observations.

Initial examples:

- JavaScript/TypeScript extractor: declarations, supported calls, inline object shapes, explicit types and supported local references;
- frontend client extractors: `fetch`, common Axios calls and other explicitly supported client patterns;
- Express route extractor: route registrations, HTTP methods, handlers, statically discoverable paths and supported response forms.

An extractor is responsible for documenting the patterns it supports and expressing uncertainty when a pattern cannot be resolved. Extractors do not make final cross-boundary drift decisions.

### 5.6 Optional semantic-resolution adapter

Tree-sitter provides syntax. Some useful cases may additionally require imported symbol resolution, aliases, inferred type information, helper-function relationships, or framework-specific semantic knowledge.

The architecture therefore permits optional semantic enrichment behind an adapter. For TypeScript, the TypeScript Compiler API or `ts-morph` can be evaluated as implementation options if tests show that syntax-based extraction and supported local resolution are insufficient.

This adapter is not a requirement for every language. It must return normalized evidence and provenance rather than leaking compiler-specific runtime objects into the core. Unknown or ambiguous references must remain unknown or ambiguous instead of being guessed.

### 5.7 Normalized evidence and contract model

This is the common exchange model between extractors and the language-neutral engine.

It records observations such as:

- consumer or provider role;
- HTTP method and normalized path where known;
- request and response shapes;
- field types, optionality and nullability where evidenced;
- source references and spans;
- evidence source/provenance;
- direct, resolved, inferred or unknown evidence class;
- unresolved references, parser warnings, and unsupported patterns.

The model must preserve the difference between a missing field, an optional field, a nullable value, an unknown type, and an unresolved type reference. It must not require the consumer to understand Tree-sitter nodes or the TypeScript type system.

### 5.8 Matching and drift engine

This language-neutral component compares normalized observations and classifies differences.

**Responsibilities**

- normalize supported protocol data;
- generate candidate consumer/provider relationships using evidence;
- compare requests and responses once a relationship is sufficiently supported;
- run deterministic compatibility rules;
- classify findings and their evidence strength;
- preserve expected/observed values and source references;
- distinguish confirmed supported incompatibility from uncertain/incomplete analysis.

Matching should be evidence-first. A similar route string alone is not sufficient to conclude that two endpoints are related. Low-confidence candidates should be qualified or left unresolved rather than surfaced as certain defects.

### 5.9 Explanation and repair-proposal engine

This component converts a rule result into developer-facing explanation data and potential edits.

An explanation should state the observed conflict, why the comparison was made, the expected and observed values, relevant source locations, possible impact, evidence limits, and uncertainty. It should distinguish what was directly observed from what is inferred.

Fix proposals are structured plans containing their rationale, affected files, edit intent/source ranges, assumptions, and risk. The core proposes; the VS Code adapter applies only after the developer reviews/accepts the change.

### 5.10 Report and result model

A report aggregates the current analysis generation into a consistent view for the extension.

It includes discovered contracts, findings, severity/evidence classes, analysis coverage and warnings, relevant source references, current resolution state, and summary counts. The report must distinguish:
- “no findings in completed supported analysis” from “no findings because analysis is incomplete or patterns were unsupported;”
- freshly verified current source results from restored last-known persisted snapshot state;
- finding lifecycle history transitions (`detected`, `changed`, `resolved`, `reintroduced`) and observation timestamps.

### 5.11 Configuration and suppression

A project configuration service will eventually provide validated project-level include/exclude rules, analyzer/rule selection, intentional mappings, and finding suppressions. V0 may keep this minimal.

Configuration must be versioned and readable, and warnings should identify invalid or unsupported entries. No universal source of truth should be assumed: a project can deliberately identify an authoritative contract artifact or side for selected relationships.

The final file name and schema are reserved for the LLD after the initial implementation needs are better understood.

### 5.12 State persistence and reconciliation manager

This logical component manages the lifecycle of persisted analysis state, session reconciliation, and history tracking.

**Responsibilities**

- **Workspace State Restoration:** On workspace open, retrieve the latest complete analysis snapshot and retained finding lifecycle history from VS Code workspace-scoped storage (`ExtensionContext.storageUri` directory or `ExtensionContext.workspaceState`).
- **Snapshot-to-Snapshot Reconciliation:** When a new analysis completes with sufficient coverage, reconcile its findings against the previous complete snapshot using stable finding identity.
- **Lifecycle Transition Derivation:** Derive meaningful finding lifecycle events:
  1. `detected`: finding observed for the first time in a completed analysis;
  2. `changed`: existing finding materially changes in nature, severity, or shape;
  3. `resolved`: previously known finding is absent from a sufficiently complete subsequent analysis of relevant scope;
  4. `reintroduced`: previously resolved finding is detected again.
- **Unchanged Finding Filtering:** A finding that remains materially unchanged generates no new lifecycle event.
- **Coverage-Gated Safety Semantics:** Enforce that only analyses with sufficient coverage may establish finding resolution or overwrite the latest complete snapshot. Incomplete, interrupted, or failed analyses preserve the previous snapshot intact and emit no false resolution/reintroduction events.
- **Crash-Safe Persistence:** Require crash-safe and recoverable storage writes so that interrupted writes cannot corrupt persisted state or leave snapshots and lifecycle events in contradictory states.
- **Configurable Retention Pruning:** Prune historical lifecycle events according to user configuration without destroying or degrading the current complete snapshot.
- **Workspace Isolation:** Ensure state is strictly partitioned by workspace identity, preventing data leakage across unrelated projects.
- **Schema Compatibility & Safe Recovery:** Check persisted schema versions and safely quarantine or reset invalid/incompatible data to a clean baseline without fabricating history.

---

## 6. Core Data Flow

```text
Workspace / active documents
           │
           ▼
  1. Scope and source snapshot
           │
           ▼
  2. Tree-sitter parse per file
           │
           ▼
  3. Language/framework extraction
           │
           ▼
  4. Optional supported reference/type resolution
           │
           ▼
  5. Normalized evidence collection
           │
           ▼
  6. Candidate consumer/provider matching
           │
           ▼
  7. Deterministic compatibility rules
           │
           ▼
  8. Findings + explanations + repair proposals
           │
           ▼
  9. State reconciliation against last complete snapshot
           │ (correlate stable IDs; derive lifecycle events:
           │  detected, changed, resolved, reintroduced)
           ▼
 10. Crash-safe persistence to VS Code workspace storage
           │ (latest complete snapshot & pruned lifecycle history)
           ▼
 11. Report / diagnostics / sidebar / hover
           (presenting fresh vs last-known state & lifecycle history)
```

### 6.1 Phase responsibilities

1. **Scope:** determine which source files are included and the exact content version to analyze.
2. **Parse:** produce per-file syntax trees and source spans.
3. **Extract:** recognize supported declarations/calls/routes and derive observations.
4. **Resolve:** enrich evidence where a deterministic supported resolver is available; retain unresolved information.
5. **Normalize:** map different syntax/framework representations to a common contract model.
6. **Match:** identify candidate connections between consumers and providers.
7. **Detect:** run compatibility rules on sufficiently supported relationships.
8. **Explain:** preserve the factual comparison, likely impact, evidence and limitations.
9. **Reconcile:** compare newly completed analysis findings with the previous complete snapshot using stable finding identity; derive lifecycle transitions (`detected`, `changed`, `resolved`, `reintroduced`); filter out unchanged findings.
10. **Persist:** write the updated complete snapshot and pruned lifecycle events to VS Code workspace storage using crash-safe writes.
11. **Present:** render findings, explanations, fresh vs. last-known status indicators, and lifecycle history in VS Code diagnostics, sidebar/tree, and report views.

Each phase should be independently testable and observable through trace/logging data appropriate for local debugging. No phase should quietly erase the fact that extraction was partial.

---

## 7. Important Runtime Flows

### 7.1 Workspace open and state restoration flow

When a workspace opens in VS Code, UNDRIFT executes an 8-step lifecycle flow:

```text
VS Code opens workspace
        │
        ▼
1. Open workspace-scoped persistent storage
   (storageUri directory / workspaceState)
        │
        ▼
2. Restore latest complete analysis snapshot and retained lifecycle history
        │
        ├── Persisted data found ──► Expose as "last known state" in UI
        │                            (labeled clearly; does not claim to reflect current code)
        │
        └── No history exists ─────► Treat as clean first-time workspace
        │
        ▼
3. Trigger fresh analysis against current workspace source code
        │
        ▼
4. Run core pipeline: parse → extract → normalize → match → detect → explain
        │
        ▼
5. Evaluate analysis coverage & completion
        │
        ├── Incomplete/Failed ─────► Preserve previous complete snapshot intact;
        │                            do not emit false resolution events;
        │                            display analysis attempt status
        │
        └── Sufficiently Complete ──► Proceed to reconciliation
        │
        ▼
6. Reconcile fresh analysis with previous complete snapshot
   (correlate findings via stable ID; derive detected, changed, resolved, reintroduced)
        │
        ▼
7. Persist updated complete snapshot and new lifecycle events using crash-safe writes
   (apply configurable retention pruning to historical events)
        │
        ▼
8. Present reconciled state in UI
   (update diagnostics, tree views, report; mark state as freshly verified)
```

If no persisted history exists, UNDRIFT initializes clean workspace state without fabricating prior runs or transitions.

### 7.2 Source edit during active session

```text
Document changes
      │
      ▼
Debounce + assign newer document/workspace revision
      │
      ▼
Cancel/supersede outdated analysis where practical
      │
      ▼
Invalidate prior observations for changed file
      │
      ▼
Reparse/re-extract changed file
      │
      ▼
Recompute affected relationships or run safe scoped scan
      │
      ▼
If analysis completes with sufficient coverage:
  - Reconcile against last successfully persisted complete snapshot
  - Record only meaningful lifecycle transitions (filter out unchanged findings)
  - Persist updated snapshot and new events crash-safely
  - Publish reconciled results to presentation layer
```

Analysis must not synchronously block normal editor input. Debouncing, cancellation, caching and incremental parsing should be measured. History events are generated only upon completed, sufficiently complete analyses—never for every intermediate keystroke or raw editor buffer state.

### 7.3 Inspect finding

1. The extension maps a diagnostic/tree selection to a stable finding identifier.
2. The report loads the finding's evidence, relevant source references, and lifecycle history.
3. It displays expected versus observed values, explanation confidence/limitations, and first-detected/last-confirmed timestamps.
4. It navigates to available consumer/provider spans.
5. The developer can inspect, dismiss/suppress, manually fix, or request a supported repair.

A finding should not promise a source link for a side that was not discovered.

### 7.4 Review and apply a fix

```text
Developer requests Quick Fix
             │
             ▼
Core returns structured proposal + assumptions
             │
             ▼
Extension checks relevant document versions/ranges
             │
             ├── stale ──► invalidate; ask for re-analysis
             │
             ▼
Show review/preview and require acceptance
             │
             ▼
Apply through VS Code WorkspaceEdit
             │
             ▼
Trigger analysis against current source
             │
             ▼
Verify finding state from new evidence
             │
             ▼
If verified resolved, emit 'resolved' lifecycle event and update snapshot
```

The extension must revalidate edit ranges and source versions immediately before applying. If the source has changed since the proposal was created, do not apply stale offsets. A successful `WorkspaceEdit` only proves that the edit was applied; it does not prove the API contract is compatible.

### 7.5 Re-analysis and verification

After an accepted edit, UNDRIFT re-analyzes the affected file/relationship. The finding becomes verified or disappears only if the current supported checks confirm the mismatch is resolved. If it remains, the extension should show the remaining discrepancy. If evidence becomes incomplete, it should show unresolved/incomplete analysis rather than report success, and the finding must not be marked as resolved.

### 7.6 Unsupported or ambiguous pattern

When a parser error, dynamic route, unresolved reference, configured client, or framework pattern prevents a reliable result:

- retain any valid facts that can still be extracted;
- attach an analysis warning and source location where possible;
- avoid converting missing evidence into proof of absence;
- report that coverage is incomplete for the affected relationship;
- continue analyzing other independent files;
- prevent incomplete coverage from triggering false finding resolution in state reconciliation.

### 7.7 No known consumer

A backend provider with no matched consumer should be labeled **“no known consumer in the analyzed scope.”** The architecture cannot prove that external services, runtime-generated clients, other repositories, or dynamic consumers do not exist. This finding should therefore not claim that the endpoint is globally unused.

### 7.8 Returning to workspace after multi-day gap

UNDRIFT does not run in the background while VS Code is closed. It cannot observe intermediate edits or commits made while it was inactive.

When the developer reopens the workspace days or weeks later:
1. UNDRIFT restores the last known complete snapshot and lifecycle history from VS Code workspace storage.
2. The UI initially indicates that the displayed findings represent the **last known state** from the previous session, displaying the date/time of that last analysis.
3. UNDRIFT initiates a fresh analysis of the current source code.
4. Upon analysis completion, UNDRIFT compares the new findings with the restored snapshot.
5. Differences are classified:
   - findings present before and now absent are confirmed `resolved`;
   - findings present before and altered are marked `changed`;
   - previously resolved findings that have reappeared are marked `reintroduced`;
   - new findings are marked `detected`.
6. **Timestamps represent the analysis observation/confirmation time**, not an invented estimate of when the developer made the source edit while VS Code was closed.
7. The presentation layer clearly presents the gap between completed analyses, enabling developers to understand what changed without fabricating an intermediate activity timeline.

### 7.9 Incomplete or failed analysis resilience

Analysis runs may be interrupted by user cancellation, subsequent typing, unhandled parser failures, or severe workspace syntax errors.

To protect state integrity:
- **Snapshot Preservation:** A failed, cancelled, or materially incomplete analysis must never overwrite the persisted latest complete snapshot. The last valid snapshot remains intact.
- **Suppression of False Resolutions:** Absence of a finding from an incomplete run is never proof of resolution. Resolution events are emitted only when the relevant analysis scope has verified sufficient coverage.
- **Distinction in Presentation:** The UI explicitly displays the status of the latest analysis attempt (e.g., "Analysis incomplete due to syntax error in file X") while maintaining access to the last known complete analysis results.

---

## 8. Source Evidence, Provenance and Position Mapping

Source evidence is a first-class part of the architecture rather than metadata added after matching.

Each observation/finding should retain enough provenance to answer:

- which source file and range contributed the fact;
- whether the value was literal, explicitly annotated, locally resolved, framework-derived, configured, or inferred;
- which relationship/matching rule connected the evidence;
- what is known and what remains unresolved;
- whether the source revision used for a proposal is still current.

Tree-sitter positions and offsets must be mapped carefully to VS Code document positions. Internal byte offsets may be needed by the parser, whereas VS Code positions use line and UTF-16 character units. A tested conversion layer must bridge them, including non-ASCII text and line-ending differences.

Finding identity should remain stable across re-analysis for unchanged issues as much as practical, without relying on array indexes or transient object identity. Source/rule-derived IDs and revision-aware fix proposals reduce unnecessary UI flicker and stale-edit risk.

---

## 9. State, Caching and Persistence

### 9.1 Five-tier state architecture

To ensure reliable state tracking across sessions without violating the primacy of the developer's code, UNDRIFT establishes a five-tier state model:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 1: Current Source Code (Authoritative Source of Truth)            │
│  - Editor buffers, workspace files, disk content                       │
│  - Always authoritative for current code state                         │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 2: In-Memory Working State (Ephemeral)                            │
│  - Active Tree-sitter parse trees, byte offset tables, active buffers  │
│  - Discarded upon edit or session termination                          │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 3: Disposable Analysis Caches (Ephemeral Performance Layer)       │
│  - Parsed AST caches, normalized observation caches, match indexes     │
│  - Keyed by file content hashes and configuration versions             │
│  - Safely discardable and rebuildable at any time                      │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 4: Latest Complete Analysis Snapshot (Persisted Last Known State) │
│  - Persisted in VS Code workspace-scoped extension storage             │
│  - Represents the most recent successfully completed analysis          │
│  - Restored on session start as "last known state" until re-analyzed   │
│  - Never overwritten by incomplete, interrupted, or failed runs        │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 5: Finding Lifecycle History (Persisted Transition Log)           │
│  - Persisted in VS Code workspace-scoped extension storage             │
│  - Records meaningful transitions: detected, changed, resolved,        │
│    reintroduced with observation/confirmation timestamps               │
│  - Unchanged findings produce no new events                            │
│  - Pruned by configurable retention independently of Tier 4 snapshot   │
└────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Cache boundaries vs. persistent history

The architecture strictly distinguishes disposable performance caches from user-meaningful finding history:
- **Cache Clearing:** Discards Tier 3 data (e.g., cached ASTs, extractor outputs). Clearing caches forces a clean re-scan and parse of the workspace from source code, but leaves Tier 4 (latest snapshot) and Tier 5 (finding lifecycle history) intact.
- **History Reset:** An independent user operation that clears Tier 5 lifecycle events and/or resets Tier 4 snapshot to a clean baseline. History reset never alters project source code or workspace configuration.
- **Retention Pruning:** Background pruning removes expired Tier 5 lifecycle events based on configured retention policies. Pruning operates strictly on historical event records and **must never delete or degrade the Tier 4 latest complete snapshot**, ensuring the current last-known state remains available regardless of event age.

### 9.3 Persistence architecture and storage mechanics

Persistent state is stored entirely using **VS Code-managed, workspace-scoped extension storage**:

1. **Workspace Isolation and Candidate API Allocation:**
   - `ExtensionContext.storageUri`: the workspace-specific storage directory on disk, evaluated as the candidate for structured JSON files containing the latest complete analysis snapshot (`AnalysisSnapshot`) and finding lifecycle history (`FindingLifecycleHistory`).
   - `ExtensionContext.workspaceState`: VS Code-managed workspace-scoped key-value persistence, evaluated as a possible mechanism for lightweight metadata, generation IDs, analysis timestamps, and fast lookup indexes.
   - All persisted snapshots and history records are partitioned strictly by workspace identity. Findings and history cannot leak between different repositories or editor windows.
   - **Provisional Allocation & Reconciliation:** The exact division of storage duties between `storageUri` and `workspaceState` is provisional and subject to POC-F validation. If both mechanisms are used, duplicated metadata in `workspaceState` must never become an independent source of truth and must remain recoverable or reconcilable from the primary persistent records.
2. **Crash-Safe and Recoverable Storage Writes:** Snapshot and lifecycle updates must satisfy crash-safe and recoverable persistence requirements. Writing to temporary storage followed by rename is a candidate pattern, but universal filesystem atomicity cannot be assumed across all extension-host environments; the write strategy will be validated in POC-F. If a crash or power failure occurs during writing, the previous valid state remains intact. Partial writes are never accepted.
3. **Schema Versioning and Safe Recovery:** Persisted data structures include explicit schema version headers. When reading persisted data on startup:
   - Valid data with matching schema versions is loaded;
   - Missing data initializes a clean first-time workspace state;
   - Corrupted, malformed, or incompatible data triggers safe quarantine/recovery: UNDRIFT logs a warning and falls back to a clean state baseline without fabricating history or accepting corrupted data.
4. **Storage Boundaries and Non-Goals:**
   - **No repository pollution:** Persistent state and history are never stored in a `.undrift/` directory within the user's project repository.
   - **No embedded database:** SQLite and other embedded database dependencies are excluded.
   - **No remote services:** No cloud database, UNDRIFT backend server, or telemetry synchronization is used.
   - **No source code duplication:** Complete copies of source files are not stored in history. Source references point to file paths and ranges from earlier analyses and may become stale as code changes.

---

## 10. Error Handling and Resilience

The extension should degrade by file or analysis phase rather than fail workspace-wide whenever possible.

| Failure | Expected behavior |
|---|---|
| Grammar asset missing/incompatible | Surface a clear warning for the affected language/extension; do not crash activation of unrelated functionality. |
| File contains syntax errors | Continue parsing supported portions; mark affected observations as potentially incomplete. |
| Unsupported pattern | Record warning/coverage limitation; do not invent a compatible provider or a mismatch. |
| Imported type cannot be resolved | Retain unresolved reference state and lower finding strength where appropriate. |
| Invalid configuration | Report configuration location/error and use documented safe defaults where possible. |
| Analysis superseded by newer edits | Discard stale results and schedule or retain current generation. |
| Analysis cancelled, interrupted, or incomplete | Preserve previous complete snapshot intact; suppress false finding resolution and reintroduction events; report analysis attempt status. |
| Persisted storage corrupted or incompatible schema | Log warning; quarantine/reset invalid data safely without fabricating history; establish clean baseline via fresh analysis. |
| Storage write failure during reconciliation | Abort write safely; preserve previous valid snapshot and event history; surface local storage warning. |
| Fix proposal is stale | Refuse to apply it and require updated analysis. |
| One extractor throws unexpectedly | Log the failure, isolate it, and continue with other files/extractors when safe. |
| Analysis cancelled/disposed | Clean up parser/tree resources where required and avoid publishing partial stale results as complete analysis. |

An Output Channel or structured local logging mechanism should expose actionable debugging information without dumping full source code unnecessarily.

---

## 11. Performance and Resource Strategy

Performance targets are provisional until benchmarks exist.

The high-level strategy is:

- do an initial scoped analysis and favor correctness;
- debounce repeated document events;
- cancel or supersede obsolete work;
- reuse unchanged parse/extraction results when invalidation is correct;
- use incremental Tree-sitter parsing for updated documents if the selected binding supports it reliably;
- recompute only affected relationships when dependencies are known;
- fall back to a scoped/full scan when cross-file dependencies cannot be safely identified;
- expose analysis coverage/progress without flooding the UI;
- ensure normal typing remains responsive.

The proof of concept should measure cold-start cost, grammar load time, first useful result, parse/extraction/matching phases, single-file edit latency, large-file/workspace behavior, memory stability and final packaged size. Firm numeric service-level budgets should be set after measurement rather than invented in this HLD.

A separate worker or language-server process is not part of the first architecture. Add one only if profiling demonstrates an actual extension-host responsiveness or isolation problem.

---

## 12. Privacy and Security Boundaries

The first release is local-first.

- Source analysis runs in the local/remote VS Code extension host for the open workspace.
- Analysis state, snapshots, and finding lifecycle history are stored exclusively in VS Code-managed workspace storage on the developer's local machine (`ExtensionContext.storageUri` directory candidate for snapshot and history files; `ExtensionContext.workspaceState` for key-value metadata).
- No source code, contract evidence, analysis report, or finding history is uploaded to a hosted UNDRIFT service or remote database.
- Persistent state does not write into a `.undrift/` directory in the user's project repository.
- Entire source files are not duplicated into persistent storage; source references point to past file paths and line ranges and may become stale as the codebase evolves.
- No account, cloud backend, required telemetry, external LLM, or API key is needed.
- Static analysis must not execute project code or package scripts.
- File access must remain within the permitted workspace and extension-owned resources.
- Git is not a mandatory dependency and source-control analytics are not performed.
- Generated/dependency output is excluded by default where appropriate and should not be automatically edited.
- The extension must validate source ranges, document versions and workspace edits before applying a fix.
- Future remote/LLM capabilities, if considered, require explicit opt-in, disclosure of what data leaves the workspace, and an independent safety review.

The architecture must not rely on remote services for core correctness or routine supported detection.

---

## 13. Testing Architecture

Testing should mirror component boundaries and end-to-end user workflows.

### 13.1 Parser and extractor fixtures

Use labeled, minimal source fixtures for:

- direct supported fetch/Axios calls;
- supported Express app/router routes;
- simple mounted prefixes where implemented;
- inline request and response objects;
- explicit interfaces and aliases that are in the supported matrix;
- syntax errors/incomplete buffers;
- dynamic paths and unsupported client wrappers;
- Unicode text and position conversion.

### 13.2 Core rule fixtures

Include both valid and broken relationships. Test:

- exact match and compatible shapes;
- missing provider and no-known-consumer semantics;
- route and method mismatch;
- request and response field/type mismatch;
- optionality/nullability distinctions;
- intentional naming transformation or configured mapping;
- weak/ambiguous candidates;
- unresolved type evidence;
- findings disappearing or changing after repair.

Tests must avoid treating every difference as a defect.

### 13.3 VS Code integration tests

Use an extension-host test suite for:

- activation and command registration;
- workspace scan and result delivery;
- diagnostics and sidebar/report linkage;
- restoring latest complete analysis snapshot and history on workspace open;
- displaying last-known state vs. freshly verified analysis indicators;
- snapshot-to-snapshot reconciliation producing correct `detected`, `changed`, `resolved`, and `reintroduced` transitions;
- incomplete/interrupted analysis preserving snapshot and suppressing false resolution events;
- crash-safe persistence and recovery from corrupted storage;
- configurable retention pruning without destroying the current complete snapshot;
- clearing/updating findings after edits;
- rejecting stale analysis results;
- Quick Fix preview/acceptance and workspace edits;
- stale-proposal rejection;
- re-analysis and verification after applying a fix.

### 13.4 Acceptance evidence

A V0/V1 milestone is not complete merely because the extension compiles. The team should preserve test fixtures and benchmark results that demonstrate the full detect → explain → propose → review/apply → re-analyze → verify loop on the declared supported patterns.

---

## 14. Implementation Package Direction

The logical architecture can be implemented in a compact npm workspace:

```text
undrift/
├── apps/
│   └── vscode-extension/       # VS Code host adapter, persistence coordination, and UI
├── packages/
│   ├── core/                   # normalized model, matcher, drift, fixes, reconciliation, reporting
│   ├── parser-adapter/         # Tree-sitter binding and grammar lifecycle
│   └── analyzer-typescript/    # JS/TS/JSX/TSX extraction + Express patterns
├── tests/
│   ├── fixtures/
│   └── scenarios/
├── docs/
├── package.json
└── tsconfig.base.json
```

This is an initial logical organization, not a mandate to publish every package independently. The repository may keep the parser adapter and initial analyzer inside `packages/core` temporarily if boundaries are still clear. Split packages when it improves dependency control and independent testing, not solely to maximize folder count.

Potential future adapters can include Prisma, Fastify/NestJS, Python frameworks, and other sources such as OpenAPI. They should emit normalized observations and reuse the same analysis/report pipeline.

---

## 15. Architecture Decisions and Deferred Questions

### 15.1 Committed decisions

- VS Code-first local extension.
- TypeScript implementation.
- In-process asynchronous core for the initial release.
- Tree-sitter as the shared syntax parsing foundation.
- Language/framework adapters feeding a common normalized evidence model.
- Initial JavaScript/TypeScript/JSX/TSX frontend and Express backend vertical slice.
- Editor-independent matcher/drift rules and report semantics.
- Evidence/provenance and uncertainty retained through the pipeline.
- Native, reviewed workspace edits with stale-proposal validation.
- Re-analysis after fixes before claiming resolution.
- Persistence of latest complete analysis snapshot and finding lifecycle history in VS Code-managed, workspace-scoped extension storage (`ExtensionContext.storageUri` directory candidate for structured files; `ExtensionContext.workspaceState` for key-value metadata).
- Five-tier state model strictly separating current source code authority from persisted last-known snapshot, finding history, in-memory state, and disposable caches.
- Coverage-gated resolution semantics: incomplete or failed analyses never overwrite the latest complete snapshot or emit false resolution/reintroduction events.
- Crash-safe and recoverable writes for persistent state updates.
- Configurable retention for history events independent of the latest complete snapshot.
- Timestamps represent observation/confirmation times by analysis, not invented source-edit times.
- No required backend, database, LLM, API key, or cloud service.
- Future CLI/CI integrations must reuse the shared core.

### 15.2 Technical proof-of-concept gates

1. **Parser binding and grammar packaging:** validate `web-tree-sitter`/WASM against the official Node.js binding alternative.
2. **Semantic depth:** test direct route extraction, imported types, helper-hidden response shapes, dynamic routes, and source positions; decide whether an optional TypeScript semantic adapter is needed for useful initial coverage.
3. **Incremental behavior:** establish what the chosen binding supports and measure whether per-edit incremental parsing provides meaningful benefit.
4. **Route matching:** validate normalization for the supported route and mounted-prefix patterns to avoid unsafe fuzzy matching.
5. **Repair scope:** select a small class of deterministic fixes and verify proposal invalidation and post-edit analysis.
6. **State persistence and reconciliation:** validate workspace-scoped storage serialization, snapshot restore on session open, and transition derivation across analyses.

### 15.3 Deferred architecture options & open decisions

- LSP or separate analysis process;
- worker threads;
- CLI, Git hooks, CI;
- Prisma and other framework/language adapters;
- OpenAPI/specification and generated SDK ingestion;
- runtime observations;
- SQLite, embedded, or remote databases (excluded from scope);
- storing history in `.undrift/` repository directory (excluded from scope);
- Git history integration as a mandatory dependency (excluded from scope);
- optional AI-assisted resolution;
- browser-host VS Code support;
- multi-repository and team-level behavior.

**Open implementation decisions (intentionally unresolved in this design):**
1. *Storage API allocation and division of responsibilities:* Exact division of responsibilities between `ExtensionContext.storageUri` (candidate for structured snapshot/history files) and `ExtensionContext.workspaceState` (key-value metadata/indexing), crash-safe write strategy, and low-level JSON serialization format (provisional in design; validated in POC-F).
2. *Retention settings schema and default limits:* Specific retention duration (e.g. days), event-count limits, and user-facing configuration schema.
3. *Stable finding identity algorithm details:* Exact canonical serialization format and cryptographic hashing function.
4. *Material change threshold criteria:* Exact degree of route, method, schema, or location delta that constitutes a `changed` finding versus an unchanged finding.
5. *Multi-root and unsaved workspace partitioning:* Low-level directory mapping when no workspace root folder is formally saved.

---

## 16. Delivery Sequence

### Phase 1 — Parser and packaging proof of concept
Load Tree-sitter and a TypeScript/TSX grammar inside a bundled extension artifact. Validate node/source positions, syntax-error behavior, asset packaging, and baseline parse performance.

**Exit criterion:** The packaged extension can reliably parse representative JS/TS/JSX/TSX files and report source ranges.

### Phase 2 — Extraction and normalized evidence
Extract a defined set of frontend consumers and Express providers. Capture method/path, supported request/response shapes, source evidence, provenance and unsupported-pattern warnings.

**Exit criterion:** Labeled fixtures produce predictable normalized observations.

### Phase 3 — Shared analysis core
Match consumers/providers, run deterministic compatibility rules, and emit stable findings/explanations without importing VS Code APIs.

**Exit criterion:** Valid, drifted and ambiguous scenarios produce distinct, tested outcomes.

### Phase 4 — VS Code integration, persistence, and state reconciliation
Add diagnostics, sidebar/report, commands, hover/details, status, and changed-document coordination. Integrate VS Code workspace storage to persist the latest complete analysis snapshot and finding lifecycle history. Implement the 8-step session restoration and reconciliation flow, ensuring incomplete analyses preserve the last known complete snapshot.

**Exit criterion:** Developers can inspect source-linked findings from the IDE, close and reopen VS Code while preserving finding history, and observe verified finding lifecycle transitions upon fresh re-analysis.

### Phase 5 — Repair and reverification
Implement a small safe fix class, review/acceptance flow, stale proposal checks, workspace edits, and re-analysis.

**Exit criterion:** At least one representative mismatch completes the entire loop and the result is verified from the updated source.

### Phase 6 — Prototype validation and scope decision
Run labeled fixture tests, benchmark performance, test a representative real project, and evaluate the prototype with developers. Use measured misses and false positives to determine whether to add semantic resolution or expand supported frameworks.

**Exit criterion:** The next engineering phase follows observed gaps rather than assumptions.

---

## 17. HLD Summary

UNDRIFT is a **local-first VS Code extension backed by an editor-independent, language-neutral analysis core**. Tree-sitter provides the common syntax foundation; language and framework adapters turn source into normalized evidence; matching and deterministic rules turn evidence into drift findings; explanations and repair proposals flow to VS Code for developer review; and current source is re-analyzed to verify resolution.

The architecture is designed to add language/framework support by adding compatible parsers and extractors while reusing the central contract, finding, report and repair workflow. It does not pretend that syntax parsing alone delivers semantic understanding, and it does not add TypeScript compiler coupling, LSP, cloud services, databases, Prisma, or AI requirements before the proof of concept demonstrates a need.

The primary success criterion is not the number of parsed files or warnings. It is a reliable, evidence-backed developer loop:

```text
DISCOVER → MATCH → DETECT → EXPLAIN
        → REVIEW/APPLY → RE-ANALYZE → VERIFY
```

---

## 18. Reference Documentation

Re-check upstream documentation when pinning runtime and grammar versions:

- Tree-sitter documentation: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter WebAssembly binding: https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- TypeScript Tree-sitter grammars: https://github.com/tree-sitter/tree-sitter-typescript
- VS Code extension architecture: https://code.visualstudio.com/api/
- VS Code extension bundling: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- TypeScript Compiler API, for optional semantic analysis evaluation: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Vitest documentation: https://vitest.dev/guide/

---

**End of HLD — Version 1.0-draft**
