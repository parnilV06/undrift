# UNDRIFT — Low-Level Design (LLD)

**Document:** `LLD.md`  
**Version:** 1.0-draft  
**Status:** Implementation design for review  
**Date:** 2026-10-15  
**Project:** UNDRIFT — personal developer-tool project  
**Primary interface:** VS Code extension  
**Parser architecture:** Tree-sitter syntax layer + pluggable language/framework analyzers  
**Related documents:** `PRD.md`, `TRD.md`, `HLD.md`  
**Supersedes:** Earlier hackathon-oriented LLD and compiler-centric assumptions

---

## 1. Purpose

This document converts the current UNDRIFT PRD, TRD, and HLD into concrete implementation boundaries: package responsibilities, domain models, interfaces, analysis stages, matching/detection behavior, fix proposal semantics, extension responsibilities, error handling, and test requirements.

The central implementation loop is:

```text
SOURCE SNAPSHOT
      ↓
PARSE → EXTRACT → RESOLVE SUPPORTED REFERENCES
      ↓
NORMALIZE → MATCH → DETECT
      ↓
EXPLAIN → PROPOSE → REVIEW/APPLY
      ↓
RE-ANALYZE → VERIFY
```

The first vertical slice targets supported JavaScript/TypeScript frontend calls—including JSX/TSX projects—and Node.js/Express backend routes. The design keeps the analysis core independent of VS Code and of any individual programming-language compiler API.

This is a concrete implementation plan, not a claim that every difficult static-analysis case has been solved. In particular, the Tree-sitter binding, the amount of TypeScript semantic resolution required, and the achievable incremental-analysis performance remain proof-of-concept gates identified in the TRD.

### 1.1 Authority and alignment

- **PRD:** Product vision, user needs, first release boundaries, expected developer workflow, and product acceptance outcomes.
- **TRD:** Selected stack, technical constraints, architecture-level decisions, initial supported ecosystem, and proof-of-concept gates.
- **HLD:** Logical components, data flow, runtime flows, and component responsibilities.
- **LLD:** Concrete domain types, ports/interfaces, algorithms, state transitions, module organization, and test cases.

If an old scaffold or previous LLD conflicts with these documents, the current PRD/TRD/HLD sequence takes precedence. Do not carry forward the former compiler-first parsing design, hackathon-specific assumptions, or a CLI requirement merely because an earlier scaffold contained them.

### 1.2 Requirement language

**MUST** denotes a required behavior for the described implementation. **SHOULD** denotes a preferred behavior that may be adjusted with documented reasoning. **MAY** denotes an optional or later capability. Items marked **POC GATE** require evidence before they are finalized.

---

## 2. Low-Level Design Principles

1. **Language-neutral core:** contract types, matching, drift classification, explanation data, and fix proposal semantics must not depend on a Tree-sitter object, VS Code API, or TypeScript compiler type.
2. **Syntax is not semantics:** parsers provide structure and spans; extractors and optional resolvers determine what can be supported from that structure.
3. **Evidence travels with facts:** extracted values retain the source range, extraction method, evidence strength, and limitations that support them.
4. **Unknown is not false:** unresolved/dynamic values must not be treated as absent or incompatible by default.
5. **No false certainty from scope gaps:** a provider with no discovered consumer is “no known consumer in the analyzed scope,” not globally unused.
6. **Deterministic first:** common route and shape comparisons must not require an LLM, API key, network call, or external service.
7. **Editor-independent core:** VS Code adapts input/output but does not implement the drift rules.
8. **Reviewed edits only:** all source modifications go through the editor adapter after explicit user acceptance.
9. **Verification is analysis-based:** applying an edit is not evidence that a mismatch is repaired; current source must be analyzed again.
10. **Correctness before incremental cleverness:** use a scoped/full re-analysis whenever dependency invalidation cannot be proven correct.
11. **Add adapters, not engines:** language and framework support is added by producing the normalized evidence model and reusing the same matching/detection workflow.
12. **Keep storage local-first:** persist the latest complete analysis snapshot and finding lifecycle history in VS Code-managed workspace storage; no external database (no SQLite, no remote DB), no hosted backend, no required LLM, no repository `.undrift/` storage for history, and no mandatory Git dependency.
13. **Multi-tier state separation & coverage gating:** current source code is authoritative; snapshots represent the last known complete analyzed state; historical events log meaningful transitions at observation timestamps; incomplete or failed analyses never overwrite valid snapshots or emit false resolution events.

---

## 3. Proposed Repository Organization

The repository should use npm workspaces and a compact package layout. The exact source tree can be simplified during implementation, but the dependency direction below MUST be preserved.

```text
undrift/
├── apps/
│   └── vscode-extension/
│       ├── src/
│       │   ├── activation/
│       │   ├── commands/
│       │   ├── workspace/
│       │   ├── storage/          # VS Code workspace storage adapter (storageUri & workspaceState)
│       │   ├── analysis/
│       │   ├── diagnostics/
│       │   ├── providers/
│       │   ├── views/
│       │   ├── fixes/
│       │   ├── logging/
│       │   └── extension.ts
│       ├── media/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   ├── ports/
│   │   │   │   ├── parser.ts
│   │   │   │   ├── analyzer.ts
│   │   │   │   ├── resolver.ts
│   │   │   │   ├── engine.ts
│   │   │   │   ├── fixes.ts
│   │   │   │   └── persistence.ts # StateStoragePort & StateReconciliationPort
│   │   │   ├── config/
│   │   │   ├── pipeline/
│   │   │   ├── normalization/
│   │   │   ├── matching/
│   │   │   ├── rules/
│   │   │   ├── reconciliation/   # snapshot-to-snapshot reconciliation & lifecycle events
│   │   │   ├── explanations/
│   │   │   ├── fixes/
│   │   │   ├── reporting/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── parser-tree-sitter/
│   │   ├── src/
│   │   │   ├── runtime/
│   │   │   ├── grammar-registry/
│   │   │   ├── syntax-view/
│   │   │   ├── parser.ts
│   │   │   └── position-mapping.ts
│   │   └── package.json
│   └── analyzer-js-ts/
│       ├── src/
│       │   ├── registry/
│       │   ├── project-index/
│       │   ├── shared/
│       │   ├── frontend/
│       │   ├── backend/
│       │   ├── shapes/
│       │   ├── references/
│       │   └── support-matrix.ts
│       └── package.json
├── tests/
│   ├── fixtures/
│   ├── scenarios/
│   ├── golden/
│   └── extension-host/
├── examples/
│   └── api-drift-sample/
├── docs/
├── package.json
├── package-lock.json
└── tsconfig.base.json
```

### 3.1 Package responsibilities

| Package | Owns | Must not own |
|---|---|---|
| `apps/vscode-extension` | VS Code activation, workspace events, storage coordination (`storageUri` directory / `workspaceState` key-value), diagnostics, views, commands, accepted edits | Contract comparison rules, parser-specific extraction, or writing history to `.undrift/` repository directory |
| `packages/core` | Domain model, pipeline coordination contracts, normalization, matching, drift rules, state reconciliation, lifecycle transitions, explanations, fix proposals, reports | VS Code imports, Tree-sitter runtime objects, or external database drivers |
| `packages/parser-tree-sitter` | Tree-sitter binding and grammar lifecycle; syntax-node facade; source position conversion | API contract semantics or drift classification |
| `packages/analyzer-js-ts` | Supported JavaScript/TypeScript patterns; frontend and Express extraction; local reference/shape extraction | VS Code UI or independent duplicate drift engine |
| `tests` | Cross-package fixtures, golden outputs, end-to-end scenarios, persistence reconciliation suites | Production behavior not reachable through supported interfaces |

Package boundaries are logical boundaries first. It is acceptable to keep an analyzer inside the core package temporarily if dependency boundaries and tests stay clear. Do not split packages merely to maximize folder count.

### 3.2 Dependency direction

```text
apps/vscode-extension
       │ wires adapters, storage, and displays results
       ▼
packages/core ◄──────── packages/analyzer-js-ts
       ▲                           ▲
       │                           │ consumes SyntaxDocument facade
       │                           │
       └──── packages/parser-tree-sitter
                implements ParserPort
```

The intended compile-time dependency graph should avoid cycles. The core declares interfaces/ports. The parser package implements the parser port. The language analyzer implements the analyzer port and consumes the parser's binding-neutral syntax facade. The extension composes the concrete implementations and supplies workspace snapshots.

### 3.3 Workspace scripts

The repository should have predictable root scripts equivalent to:

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "typecheck": "tsc --build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:extension": "npm run test:extension --workspace apps/vscode-extension",
    "lint": "eslint .",
    "format:check": "prettier --check ."
  }
}
```

This is an illustrative script contract; exact workspace names and build commands must match the final `package.json` files. esbuild bundling MUST remain separate from TypeScript type-checking.

---

## 4. Shared Domain Model

All core contracts below are illustrative canonical types for the LLD. Implementations may refine field names before coding, but must preserve the semantics described here.

Domain interfaces MUST be serializable where practical, stable enough for tests, and free of binding-specific or editor-specific objects.

### 4.1 Primitive aliases

```ts
export type WorkspaceId = string;
export type DocumentUri = string;
export type ObservationId = string;
export type RelationshipId = string;
export type FindingId = string;
export type FixProposalId = string;
export type RuleId = string;

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";
```

Normalize HTTP methods to this uppercase set when the method is known. Unknown or unsupported method expressions remain unresolved evidence rather than being forced into the union.

### 4.2 Snapshot identity and source ranges

```ts
export interface TextRange {
  /** Absolute UTF-16 code-unit offsets into the exact source snapshot. */
  start: number;
  end: number;
}

export interface Position {
  /** Zero-based line number. */
  line: number;
  /** Zero-based UTF-16 character offset within the line. */
  character: number;
}

export interface SourceSpan {
  uri: DocumentUri;
  range: TextRange;
  start: Position;
  end: Position;
  /** Optional parser-native byte offsets for internal mapping/debugging. */
  byteRange?: { start: number; end: number };
}

export interface SourceSnapshotRef {
  uri: DocumentUri;
  contentHash: string;
  /** Present for editor buffers; absent for disk-only input. */
  documentVersion?: number;
}
```

Source positions MUST refer to the exact source snapshot that was parsed. The Tree-sitter layer may report byte offsets; a tested position-mapping layer converts these to UTF-16 offsets and line/character positions used by JavaScript strings and VS Code. Do not pass raw Tree-sitter byte offsets to `WorkspaceEdit` as though they were VS Code positions.

### 4.3 Provenance and evidence

```ts
export type EvidenceStrength =
  | "direct"
  | "resolved"
  | "inferred"
  | "unknown";

export type EvidenceSourceKind =
  | "literal-syntax"
  | "explicit-annotation"
  | "local-declaration"
  | "imported-declaration"
  | "framework-convention"
  | "project-configuration"
  | "semantic-adapter"
  | "heuristic";

export interface EvidenceRef {
  id: string;
  kind: EvidenceSourceKind;
  strength: EvidenceStrength;
  source: SourceSpan;
  description?: string;
}

export type ObservedValue<T> =
  | {
      state: "known";
      value: T;
      strength: Exclude<EvidenceStrength, "unknown">;
      evidence: EvidenceRef[];
    }
  | {
      state: "dynamic";
      expression?: string;
      reason: string;
      evidence: EvidenceRef[];
    }
  | {
      state: "unknown";
      reason: string;
      evidence: EvidenceRef[];
    };
```

The `ObservedValue<T>` union is used when knowledge state matters for a decision. It prevents the analyzer from confusing an unresolved path with a known missing path. It is not necessary to wrap every optional domain property: the wrapper is for a value that was sought but may be unknown or dynamic.

Evidence strengths are qualitative classes rather than claims of statistical probability:

- `direct`: value is visible in a literal or direct supported construct;
- `resolved`: value is obtained through a supported local/imported reference or deterministic framework rule;
- `inferred`: value or relationship depends on a conservative inference;
- `unknown`: represented as the state of an observation, never as proof that a value is absent.

### 4.4 Source document and analysis request

```ts
export interface SourceDocument {
  uri: DocumentUri;
  languageId: string;
  text: string;
  contentHash: string;
  documentVersion?: number;
  isDirty?: boolean;
}

export interface AnalysisRequest {
  workspaceId: WorkspaceId;
  workspaceRootUris: string[];
  generation: number;
  documents: SourceDocument[];
  config: ResolvedUndriftConfig;
  changedUris?: DocumentUri[];
  mode: "workspace" | "scoped";
}
```

The extension owns file discovery and workspace access. The core receives a finite snapshot of included documents, not VS Code's `WorkspaceFolder`, `TextDocument`, filesystem objects, or UI classes.

Open-document text takes precedence over disk content. The generation number is monotonic per workspace session and is used to prevent stale analysis output from replacing a newer state.

### 4.5 Route model

```ts
export type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "parameter"; name?: string }
  | { kind: "wildcard"; name?: string }
  | { kind: "unresolved"; sourceText: string };

export interface RoutePattern {
  segments: RouteSegment[];
  trailingSlash: "present" | "absent" | "unknown";
  queryHandling: "excluded-from-path" | "unknown";
  rawPath: string;
}
```

The route model intentionally distinguishes static segments from parameters/wildcards. Two routes may share a structural pattern even when local parameter variable names differ. The route matcher MUST NOT silently pluralize or singularize segments, remove meaningful prefixes, or equate unrelated paths through generic string similarity.

### 4.6 Type and shape model

```ts
export type PrimitiveTypeName =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "null"
  | "undefined"
  | "void"
  | "unknown"
  | "never";

export type TypeShape =
  | {
      kind: "primitive";
      name: PrimitiveTypeName;
    }
  | {
      kind: "literal";
      value: string | number | boolean | null;
    }
  | {
      kind: "array";
      element: TypeShape;
    }
  | {
      kind: "object";
      properties: FieldShape[];
      additionalProperties: "allowed" | "forbidden" | "unknown";
    }
  | {
      kind: "union";
      members: TypeShape[];
    }
  | {
      kind: "reference";
      displayName: string;
      resolution: "resolved" | "unresolved";
      targetId?: string;
      resolvedShape?: TypeShape;
    }
  | {
      kind: "unknown";
      reason:
        | "dynamic-expression"
        | "unsupported-syntax"
        | "unresolved-reference"
        | "incomplete-source"
        | "complex-type"
        | "not-observed";
    };

export interface FieldShape {
  name: string;
  type: TypeShape;
  presence: "required" | "optional" | "unknown";
  nullable: "yes" | "no" | "unknown";
  evidence: EvidenceRef[];
}

export interface ShapeObservation {
  shape: TypeShape;
  completeness: "complete" | "partial" | "unknown";
  evidence: EvidenceRef[];
}
```

Semantics that MUST remain distinct:

- a field not present in a **complete** observed shape;
- a field not present in a **partial** observed shape;
- a declared optional field;
- a field whose value may be null;
- an unknown type;
- an unresolved type reference;
- a known type that the current comparator does not support.

Do not replace all of these with `undefined`, an empty field list, or a guessed primitive. `additionalProperties: "unknown"` is not equivalent to `"forbidden"`.

### 4.7 Request and response observations

```ts
export interface RequestShapeObservation {
  pathParams?: ShapeObservation;
  queryParams?: ShapeObservation;
  headers?: ShapeObservation;
  body?: ShapeObservation;
}

export interface ResponseShapeObservation {
  statusCode?: ObservedValue<number>;
  body?: ShapeObservation;
  source: SourceSpan[];
}

export interface EndpointObservation {
  method: ObservedValue<HttpMethod>;
  path: ObservedValue<RoutePattern>;
  request?: RequestShapeObservation;
  responses?: ResponseShapeObservation[];
}
```

The initial slice may populate only a subset of request/response dimensions. Absence of an observation is not proof that the corresponding runtime behavior does not exist. The extractor must expose partiality through `ShapeObservation.completeness` and relevant analysis warnings.

### 4.8 API observations

```ts
export type ObservationRole = "consumer" | "provider";

export interface ApiObservation {
  id: ObservationId;
  role: ObservationRole;
  languageId: string;
  framework?: string;
  extractorId: string;
  source: SourceSpan[];
  snapshot: SourceSnapshotRef;
  endpoint: EndpointObservation;
  limitations: AnalysisWarning[];
}
```

A consumer represents an observed client call and its visible expectations/supplied values. A provider represents an observed server route and its visible accepted input/produced output. An observation is a local fact, not yet a confirmed consumer/provider relationship.

### 4.9 Contract relationship and status

```ts
export type RelationshipState =
  | "discovered"
  | "waiting"
  | "matched"
  | "verified"
  | "drifted"
  | "orphaned"
  | "unresolved"
  | "ignored";

export type MatchKind =
  | "exact"
  | "method-conflict"
  | "suspected-route-conflict"
  | "ambiguous"
  | "unmatched";

export interface ContractRelationship {
  id: RelationshipId;
  consumerId?: ObservationId;
  providerId?: ObservationId;
  state: RelationshipState;
  matchKind: MatchKind;
  evidence: EvidenceRef[];
  reasons: string[];
  limitations: AnalysisWarning[];
  findingIds: FindingId[];
}
```

`verified` means that the implemented supported checks found no unresolved mismatch for the relationship; it does not prove runtime behavior or unobserved contract dimensions. `orphaned` means a provider has no known consumer in the analyzed scope. The extension may show a transient “repair applied” event, but final state derives from a new analysis.

### 4.10 Findings

```ts
export type FindingSeverity = "error" | "warning" | "info";

export type FindingState =
  | "active"
  | "suppressed"
  | "resolved";

export interface Finding {
  id: FindingId;
  ruleId: RuleId;
  category:
    | "existence"
    | "route"
    | "request-shape"
    | "response-shape"
    | "type"
    | "analysis-limit";
  severity: FindingSeverity;
  state: FindingState;
  title: string;
  summary: string;
  explanation: string;
  evidenceStrength: EvidenceStrength;
  relationshipId?: RelationshipId;
  observationIds: ObservationId[];
  sourceLocations: SourceSpan[];
  expected?: unknown;
  observed?: unknown;
  impactStatement?: string;
  limitations: AnalysisWarning[];
  fixProposalIds: FixProposalId[];
}
```

Findings MUST include factual comparison data and preserve uncertainty. The `expected` and `observed` fields are display/report payloads, not an invitation for rule implementations to store arbitrary parser objects. Their values should be normalized serializable structures.

### 4.11 Analysis warnings

```ts
export type WarningCode =
  | "PARSE_ERROR"
  | "UNSUPPORTED_PATTERN"
  | "UNRESOLVED_REFERENCE"
  | "DYNAMIC_ROUTE"
  | "PARTIAL_SHAPE"
  | "INCOMPLETE_SCOPE"
  | "CONFIGURATION_ERROR"
  | "ANALYZER_FAILURE";

export interface AnalysisWarning {
  code: WarningCode;
  message: string;
  source?: SourceSpan;
  analyzerId?: string;
  affectsCompleteness: boolean;
}
```

Warnings indicate limits in the available analysis. They are not automatically drift findings and should not all become error-level diagnostics.

### 4.12 Fix proposal model

```ts
export type FixRisk = "mechanical" | "review-required" | "manual";

export interface ProposedTextEdit {
  uri: DocumentUri;
  range: TextRange;
  newText: string;
  expectedContentHash: string;
  expectedDocumentVersion?: number;
}

export interface FixProposal {
  id: FixProposalId;
  findingId: FindingId;
  title: string;
  rationale: string;
  risk: FixRisk;
  affectedUris: DocumentUri[];
  edits: ProposedTextEdit[];
  assumptions: string[];
  requiresTargetChoice: boolean;
  targetChoiceDescription?: string;
}
```

The core proposes structured edit intents. It MUST NOT write files. `mechanical` means the edit is deterministic given the stated assumptions, not that it may be applied silently. A finding where either side could be authoritative may need a target choice or manual resolution and should not receive a fabricated one-click fix.

### 4.13 Analysis result

```ts
export interface AnalysisStatistics {
  filesConsidered: number;
  filesParsed: number;
  filesWithWarnings: number;
  consumerObservations: number;
  providerObservations: number;
  relationships: number;
  activeFindings: number;
  unresolvedPatterns: number;
  durationMs: number;
}

export interface AnalysisResult {
  workspaceId: WorkspaceId;
  generation: number;
  generatedAt: number;
  complete: boolean;
  observations: ApiObservation[];
  relationships: ContractRelationship[];
  findings: Finding[];
  warnings: AnalysisWarning[];
  statistics: AnalysisStatistics;
}
```

The result has an explicit `complete` indicator because an empty findings array from incomplete analysis must not look equivalent to a clean, completed supported scan.

### 4.14 Persisted analysis snapshot

The snapshot records the last known successfully completed analysis state for a workspace. The types below define candidate conceptual shapes for persistent records and are subject to refinement during implementation. They do not replicate complete source code, which remains authoritative on disk/editor buffers.

```ts
export interface PersistedFindingRecord {
  id: FindingId;
  ruleId: RuleId;
  category: Finding["category"];
  severity: FindingSeverity;
  state: FindingState;
  title: string;
  summary: string;
  evidenceStrength: EvidenceStrength;
  relationshipId?: RelationshipId;
  sourceLocations: SourceSpan[];
  expected?: unknown;
  observed?: unknown;
  limitations: AnalysisWarning[];
  firstObservedAt: number;
  lastConfirmedAt: number;
}

export interface AnalysisCoverageSummary {
  complete: boolean;
  filesScanned: number;
  filesWithWarnings: number;
  unresolvedPatterns: number;
  warnings: AnalysisWarning[];
}

export interface AnalysisSnapshot {
  schemaVersion: number;
  snapshotId: string;
  workspaceId: WorkspaceId;
  generation: number;
  analyzedAt: number;
  coverage: AnalysisCoverageSummary;
  findings: readonly PersistedFindingRecord[];
  integrityHash?: string;
}
```

### 4.15 Finding lifecycle events

Lifecycle events log meaningful transitions between completed analyses. The types below define candidate conceptual event models. Intermediate typing or raw keystrokes do not generate events.

```ts
export type FindingLifecycleTransition =
  | "detected"
  | "changed"
  | "resolved"
  | "reintroduced";

export type FindingLifecycleState = "active" | "resolved" | "suppressed";

export interface FindingLifecycleContext {
  previousSeverity?: FindingSeverity;
  newSeverity?: FindingSeverity;
  previousSummary?: string;
  newSummary?: string;
  primaryLocation?: SourceSpan;
  reason?: string;
}

export interface FindingLifecycleEvent {
  eventId: string;
  workspaceId: WorkspaceId;
  findingId: FindingId;
  transitionKind: FindingLifecycleTransition;
  observedAt: number;
  triggerGeneration: number;
  previousState?: FindingLifecycleState;
  newState: FindingLifecycleState;
  context?: FindingLifecycleContext;
}

export interface FindingLifecycleHistory {
  schemaVersion: number;
  workspaceId: WorkspaceId;
  events: readonly FindingLifecycleEvent[];
}
```

### 4.16 State reconciliation model

```ts
export interface StateReconciliationOptions {
  allowResolutionOnlyIfCoverageComplete?: boolean;
  historicalEvents?: readonly FindingLifecycleEvent[];
}

export interface ReconciliationResult {
  workspaceId: WorkspaceId;
  reconciledAt: number;
  previousSnapshot?: AnalysisSnapshot;
  currentSnapshot?: AnalysisSnapshot;
  eventsEmitted: readonly FindingLifecycleEvent[];
  unchangedFindingCount: number;
  coverageSufficient: boolean;
}
```

`currentSnapshot` is optional (`AnalysisSnapshot | undefined`) because an incomplete first analysis yields no valid snapshot and must not manufacture a fake completed snapshot. `StateReconciliationOptions.historicalEvents` supplies explicit historical evidence so that the in-memory reconciler can identify `reintroduced` findings without performing file I/O or embedding storage adapters.

---

## 5. Core Ports and Interfaces

The core declares the interfaces that concrete parser, analyzer, workspace, or presentation adapters implement. Only the VS Code application layer may import VS Code-specific types.

### 5.1 Parser port

```ts
export interface ParseRequest {
  document: SourceDocument;
  previous?: ParsedDocument;
}

export interface ParsedDocument {
  source: SourceDocument;
  root: SyntaxNode;
  issues: ParseIssue[];
  dispose(): void;
}

export interface ParseIssue {
  message: string;
  source?: SourceSpan;
  isError: boolean;
}

export interface SyntaxNode {
  readonly kind: string;
  readonly range: TextRange;
  readonly byteRange?: { start: number; end: number };

  text(): string;
  children(): readonly SyntaxNode[];
  namedChildren(): readonly SyntaxNode[];
  childForField(name: string): SyntaxNode | undefined;
  parent(): SyntaxNode | undefined;
}

export interface ParserPort {
  readonly id: string;
  supports(languageId: string, uri: DocumentUri): boolean;
  parse(request: ParseRequest, signal?: AbortSignal): Promise<ParsedDocument>;
  dispose(): void;
}
```

`SyntaxNode` is an internal facade over concrete syntax. It must not expose the actual `web-tree-sitter` or Node-binding node type. The exact implementation may use a wrapper/handle rather than copying entire parse trees. `ParsedDocument.dispose()` releases parser/tree resources according to the selected binding's lifecycle.

### 5.2 Analyzer port

```ts
export interface AnalyzerInput {
  document: SourceDocument;
  parsed: ParsedDocument;
  projectIndex: ProjectIndexView;
  config: ResolvedUndriftConfig;
}

export interface AnalyzerOutput {
  observations: ApiObservation[];
  warnings: AnalysisWarning[];
}

export interface LanguageAnalyzerPort {
  readonly id: string;
  supports(languageId: string, uri: DocumentUri): boolean;
  analyze(input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput>;
}
```

An analyzer extracts supported observations from one document. It does not match consumers against providers and does not render diagnostics. If it cannot resolve a construct, it returns the evidence it has and an appropriate warning instead of silently inventing a value.

### 5.3 Semantic resolver port

```ts
export interface SemanticResolutionRequest {
  document: SourceDocument;
  referenceName: string;
  fromRange: TextRange;
  projectIndex: ProjectIndexView;
}

export type SemanticResolutionResult =
  | {
      state: "resolved";
      shape?: TypeShape;
      declaration?: SourceSpan;
      evidence: EvidenceRef[];
    }
  | {
      state: "ambiguous" | "unresolved" | "unsupported";
      reason: string;
      evidence: EvidenceRef[];
    };

export interface SemanticResolverPort {
  readonly id: string;
  resolveType(
    request: SemanticResolutionRequest,
    signal?: AbortSignal
  ): Promise<SemanticResolutionResult>;
}
```

This port is optional. A lightweight local declaration resolver can support straightforward references. A deeper TypeScript resolver may be implemented using the TypeScript Compiler API or `ts-morph` only if the proof of concept demonstrates that it is needed. The core must treat its output as evidence with provenance, not as a compiler-owned object.

### 5.4 Engine port

```ts
export interface AnalysisEnginePort {
  analyze(
    request: AnalysisRequest,
    signal?: AbortSignal
  ): Promise<AnalysisResult>;

  dispose(): Promise<void>;
}
```

The first implementation may analyze the supplied snapshot with a scoped/full pass. A later incremental implementation can reuse cached parse/extraction results, but the public result semantics must remain the same.

### 5.5 Fix generator port

```ts
export interface FixGeneratorPort {
  readonly id: string;
  supports(finding: Finding): boolean;
  propose(
    finding: Finding,
    context: FixGenerationContext
  ): Promise<FixProposal[]>;
}

export interface FixGenerationContext {
  documents: ReadonlyMap<DocumentUri, SourceDocument>;
  observations: ReadonlyMap<ObservationId, ApiObservation>;
  relationships: ReadonlyMap<RelationshipId, ContractRelationship>;
  config: ResolvedUndriftConfig;
}
```

Fix generators create proposals only. They must not mutate source or call VS Code APIs.

### 5.6 State persistence port

This port manages reading and writing the latest complete analysis snapshot and historical lifecycle events to workspace-scoped storage.

```ts
export interface HistoryFilter {
  findingId?: FindingId;
  transitionKind?: FindingLifecycleTransition;
  sinceTimestamp?: number;
  limit?: number;
}

export interface RetentionPolicy {
  retentionDays?: number;
  maxEventsPerWorkspace?: number;
}

export interface StatePersistencePort {
  readonly id: string;
  loadLatestSnapshot(workspaceId: WorkspaceId): Promise<AnalysisSnapshot | undefined>;
  saveSnapshot(workspaceId: WorkspaceId, snapshot: AnalysisSnapshot): Promise<void>;
  loadLifecycleHistory(workspaceId: WorkspaceId, filter?: HistoryFilter): Promise<readonly FindingLifecycleEvent[]>;
  appendLifecycleEvents(workspaceId: WorkspaceId, events: readonly FindingLifecycleEvent[]): Promise<void>;
  pruneLifecycleHistory(workspaceId: WorkspaceId, policy: RetentionPolicy): Promise<number>;
  clearCache(): Promise<void>;
  resetHistory(workspaceId: WorkspaceId): Promise<void>;
}
```

The port implementation in the VS Code host layer connects to VS Code-managed workspace storage: `ExtensionContext.storageUri` (workspace storage directory) is the candidate location for structured snapshot and lifecycle history files, coordinated with `ExtensionContext.workspaceState` (VS Code-managed workspace-scoped key-value persistence) as a possible mechanism for lightweight metadata. Duplicated metadata must never become an independent source of truth and must remain recoverable. It must not write history into the user's repository (`.undrift/`), must not use an embedded SQLite database, and must not connect to remote servers. The exact division of storage duties between `storageUri` and `workspaceState` is provisional and evaluated in POC-F.

### 5.7 State reconciliation port

This port compares a newly completed analysis with the previous complete snapshot to derive finding lifecycle transitions and update snapshot records. It is a pure, in-memory domain service; historical lifecycle events can be supplied via `options.historicalEvents` to identify `reintroduced` transitions without embedding persistence I/O into the core.

```ts
export interface StateReconciliationPort {
  readonly id: string;
  reconcile(
    currentResult: AnalysisResult,
    previousSnapshot: AnalysisSnapshot | undefined,
    options?: StateReconciliationOptions
  ): ReconciliationResult;
}
```

---

## 6. Parser and Position Mapping

### 6.1 Grammar selection

Initial file mapping:

| File extension / language | Grammar family | Initial scope |
|---|---|---|
| `.js`, `.mjs`, `.cjs` | JavaScript | Supported JS call/route patterns |
| `.jsx` | JavaScript grammar with JSX support | Supported client calls in JSX projects |
| `.ts` | TypeScript | Explicit declarations, calls, route handlers |
| `.tsx` | TypeScript TSX grammar | Supported source patterns within React/TSX files |

The mapping must be verified against the exact grammar packages and binding version selected by the POC. File extension alone does not imply every syntax pattern is supported.

### 6.2 Binding-neutral parser lifecycle

The parser package contains:

- `ParserRuntime`: initializes and owns the concrete Tree-sitter runtime;
- `GrammarRegistry`: maps supported language/file kinds to compatible grammar assets;
- `TreeSitterParserAdapter`: implements `ParserPort`;
- `SyntaxNodeFacade`: wraps binding-specific nodes;
- `PositionMapper`: maps byte offsets to UTF-16 offsets and line/character positions;
- `ParseIssueMapper`: converts parser errors/missing nodes into `ParseIssue`.

The runtime/binding must load lazily where appropriate so users who open an unsupported file do not pay the startup cost of every possible grammar.

**POC GATE:** Compare `web-tree-sitter` with packaged WASM grammars against the official Node.js binding for bundle packaging, version compatibility, startup, source spans, parser error recovery, and edit parsing. Concrete initialization calls remain implementation details until the binding is chosen.

### 6.3 Parsing incomplete documents

A document during typing may be syntactically invalid. The parser should return the available syntax tree and issues when supported by the runtime. Extractors must avoid interpreting malformed partial nodes as reliable completed calls/routes.

When a required parent or argument is missing, skip the observation or mark relevant values `dynamic`/`unknown`; attach a warning with the source range where possible.

### 6.4 Position mapping

Tree-sitter may represent ranges in UTF-8 bytes; JavaScript strings and VS Code positions use UTF-16 code units. `PositionMapper` must:

1. receive the exact `SourceDocument.text` snapshot;
2. map parser byte offsets to valid source string offsets;
3. map source offsets to zero-based `{ line, character }`;
4. handle CRLF and LF line endings;
5. handle Unicode characters outside the Basic Multilingual Plane;
6. clamp or reject invalid ranges instead of generating unsafe edits;
7. round-trip test ranges used in accepted fixes.

The implementation must not perform conversion by assuming one byte equals one character.

---

## 7. JavaScript/TypeScript Analyzer

### 7.1 Analyzer registry

The initial analyzer is registered for supported JavaScript and TypeScript file kinds. It coordinates sub-extractors and returns normalized observations plus warnings.

Proposed sub-extractors:

```text
JsTsAnalyzer
├── FrontendCallExtractorRegistry
│   ├── FetchExtractor
│   ├── AxiosMethodExtractor
│   └── ConfiguredClientExtractor (only implemented patterns)
├── ExpressRouteExtractor
├── RequestShapeExtractor
├── ResponseShapeExtractor
├── TypeShapeExtractor
├── LocalDeclarationIndex
└── UnsupportedPatternDetector
```

These may be separate classes or focused modules. They must share helpers for source ranges, literal extraction, call-chain inspection, evidence creation, and normalized shape construction.

### 7.2 Frontend call extraction

Initial target patterns include:

```ts
fetch("/api/users");

fetch("/api/users", {
  method: "POST",
  body: JSON.stringify(payload)
});

axios.get("/api/users");
axios.post("/api/users", payload);

api.get<User>("/api/users/:id");
```

These examples define intended supported shapes, not universal guarantees. Each pattern must have a matching fixture. Equivalent forms involving aliases, wrapper functions, custom client instances, or dynamic arguments are only supported after explicit implementation and testing.

`FetchExtractor` should:

1. identify a call expression whose callee resolves to the supported `fetch` identifier;
2. inspect the first argument for a string literal, supported template literal, or resolvable supported constant;
3. inspect the options argument for a literal HTTP method when present; default to GET only when the standard fetch semantics are clearly applicable;
4. inspect known body serialization forms where the argument shape can be safely recognized;
5. capture an explicit response type expectation only when visible from supported declarations/annotations;
6. preserve the call and argument source spans;
7. mark dynamic paths, methods, or payloads as unresolved and emit an appropriate warning.

`AxiosMethodExtractor` should recognize supported method-member calls and extract a path, method, and explicit body/response generic where available. Do not assume every identifier named `axios` or `api` is the library client. If import/alias evidence is not available, the configured/supported pattern must be explicit and confidence reduced appropriately.

### 7.3 Express route extraction

Initial examples:

```ts
app.get("/api/users", handler);
router.post("/api/users", handler);
app.patch("/api/users/:id", handler);
```

The extractor should:

1. identify a supported call expression for `app.<method>` or `router.<method>`;
2. check that the method is in the supported HTTP-method set;
3. extract a literal or deterministically resolved path;
4. retain the route registration and handler spans;
5. recognize supported chained response patterns such as `res.status(200).json(body)` or direct `res.json(body)` only when the chain is explicit;
6. infer a response shape from visible literals or supported response annotations;
7. inspect supported request schema/type declarations without claiming that Express's runtime body parser validates those types;
8. emit a warning for dynamic paths, unsupported router composition, unknown response branches, or unsupported response forms.

Router mount prefixes may be joined only when both mount path and nested route are statically supported and the implementation can prove the composition. Otherwise retain the raw route and mark the effective path unresolved.

### 7.4 Method and path extraction

Method extraction normalizes supported literal methods to uppercase. Non-literal method expressions remain unknown/dynamic.

Path extraction distinguishes:

- static paths;
- template literals with no dynamic substitutions;
- template literals where a whole segment is a supported dynamic parameter;
- mixed/dynamic expressions which cannot be normalized safely;
- configured base URL/path evidence where explicitly supported;
- unsupported path construction.

Do not convert arbitrary expressions into placeholder parameters. For example, a template literal whose interpolation is embedded inside a static segment should not be normalized as though it were a complete path parameter unless that case has a deliberately supported rule.

### 7.5 Shape extraction

`RequestShapeExtractor` initially supports explicitly visible object literals and narrowly defined serialization forms. `ResponseShapeExtractor` supports direct object literals and supported typed declarations that can be resolved safely.

When shapes are assembled from multiple conditional branches, helper calls, mapping functions, arrays, serializer middleware, or dynamic data, the analyzer must either implement that exact supported case and include tests, or mark the shape partial/unknown.

`TypeShapeExtractor` should support direct primitive annotations, arrays, object/interface declarations, type literals, literal types, unions of supported members, and straightforward local references as implemented. Complex mapped/conditional/generic types must be marked unsupported or unresolved rather than flattened incorrectly.

### 7.6 Local declaration index

`LocalDeclarationIndex` is a limited symbol index, not a replacement for a compiler type checker. It may index type aliases, interfaces, variable declarations, and import declarations needed by the supported patterns.

The initial implementation should resolve only cases whose correctness can be tested. Imported declarations, alias chains, re-exports and project path aliases are **POC GATE** cases. If they cannot be resolved deterministically, return an unresolved reference. Do not make TypeScript compiler support a dependency of the language-neutral core.

### 7.7 Support matrix

Every supported pattern must be documented in `support-matrix.ts` or an equivalent source of truth, with fields such as:

- `patternId`;
- source role (consumer/provider);
- supported language/framework;
- examples or fixture identifiers;
- fields reliably extracted;
- known limitations;
- whether evidence is direct/resolved;
- current test status.

UI/report text can use this metadata to explain why analysis might be incomplete. A documentation change and a fixture should accompany every claim that a new pattern is supported.

---

## 8. Analysis Pipeline

### 8.1 Engine orchestration

The core pipeline accepts one `AnalysisRequest` and returns one `AnalysisResult`. The engine is asynchronous and accepts an `AbortSignal` so superseded work can be cancelled where possible.

```text
AnalysisRequest
      │
      ▼
Validate request/config + select supported documents
      │
      ▼
Parse documents (ParserPort)
      │
      ▼
Build/update project index
      │
      ▼
Run matching language analyzers
      │
      ▼
Collect ApiObservation + warnings
      │
      ▼
Normalize route/shape representation
      │
      ▼
Generate candidate relationships
      │
      ▼
Classify relationships + run drift rules
      │
      ▼
Build explanation payloads + fix proposals
      │
      ▼
Calculate coverage/statistics + AnalysisResult
```

### 8.2 Pipeline interfaces

```ts
export interface AnalysisPipeline {
  run(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
}

export interface PipelineDependencies {
  parsers: readonly ParserPort[];
  analyzers: readonly LanguageAnalyzerPort[];
  matcher: ContractMatcher;
  ruleEngine: DriftRuleEngine;
  explainer: FindingExplainer;
  fixRegistry: FixGeneratorRegistry;
  reportBuilder: AnalysisReportBuilder;
}
```

The actual factory/composition mechanism is an application-level detail. The dependencies should be injected so the core can be tested with deterministic fake parsers/analyzers or real syntax fixtures without activating VS Code.

### 8.3 Per-document processing

For each included `SourceDocument`:

1. Find a parser that supports the document's language/file extension.
2. Parse the exact content snapshot and record parser issues.
3. Build/update the project index from supported declarations.
4. Run all applicable extractors for that document.
5. Validate observation IDs, source ranges, and source snapshot identity.
6. Collect observations and warnings.
7. Dispose temporary parse resources according to binding lifecycle.

Parser and analyzer errors should be isolated per document/extractor where safe. If a document cannot be parsed, other independent documents should still be analyzed. Mark the overall result incomplete if the failed document could affect coverage.

### 8.4 Workspace index

The initial project index needs only data required by supported analyzers:

- normalized document metadata and snapshot hashes;
- explicitly indexed local type/interface declarations;
- supported imports/references when resolved;
- route declarations and frontend observations;
- source spans for symbols and observations;
- dependency edges used by the limited resolver.

Do not construct an elaborate universal symbol graph before there is a consumer that needs it. The initial index is an in-memory analysis aid, not a database.

### 8.5 Cancellation and revisions

The extension increments a generation counter whenever a newer analysis state supersedes the previous one. The engine must check cancellation at safe phase boundaries and avoid expensive work when a signal is already aborted. The extension MUST publish a result only if its generation is still current.

Some Tree-sitter operations may not support interruption at every internal step. In that case, allow the current operation to complete safely but discard its stale output. Do not share or dispose a parse tree while an analysis task is still traversing it.

### 8.6 First implementation versus incremental analysis

The first correct implementation may parse the supplied workspace snapshot in a scoped/full scan. Live changes are debounced, and an obsolete result is ignored. Add caches and selective invalidation incrementally.

Do not claim dependency-aware incremental analysis until the implementation can identify which observations and relationships depend on a changed file. When an import, alias, router mount, or shared type may affect multiple files, use a safe broader scan if the dependency graph is not trustworthy.

### 8.7 State reconciliation and persistence stage

Once the engine finishes drift detection and builds findings, the analysis passes through the state reconciliation stage before results are published to the presentation layer.

```text
AnalysisResult (fresh run)
        │
        ▼
Evaluate coverage sufficiency (AnalysisResult.complete)
        │
        ├── Incomplete / Failed ──► Preserve previous snapshot intact;
        │                           suppress resolution / reintroduction events;
        │                           publish attempt report
        │
        └── Sufficiently Complete
                    │
                    ▼
          Load previous complete AnalysisSnapshot
                    │
                    ▼
          Correlate findings by stable FindingId
                    │
                    ├── Present in current, absent in previous snapshot:
                    │     ├── Previously resolved in history ──► emit 'reintroduced'
                    │     └── Never observed in history ───────► emit 'detected'
                    │
                    ├── Present in both current and previous snapshot:
                    │     ├── Material differences (severity/shape/route) ──► emit 'changed'
                    │     └── Materially identical ─────────────────────────► NO event (unchanged)
                    │
                    └── Present in previous snapshot, absent in current:
                          └── Coverage verified complete ───────────────────► emit 'resolved'
                    │
                    ▼
          Construct updated AnalysisSnapshot
                    │
                    ▼
          Atomic write to VS Code workspace storage (snapshot + new events)
                    │
                    ▼
          Execute retention pruning on historical events (snapshot preserved)
                    │
                    ▼
          Publish ReconciliationResult & updated report
```

#### Step-by-step reconciliation algorithm

```text
ALGORITHM reconcileState(currentResult, previousSnapshot, options):
  INPUT:
    currentResult: AnalysisResult
    previousSnapshot: AnalysisSnapshot or undefined
    options: StateReconciliationOptions (optional; contains allowResolutionOnlyIfCoverageComplete, historicalEvents)

  OUTPUT:
    ReconciliationResult

  1. CHECK COVERAGE SUFFICIENCY:
     IF NOT currentResult.complete OR currentResult.warnings.hasCriticalCoverageFailure():
       RETURN ReconciliationResult(
         workspaceId: currentResult.workspaceId,
         reconciledAt: currentResult.generatedAt,
         previousSnapshot: previousSnapshot,
         currentSnapshot: previousSnapshot, // PRESERVE UNCHANGED (undefined if first run was incomplete)
         eventsEmitted: [],
         unchangedFindingCount: previousSnapshot ? previousSnapshot.findings.length : 0,
         coverageSufficient: false
       )

  2. INDEX PREVIOUS AND CURRENT FINDINGS:
     prevMap = new Map<FindingId, PersistedFindingRecord>()
     IF previousSnapshot != null:
       FOR EACH f IN previousSnapshot.findings:
         prevMap.set(f.id, f)

     currMap = new Map<FindingId, Finding>()
     FOR EACH f IN currentResult.findings:
       currMap.set(f.id, f)

     newEvents = []
     persistedRecords = []

  3. RECONCILE CURRENT FINDINGS:
     FOR EACH (id, currFinding) IN currMap:
       prevRecord = prevMap.get(id)

       IF prevRecord == null:
         // Finding was not in previous snapshot
         // Assess historical evidence from options.historicalEvents if provided
         wasPreviouslyResolved = assessLatestResolvedState(id, currentResult.workspaceId, options?.historicalEvents)
         transition = wasPreviouslyResolved ? "reintroduced" : "detected"

         event = createLifecycleEvent(
           workspaceId: currentResult.workspaceId,
           findingId: id,
           transitionKind: transition,
           observedAt: currentResult.generatedAt,
           triggerGeneration: currentResult.generation,
           previousState: wasPreviouslyResolved ? "resolved" : undefined,
           newState: "active",
           context: extractContext(currFinding)
         )
         newEvents.append(event)

         firstObs = wasPreviouslyResolved ? getEarliestHistoricalTimestamp(id, options?.historicalEvents) : currentResult.generatedAt
         record = toPersistedFindingRecord(currFinding, firstObservedAt: firstObs, lastConfirmedAt: currentResult.generatedAt)
         persistedRecords.append(record)

       ELSE IF prevRecord.state == "resolved":
         // Finding was explicitly marked resolved in previous snapshot
         event = createLifecycleEvent(
           workspaceId: currentResult.workspaceId,
           findingId: id,
           transitionKind: "reintroduced",
           observedAt: currentResult.generatedAt,
           triggerGeneration: currentResult.generation,
           previousState: "resolved",
           newState: "active",
           context: extractContext(currFinding)
         )
         newEvents.append(event)
         record = toPersistedFindingRecord(currFinding, firstObservedAt: prevRecord.firstObservedAt, lastConfirmedAt: currentResult.generatedAt)
         persistedRecords.append(record)

       ELSE:
         // Finding exists in both snapshots
         IF isMateriallyChanged(prevRecord, currFinding):
           event = createLifecycleEvent(
             workspaceId: currentResult.workspaceId,
             findingId: id,
             transitionKind: "changed",
             observedAt: currentResult.generatedAt,
             triggerGeneration: currentResult.generation,
             previousState: prevRecord.state,
             newState: currFinding.state,
             context: extractDeltaContext(prevRecord, currFinding)
           )
           newEvents.append(event)
         ELSE:
           // UNCHANGED: generate NO new lifecycle event
           NO_OP()

         record = toPersistedFindingRecord(currFinding, firstObservedAt: prevRecord.firstObservedAt, lastConfirmedAt: currentResult.generatedAt)
         persistedRecords.append(record)

  4. RECONCILE RESOLVED FINDINGS:
     allowResolution = options?.allowResolutionOnlyIfCoverageComplete != false
     IF allowResolution:
       FOR EACH (id, prevRecord) IN prevMap:
         IF NOT currMap.has(id):
           // Finding was present before, now absent from a complete scan -> RESOLVED
           event = createLifecycleEvent(
             workspaceId: currentResult.workspaceId,
             findingId: id,
             transitionKind: "resolved",
             observedAt: currentResult.generatedAt,
             triggerGeneration: currentResult.generation,
             previousState: prevRecord.state,
             newState: "resolved",
             context: { primaryLocation: prevRecord.sourceLocations[0], reason: "Absent from completed analysis" }
           )
           newEvents.append(event)

  5. CONSTRUCT NEW SNAPSHOT:
     newSnapshot = AnalysisSnapshot(
       schemaVersion: SNAPSHOT_SCHEMA_VERSION,
       snapshotId: generateUUID(),
       workspaceId: currentResult.workspaceId,
       generation: currentResult.generation,
       analyzedAt: currentResult.generatedAt,
       coverage: extractCoverage(currentResult),
       findings: persistedRecords
     )

  6. RETURN RESULT:
     // Note: Caller/coordinator persists newSnapshot and appends newEvents via StatePersistencePort
     RETURN ReconciliationResult(
       workspaceId: currentResult.workspaceId,
       reconciledAt: currentResult.generatedAt,
       previousSnapshot: previousSnapshot,
       currentSnapshot: newSnapshot,
       eventsEmitted: newEvents,
       unchangedFindingCount: persistedRecords.length - newEvents.length,
       coverageSufficient: true
     )
```

---

## 9. Normalization

### 9.1 Route normalization

A `RouteNormalizer` converts supported route evidence to a comparable `RoutePattern`.

Initial rules:

1. Trim surrounding whitespace from known literal path strings.
2. If a fully literal absolute URL is supported, extract its pathname with a well-tested URL parser; preserve evidence for any configured base URL.
3. Exclude query strings from the route path only when they belong to a fully parsed URL and the query is separately represented or is intentionally out of scope.
4. Normalize path separators and leading slash consistently without removing meaningful segments.
5. Represent supported framework path parameters as parameter segments.
6. Preserve wildcard and unresolved segments explicitly.
7. Compose router mount prefixes only when the prefix and route are statically resolvable.
8. Keep trailing slash policy explicit; do not silently conflate variants until behavior is decided and tested.
9. Never singularize/pluralize, rename segments by heuristic, or discard version prefixes to improve a match.

### 9.2 HTTP method normalization

- Convert literal supported methods to uppercase.
- Use GET as a default for `fetch()` only when standard semantics are clearly represented and no unsupported override applies.
- Do not infer a method from a variable value or custom helper.
- Return an unresolved method observation for dynamic configuration.

### 9.3 Type and shape normalization

A `TypeNormalizer` canonicalizes known type forms while preserving uncertainty:

- string/number/boolean and other supported primitives;
- literal values;
- arrays and nested arrays;
- object fields and their presence/nullability;
- unions of supported types;
- references with resolution state;
- unknown/unsupported shapes.

The initial implementation should avoid type coercion assumptions. A number is not a string because JavaScript may coerce it at some runtime boundary. A field marked nullable is not equivalent to a field marked optional. A missing field is only evidence of incompatibility when the compared observation is complete enough for the rule.

### 9.4 Naming transformations

Do not automatically equate `user_name`, `userName`, and `display_name`. These may be connected by a mapper or serializer, but the transformation must be observed through a supported rule or explicitly configured. Where the mapping is unobserved, report the structural difference only when contract evidence is otherwise sufficient, and explain the possible transformation uncertainty.

---

## 10. Consumer/Provider Matching

### 10.1 Matching goals

Matching attempts to relate an observed consumer and provider without over-claiming that they implement the same logical endpoint. Candidate relationship generation is separate from compatibility checks.

### 10.2 Candidate stages

Use this order:

1. **Exact method + route shape:** same normalized method and structurally compatible route.
2. **Method conflict:** same unique route shape but incompatible known methods.
3. **Suspected route conflict:** same known method and highly constrained path difference with unique candidates.
4. **Unmatched:** no supported candidate relationship found.
5. **Ambiguous:** more than one plausible candidate or the evidence is not strong enough to choose.

### 10.3 Route-shape equality

Two paths have the same route shape if all static segments match and corresponding parameter/wildcard positions are structurally compatible under the supported route model. Parameter variable names alone should not create a route mismatch because names in the client and server source do not necessarily need to be identical. Query parameters and body schema are compared separately where supported.

### 10.4 Suspected route mismatch rule

To limit false positives, the initial suspected route mismatch heuristic should be conservative. A candidate can be classified as suspected route mismatch only when all of the following hold:

- consumer and provider have the same known HTTP method;
- both paths are known and contain no unresolved/wildcard segment that makes comparison unreliable;
- segment counts are equal;
- parameter positions are compatible;
- exactly one static segment differs;
- this provider is the unique candidate for the consumer under the rule, and the consumer is the unique candidate for the provider;
- the relationship does not conflict with a stronger exact candidate.

Even then, classify the relation as inferred/suspected, not an exact match. If any condition fails, retain an unmatched/ambiguous relationship and avoid producing a confident route-mismatch finding.

This rule is a starting constraint to evaluate against fixtures, not a claim that it detects every route drift.

### 10.5 Candidate conflicts and duplicate findings

If a consumer has a suspected route-mismatch candidate, do not simultaneously emit a high-confidence missing-provider finding for the same consumer unless the analysis clearly identifies separate problems. If a unique route shape has a method conflict, prefer the method-mismatch explanation rather than reporting the endpoint as simply missing.

One observation can participate in multiple relationships only when the evidence and product rules justify it. Avoid pairing a single consumer with every route that shares a static segment.

### 10.6 Missing provider semantics

A missing-provider finding is eligible only when:

- the consumer method/path is known at the required evidence level;
- the relevant analysis scope was sufficiently scanned;
- no exact compatible provider was found;
- no stronger method/route conflict already explains the discrepancy;
- analysis limitations are attached.

The text must say **“No compatible provider found in the analyzed scope”**, not “This endpoint does not exist.” If the scope has errors or unsupported backend patterns that could hide the provider, lower the certainty or show an incomplete-analysis message instead.

### 10.7 Provider with no known consumer

A provider is classified as orphaned/no-known-consumer only if no matched or supported suspected consumer is found within the analyzed workspace scope. The message must explicitly state that external consumers, dynamic callers, generated clients, or other repositories may exist.

---

## 11. Drift Rules

Rule IDs and titles must be stable across releases where their meaning remains the same. If rule semantics change materially, document the change and update tests.

### 11.1 Initial rule catalog

| Rule ID | Rule | Default severity | Initial evidence requirement |
|---|---|---|---|
| `UND100` | No compatible provider found | Warning | Known consumer route/method and sufficiently complete backend scan |
| `UND110` | Provider has no known consumer | Info | Known provider route/method and sufficiently complete consumer scan |
| `UND120` | HTTP method conflict | Error | Unique route-shape candidate with conflicting known methods |
| `UND130` | Suspected route mismatch | Warning | Conservative unique one-static-segment candidate rule |
| `UND200` | Required request field not supplied/observed | Error or warning by completeness | Provider requires field; consumer body shape sufficiently complete |
| `UND210` | Request field type mismatch | Error | Known incompatible consumer value and provider expectation |
| `UND220` | Request nullability/optionality conflict | Warning/Error based on direction | Both sides provide relevant known semantics |
| `UND300` | Provider response lacks expected field | Error | Provider response shape complete enough; consumer requires the field |
| `UND310` | Response field type mismatch | Error | Known incompatible provider output and consumer expectation |
| `UND320` | Response optionality conflict | Warning | Provider may omit field but consumer expects it reliably present |
| `UND330` | Response nullability conflict | Warning/Error based on direction | Provider may return null but consumer disallows it |
| `UND900` | Unsupported pattern limits analysis | Info/Warning | Extractor encounters an explicitly unsupported pattern |
| `UND910` | Type/reference unresolved | Info/Warning | A supported reference could not be resolved |
| `UND920` | Incomplete parse/scope affects coverage | Info/Warning | Parser or workspace-scan issue affects completeness |

The exact default severity may be adjusted by fixture evaluation, but a rule's evidence requirement and semantics must be explicit. Warning/info rules should not be upgraded solely to make the dashboard look more serious.

### 11.2 Request comparison direction

For requests, the consumer supplies values and the provider accepts/validates values.

- A provider-required field absent from a complete consumer payload shape can be reported.
- A provider's explicit non-null type conflicts with a consumer value that may be null if both are known.
- A supplied field not listed in a provider shape is only an error if the provider schema is known to reject additional fields. In typical Express handlers, an apparent request interface is not proof of runtime rejection. If additional-property behavior is unknown, do not report extra fields as a hard incompatibility.
- A field type comparison must be directional: compare the values the consumer may send against values the provider accepts.

### 11.3 Response comparison direction

For responses, the provider produces values and the consumer expects/uses values.

- A consumer-required field missing from a complete provider response observation can be reported.
- If the provider's actual observed type is wider than the consumer's expectation, report a possible incompatible value.
- If the provider can return null and the consumer type disallows null, report the incompatibility.
- A provider shape marked partial cannot prove that a field is never present; any omission finding must be qualified or withheld.
- A provider's extra field is not automatically a drift when the consumer ignores it.

### 11.4 Type compatibility algorithm

For the initial shape subset:

1. Treat identical supported primitive types as compatible.
2. Treat a literal as compatible with its corresponding primitive where that direction is valid (for example, literal `"ready"` can satisfy `string`).
3. Compare arrays recursively up to a configured maximum depth.
4. Compare object fields by name; evaluate required/optional and nullable states separately from the base type.
5. Compare unions conservatively. If the rule cannot establish compatibility for all relevant members, report unresolved/unsupported rather than guessing.
6. Resolve supported references before comparison; unresolved references are not treated as mismatching names by default.
7. Track visited reference pairs to avoid recursion loops.
8. Stop at the configured depth and mark remaining structure unknown rather than silently treating it as compatible.

The first implementation does not need full TypeScript assignability semantics. It needs a conservative comparator for the explicitly supported shape subset. Deep mapped types, conditional types, functions, tuples beyond the supported subset, branded types, overloads, and other complex features may remain unresolved.

### 11.5 Duplicate suppression and finding aggregation

Findings should be aggregated to avoid excessive notification noise. For example, a route mismatch may explain why a consumer has no exact provider; do not automatically emit both as two independent errors. A response field can produce a missing-field and a type mismatch only if they genuinely concern distinct issues.

Finding identity should be based on a stable rule ID, relationship/observation identity, and relevant field/path key—not array position. If the same source issue is rediscovered after analysis, preserve identity where practical so the UI doesn't flicker unnecessarily.

### 11.6 Severity, certainty, and UI state

Severity and evidence strength are separate. An important issue with uncertain evidence should not be presented as confirmed. The first release should make exact/direct contradictions actionable by default while presenting inferred or incomplete observations as qualified findings/warnings.

Suppressions should apply to the intended rule/relationship and include a reason where the configuration supports it. Suppressed findings must remain distinguishable from absent findings in reports.

---

## 12. Explanation Construction

### 12.1 Explanation requirements

A finding explanation should answer, where the evidence permits:

- what is inconsistent;
- the expected and observed values;
- how UNDRIFT related the consumer/provider;
- the source location(s) for both sides where available;
- why the mismatch may matter;
- what is directly observed versus inferred;
- which patterns or types could not be resolved;
- which repair options are available.

### 12.2 Explanation model

```ts
export interface FindingExplanation {
  headline: string;
  summary: string;
  expectedDescription?: string;
  observedDescription?: string;
  reason: string;
  possibleImpact?: string;
  evidenceStrength: EvidenceStrength;
  sourceLocations: SourceSpan[];
  limitations: AnalysisWarning[];
  suggestedNextSteps: string[];
}
```

The public `Finding` can store this data directly or reference an explanation builder. Either approach must maintain the separation between factual evidence and explanatory prose.

### 12.3 Explanation rules

- Do not claim a runtime failure is guaranteed based solely on static inference.
- Prefer precise language such as “the frontend declares `name` as a required string, while the observed provider object contains `displayName`.”
- If a value is unknown, say it could not be resolved.
- If the provider scan was incomplete, do not claim that a route is absent from the entire project.
- Do not manufacture a source location for a type or route that was not resolved.
- Do not use the same confident explanation template for direct syntax evidence and heuristic candidates.

The initial explanation engine can use deterministic templates keyed by rule ID. An LLM is not required.

---

## 13. Fix Proposal and Application Lifecycle

### 13.1 Fix generation boundary

The core finds eligible `FixGeneratorPort` implementations by rule ID and context. A generator creates one or more proposals only when it has sufficient evidence and can state its assumptions. A lack of a fix is a valid result.

Initial repair scope SHOULD be limited to small localized edits whose target and replacement can be explained. Route mismatches often do not reveal which side is correct; in those cases the proposal must require a developer's target choice or provide a manual-resolution route.

### 13.2 Proposal validation

Before applying a proposal, the extension must verify:

1. every affected URI remains within the intended workspace;
2. each document exists and has the expected content hash/version;
3. all ranges remain valid for the exact source snapshot from which the proposal was generated;
4. the proposal hasn't been invalidated by a later analysis generation;
5. any required target choice has been explicitly provided by the developer.

If a check fails, reject the stale proposal and request fresh analysis. Never attempt to “best effort” apply obsolete offsets to changed text.

### 13.3 VS Code edit application

The VS Code adapter converts the proposal's UTF-16 offsets/ranges into VS Code `Range` objects using the exact validated document text, constructs a `WorkspaceEdit`, and requests user acceptance through an appropriate code action/preview flow. Only accepted edits are applied.

The core does not import `WorkspaceEdit`, `TextEdit`, or VS Code classes. The editor adapter owns the translation and application.

### 13.4 Reverification sequence

```text
Fix proposal generated
        ↓
Developer inspects explanation/preview
        ↓
Developer accepts, chooses target, or rejects
        ↓
Extension validates source version/hash/ranges
        ↓
Apply accepted edit through VS Code
        ↓
Mark previous analysis generation stale
        ↓
Analyze the changed snapshot
        ↓
Re-run matching and relevant drift rules
        ↓
Update finding: resolved / still active / unresolved
```

A finding is considered resolved only when the new analysis confirms that the previously reported supported incompatibility no longer exists. If it disappeared because the relevant files could not be parsed or the scope became incomplete, report the uncertainty rather than success.

### 13.5 Initial fix test cases

At least the following cases should be tested before calling the repair loop complete:

- accepted proposal changes the intended range and leaves unrelated text unchanged;
- rejected proposal makes no source changes;
- source changed after proposal generation causes safe invalidation;
- proposal affecting multiple files is applied as one reviewable workspace operation when supported;
- position mapping works with Unicode and CRLF;
- post-edit analysis resolves a seeded finding;
- post-edit analysis leaves a finding active when the mismatch remains;
- unsupported/ambiguous finding returns no speculative edit or clearly requires manual target selection.

---

## 14. VS Code Adapter Design

The extension is an adapter around the core. It translates editor/workspace events into snapshots and results into native UI.

### 14.1 Activation and composition root

`extension.ts` or a dedicated activation module:

- registers commands and views;
- creates diagnostic collections, status items, tree providers and output channel;
- initializes the workspace storage persistence adapter (`ExtensionContext.storageUri` directory and `ExtensionContext.workspaceState`);
- builds concrete parser/analyzer registries, the state reconciliation engine, and the analysis engine;
- initializes workspace event handlers;
- coordinates the initial workspace open flow (restoring last-known snapshot and lifecycle history);
- owns disposables and calls `dispose()` at deactivation.

This is the only area that should assemble all implementation-specific dependencies. Avoid importing the full extension activation module from core or analyzer packages.

### 14.2 Workspace adapter

The workspace adapter:

- detects opened folders and supported file URIs;
- respects workspace exclusions and UNDRIFT configuration;
- loads disk files within allowed scope;
- obtains current text/version for open documents;
- computes/updates content hashes;
- creates `AnalysisRequest` snapshots;
- listens to created/changed/deleted and relevant open-document events;
- triggers debounced analysis.

Analysis MUST not execute the repository's code, `npm` scripts, or framework servers to discover routes.

### 14.3 Analysis coordinator

The extension-side coordinator owns:

- per-workspace generation counters;
- debounce/cancellation;
- snapshot creation;
- current-analysis status/progress;
- session restoration on workspace open:
  1. loads latest complete snapshot and lifecycle history from workspace storage;
  2. publishes snapshot as "last known state" to tree and report views;
  3. triggers fresh analysis of current workspace files;
  4. coordinates state reconciliation upon completion;
  5. saves updated snapshot and new events crash-safely;
  6. updates presentation to "freshly verified";
- accepting only non-stale `AnalysisResult` objects;
- failure semantics: ensuring incomplete/failed analyses never overwrite the valid persisted snapshot or emit false resolution events;
- publishing result updates to UI providers;
- scheduling re-analysis after accepted fixes.

The coordinator may use a correct scoped/full pass for each relevant burst in the first version. Avoid premature dependency-aware incremental scheduling if it can leave stale findings visible.

### 14.4 Diagnostic provider

The diagnostic provider maps active actionable findings to VS Code diagnostics.

Requirements:

- use stable rule codes, e.g. `UND120`;
- provide a concise message, severity, and primary source range;
- retain a finding ID link through diagnostic code/data where supported;
- avoid duplicating diagnostics for the same finding at both consumer and provider if this overwhelms the editor;
- clear diagnostics when a finding resolves, is suppressed, or becomes inapplicable;
- separate incomplete-analysis warnings from actual incompatibility errors.

A finding may identify multiple source locations, but the first release may use one primary diagnostic and show other locations through the details view and navigation actions.

### 14.5 Findings tree/sidebar

The tree provider presents findings grouped by category or severity and should show:

- state indicator badge: clearly distinguishing **Last Known Analyzed State** (with timestamp of last analysis) from **Freshly Verified Current Source**;
- category and severity;
- concise title;
- confidence/evidence class or uncertainty indicator;
- consumer/provider side when identified;
- current state (active/suppressed/incomplete/resolved);
- historical lifecycle tag (`detected`, `changed`, `resolved`, `reintroduced`) and observation timestamp;
- source navigation for each available location.

Tree grouping must not imply certainty not present in the underlying `Finding`.

### 14.6 Finding details/report

A report view can use a VS Code WebviewPanel or another suitable native view. It consumes the normalized `AnalysisResult`, the reconciled `AnalysisSnapshot`, and `FindingLifecycleHistory`, rendering:

- summary counts and presentation state indicator (last-known vs. freshly analyzed);
- findings grouped by category/severity;
- expected versus observed data;
- relevant source links (marked as historical references from analysis time);
- evidence and limitations;
- finding lifecycle history timeline (transitions, observation timestamps, delta summaries);
- fix proposal options;
- analysis coverage/warnings.

The view is presentation-only. It must not run its own route comparisons.

### 14.7 Hover provider and Quick Fix provider

Hover/detail views should be contextual and short, with a link/action to the full explanation. Quick Fix actions delegate to the fix registry/core and apply only validated proposals after user acceptance. Do not populate a Quick Fix merely because a string replacement is possible; the source-of-truth assumptions must be sound or explicitly chosen.

### 14.8 Commands and status

Initial commands should include equivalents of:

- Analyze Workspace / Analyze Again;
- Open UNDRIFT Report;
- Explain Finding;
- Refresh Findings;
- Ignore/Suppress Finding when project configuration supports it;
- Re-check affected relationship after manual correction;
- Reset Drift History (clears persisted lifecycle history independently of in-memory state caches);
- Clear In-Memory State Cache (clears in-memory cached copies of persisted workspace state without deleting saved snapshots or lifecycle history; parser/analysis caches are not present in V0 as ASTs are parsed on demand per scan).

A status bar item may report analyzing/clean/findings/incomplete states. Notifications should be selective and should not repeatedly show unchanged results.

### 14.9 Disposal and resource ownership

Every VS Code listener, tree, diagnostic collection, status item, cancellation source, parser, and view registration must be registered for cleanup. The composition root owns the engine; the engine owns parser/analyzer resources it creates or registers according to the chosen contract. Do not dispose a parser/tree that another in-flight analysis is still using.

### 14.10 Workspace persistent storage adapter

The extension implements `StatePersistencePort` using VS Code-managed workspace storage:

1. **Storage Mechanism and API Allocation (POC-F Decision):**
   - `vscode.ExtensionContext.storageUri`: the workspace-specific storage directory on disk, established as the authoritative location for persisting structured JSON files for the latest complete analysis snapshot (`AnalysisSnapshot`) and finding lifecycle history (`FindingLifecycleHistory`).
   - **POC-F Concrete Decision:** Structured JSON files in `storageUri` partitioned by deterministic, filesystem-safe workspace keys (`workspaces/<workspaceKey>/`) provide complete, crash-safe persistence via write-to-temporary-file and rename. Duplicate metadata in `workspaceState` is omitted to eliminate split-brain synchronization hazards. If `storageUri` is undefined (e.g. untitled or virtual workspaces), storage operations explicitly report `StorageUnavailableError` rather than silently fabricating empty state.
2. **Workspace Isolation:** All persisted keys/files are partitioned by the workspace folder identity. State cannot leak between different repository windows.
3. **Crash-Safe and Recoverable Writes:** Storage updates require crash-safe and recoverable persistence. A write-to-temporary-file and rename pattern in `storageUri` (or atomic key updates in `workspaceState`) is the candidate implementation, but universal atomicity cannot be assumed across all supported extension-host filesystem environments; POC-F will validate cross-environment reliability. Interrupted writes must never leave partial or corrupt data.
4. **Schema Versioning & Recovery:** Each persisted payload contains a `schemaVersion` header. If stored data is corrupted, malformed, or of an unsupported version, UNDRIFT logs a warning, quarantines the invalid data, and initializes a clean baseline. It never fabricates history or accepts corrupt records.
5. **Storage Boundaries:** The adapter MUST NOT write history to the user's project repository (`.undrift/`), MUST NOT require SQLite or an embedded database, and MUST NOT connect to remote services or clouds.

---

## 15. Configuration Model

V0 may run with defaults. A later V1 configuration should be local, versioned, readable, and validated.

Candidate shape:

```ts
export interface HistoryRetentionConfig {
  retentionDays?: number;
  maxEventsPerWorkspace?: number;
}

export interface UndriftConfig {
  version: 1;
  include?: string[];
  exclude?: string[];
  analyzers?: {
    javascriptTypescript?: boolean;
    express?: boolean;
  };
  rules?: Record<string, { enabled?: boolean; severity?: FindingSeverity }>;
  suppressions?: FindingSuppression[];
  mappings?: IntentionalMapping[];
  historyRetention?: HistoryRetentionConfig;
}

export interface FindingSuppression {
  ruleId: RuleId;
  relationshipKey?: string;
  uri?: DocumentUri;
  reason: string;
}

export interface IntentionalMapping {
  kind: "field" | "route-prefix" | "other";
  from: string;
  to: string;
  reason: string;
}
```

This is a proposal for LLD discussion, not a finalized public schema. The final configuration filename, mapping semantics, exact history retention defaults and limits, and behavior for unknown keys remain open implementation decisions.

Rules:

- invalid config should produce a clear warning and safe defaults;
- scope/ignore patterns must not allow accidental traversal outside the selected workspace;
- suppressions should be explicit and narrowly scoped;
- an intentional mapping must retain its rationale and contribute visible evidence;
- no implicit global assumption that either frontend or backend is always authoritative;
- configuration changes invalidate affected analysis and relevant cache entries.

---

## 16. Caching, State and Finding Identity

### 16.1 Five-tier state architecture

To ensure reliable finding tracking across sessions without violating the primacy of the developer's code, UNDRIFT establishes a five-tier state model:

1. **Tier 1: Current Source Code (Authoritative Source of Truth):**
   - Editor buffers, workspace files, and disk contents.
   - Always authoritative for the current state of the workspace.
2. **Tier 2: In-Memory Working State (Ephemeral):**
   - Active Tree-sitter parse trees, byte offset tables, and transient analyzer data.
   - Discarded upon editor buffer edits or session termination.
3. **Tier 3: Disposable Analysis Caches (Ephemeral Performance Layer):**
   - Parsed AST caches, normalized observation caches, and match indexes.
   - Keyed by file content hashes and configuration versions.
   - Safely discardable and rebuildable from source code at any time.
4. **Tier 4: Latest Complete Analysis Snapshot (Persisted Last Known State):**
   - Persisted in VS Code-managed workspace storage (`storageUri` directory candidate for snapshot files; `workspaceState` for metadata).
   - Represents the most recent successfully completed analysis.
   - Restored on session start as "last known state" until re-analyzed.
   - **Never overwritten by incomplete, interrupted, cancelled, or failed runs.**
5. **Tier 5: Finding Lifecycle History (Persisted Transition Log):**
   - Persisted in VS Code-managed workspace storage (`storageUri` directory candidate for lifecycle event history files; `workspaceState` for metadata).
   - Records meaningful transitions: `detected`, `changed`, `resolved`, and `reintroduced` with observation/confirmation timestamps.
   - Unchanged findings produce no new events.
   - Pruned by configurable retention independently of the Tier 4 snapshot.

### 16.2 History reset vs. cache clearing

The architecture strictly separates disposable performance caches from user-meaningful finding history:

- **Cache Clearing (`undrift.clearCache`):** Discards in-memory cached copies of persisted workspace state (the Tier-3 read cache in the persistence adapter) and triggers an immediate workspace rescan from source. Note that separate parser/AST or extractor caches are not currently maintained across scans. Clearing the cache leaves Tier 4 (latest complete snapshot) and Tier 5 (finding lifecycle history) intact on disk.
- **History Reset:** An independent user operation that clears Tier 5 lifecycle events and/or resets the Tier 4 snapshot to a clean baseline. History reset never alters project source code or workspace configuration.
- **Retention Pruning:** Background pruning removes expired Tier 5 lifecycle events based on configured retention policies. Pruning operates strictly on historical event records and **must never delete or degrade the Tier 4 latest complete snapshot**, ensuring the current last-known state remains available regardless of event age.

### 16.3 Stable finding identity

To recognize whether a finding is unchanged, changed, resolved, or reintroduced across completed analyses, UNDRIFT requires deterministic, stable finding identity:

- **Formula Requirements (Conceptual Design):** Finding identity derives deterministically from:
  1. the stable rule ID (e.g., `UND120`, `UND300`);
  2. the normalized relationship endpoint identity (HTTP method, normalized route pattern);
  3. the specific target property, parameter name, or field key involved;
  4. consumer and provider roles where applicable.
- **Invariance:** Finding identity MUST NOT depend on array indexes, transient memory addresses, or raw line numbers that shift when unrelated lines are added above the finding.
- **Material Change Criteria:** If a finding's severity, expected/observed types, or core conflict changes while its identity remains intact, state reconciliation flags a `changed` transition. If its core identity disappears from a sufficiently complete scan, it is flagged as `resolved`. If it reappears later, it is flagged as `reintroduced`.
- **Open Decisions:** The exact canonical serialization format, hashing algorithm (e.g., cryptographic SHA-256 vs. Murmur/FNV digest), and exact quantitative/qualitative criteria defining when a change is "material" remain open implementation decisions.

### 16.4 Crash-safe storage writes and invalid-data recovery

Persistent state operations must be crash-safe and recoverable:

1. **Crash-Safe Persistence Pattern:** Snapshot and event updates must satisfy crash-safe and recoverable persistence requirements (e.g., writing to a temporary file in `storageUri` followed by rename, or atomic `workspaceState.update`). Universal atomicity of file renames cannot be assumed across all filesystem environments and will be validated in POC-F. Interrupted writes must leave the previous valid snapshot and event history intact, and any duplicated metadata must remain recoverable.
2. **Schema Versioning:** All persisted payloads include an integer `schemaVersion` header.
3. **Safe Recovery:** If persisted data is missing, corrupted, or incompatible with the current schema:
   - UNDRIFT logs a structured local warning;
   - Quarantines or resets the corrupted file without failing workspace activation;
   - Falls back to a clean first-time baseline;
   - Triggers fresh analysis of current workspace source;
   - **Never fabricates history or accepts partially corrupted state.**

### 16.5 Workspace isolation and multi-day gap handling

- **Workspace Isolation:** State is strictly partitioned by workspace folder identity. Snapshots and history cannot leak across different workspaces or editor windows.
- **Ambiguous and Multi-Root Workspaces:** Workspace partitioning details for unsupported or ambiguous workspace setups (such as multi-root workspaces or untitled/unsaved workspaces where folder identity is ambiguous) remain an open implementation decision.
- **Multi-Day Gaps:** UNDRIFT does not run in the background while VS Code is closed. When reopening after days or weeks:
  1. The restored snapshot is displayed as "last known state" with its original analysis timestamp.
  2. Fresh analysis runs and reconciles against the restored snapshot.
  3. **Event timestamps reflect when UNDRIFT observed/confirmed the transition**, not an invented estimate of when source changes occurred while VS Code was closed.
  4. The presentation layer clearly presents the gap between completed analyses.

---

## 17. Error Handling

| Condition | Core behavior | Extension behavior |
|---|---|---|
| Unsupported file/language | No parser/analyzer result for that document | Ignore silently or show scoped unsupported status; do not classify it as clean analyzed code |
| Grammar failed to load | Return an analyzer/parse warning and mark coverage incomplete | Log details; avoid crashing activation |
| Syntax error/incomplete buffer | Retain valid supported syntax where possible and attach parse issues | Avoid noisy diagnostics for every incomplete keystroke |
| Dynamic route/method/body | Store dynamic/unknown observation | Explain analysis limitation and avoid confident compatibility assertion |
| Unresolved type/import | Retain unresolved reference and provenance | Show qualified warning if it affects a finding |
| Analyzer exception | Isolate the failing analyzer/document when safe | Write useful local logs and continue independent work |
| Invalid config | Return configuration warning and documented defaults | Identify the config source/location |
| Cancelled/superseded analysis | Stop at safe boundaries; discard stale output | Keep latest valid result or show current analysis state |
| Incomplete or failed analysis | Preserve previous complete snapshot intact; suppress false resolution and reintroduction events | Display analysis attempt status while keeping last complete state available |
| Persisted storage corrupted / invalid schema | Log warning; quarantine or reinitialize state safely without fabricating history | Notify user via output log; establish clean baseline via fresh analysis |
| Storage write failure during reconciliation | Abort write safely; preserve previous valid snapshot and event history | Surface local storage warning |
| Source changed during proposal | Refuse to apply stale edit | Ask for fresh analysis |
| Fix does not resolve mismatch | Keep finding active after re-analysis | Show remaining mismatch; do not imply success |
| Workspace changed during scan | Mark result stale/incomplete as appropriate | Ignore stale generation and schedule latest scan |

Unexpected failures should include enough context for debugging—phase, analyzer ID, URI, error details—without logging full source unnecessarily.

---

## 18. Privacy and Safety Requirements

1. All V0/V1 analysis happens locally within the opened workspace or permitted extension-host workspace.
2. Analysis snapshots and finding lifecycle history are stored exclusively in VS Code-managed workspace storage (`ExtensionContext.storageUri` directory candidate for structured snapshot and history files; `ExtensionContext.workspaceState` for metadata).
3. No source code or derived contract graph is uploaded to a UNDRIFT service or remote database.
4. Persistent state does not write into a `.undrift/` repository directory.
5. Entire source files are not duplicated into persistent storage; source references point to past file paths and line ranges and may become stale as the codebase evolves.
6. There is no required server, database, account, LLM provider, or model API key.
7. Git is not a mandatory dependency and source-control analytics are not performed.
8. The analyzer does not execute source, install dependencies, run package scripts, or launch application services.
9. File discovery respects the workspace boundary and ignore rules.
10. Generated/dependency files should be excluded from normal analysis/fixes unless explicitly configured.
11. Proposed edits are reviewed and validated against current snapshots before application.
12. All multi-file edits are described by explicit edit intents; no arbitrary shell command is generated/executed as a fix.
13. Any future remote/AI capability would require explicit opt-in and clear disclosure of any data leaving the workspace.

---

## 19. Testing Strategy

Tests follow package boundaries and include valid projects as well as deliberately broken cases. A larger number of detected problems is not success if false positives increase.

### 19.1 Unit tests: parser facade and position mapper

Cover:

- correct grammar selection for `.js`, `.jsx`, `.ts`, `.tsx`;
- exact source text and snapshot identity;
- error/missing nodes in incomplete code;
- byte-offset to UTF-16 mapping;
- Unicode, CRLF, LF, empty documents, final-line positions;
- valid and invalid text edit ranges;
- parser/tree disposal and cancellation lifecycle.

### 19.2 Unit tests: extractors

Frontend call fixtures:

- direct `fetch("/api/users")`;
- fetch with explicit POST method;
- fetch with supported JSON body serialization;
- supported Axios method calls;
- a typed Axios result where the response annotation is visible;
- dynamic path/method and unsupported custom wrapper;
- wrong identifier/unsupported call that must not become an API consumer.

Backend fixtures:

- `app.get` and `router.post`;
- the supported methods across app/router forms;
- literal route and parameter route;
- direct `res.json` response;
- supported `res.status(...).json(...)` chain;
- route with dynamic path;
- mounted prefix supported case and unresolved mount case;
- a function that looks like a route method but is not a supported Express construct.

Shape/type fixtures:

- primitive field, nested object, array, union and literal;
- optional and nullable properties;
- local interface/type alias;
- supported import if the POC validates it;
- unresolved import, circular reference, complex generic or unsupported type;
- complete versus partial shapes.

### 19.3 Unit tests: normalization and matching

Test exact matches, route parameter handling, method conflict, trailing slash policy, base paths, query strings, unsupported interpolation, duplicate routes, ambiguity, and conservative suspected route mismatch.

Explicit negative tests are essential:

- similar-looking unrelated routes do not get matched;
- `user` and `users` are not silently equivalent except under the constrained suspected-route rule;
- parameter names alone do not create a route mismatch;
- route prefixes are not dropped;
- unknown method/path does not become a literal;
- ambiguous candidate sets do not emit a definitive route mismatch;
- external/dynamic consumer possibilities do not become a claim of global unused endpoint.

### 19.4 Unit tests: drift rules

For each rule, include:

- a positive fixture that should produce the finding;
- a compatible fixture that should not;
- an ambiguous/incomplete fixture that should qualify or suppress the finding;
- expected severity and evidence strength;
- exact source references;
- expected and observed data;
- a stable rule ID.

Specific cases:

- no compatible provider versus method mismatch;
- no known consumer semantics;
- required request field omitted from a complete consumer shape;
- extra request property when provider acceptance is unknown (must not be a hard error);
- missing response property in a complete provider shape;
- missing response property in a partial provider shape (must not be treated as proof);
- incompatible request/response types;
- provider nullable output versus non-null consumer expectation;
- unknown/unresolved types (must not yield guessed mismatch);
- intentional mapping/suppression;
- duplicate route finding aggregation.

### 19.5 Unit tests: fix proposal and staleness

- generator returns no fix when evidence/authority is ambiguous;
- proposal contains expected content hash/version;
- rejected proposal causes no edit;
- stale source invalidates the proposal;
- accepted edit modifies only intended ranges;
- Unicode position mapping does not shift ranges;
- route ambiguity requires a target choice or manual handling;
- successful fix re-analysis clears the intended finding;
- incomplete re-analysis does not mark a finding resolved.

### 19.6 Unit tests: state reconciliation and persistence

The state reconciliation engine must be thoroughly tested with unit fixtures:

- **Coverage gating:** an incomplete or failed analysis result (`complete: false` or critical warnings) preserves the previous complete snapshot intact, emits zero resolution/reintroduction events, and returns `coverageSufficient: false`.
- **First-time analysis:** a fresh analysis with no pre-existing snapshot or history emits `detected` for each finding and creates an initial snapshot.
- **Unchanged finding suppression:** a finding present in both previous and current snapshots with identical severity, shape, and rule code produces **no new lifecycle event**.
- **Material change transition:** a finding with altered severity, expected/observed shape, or conflict details emits a `changed` lifecycle event.
- **Finding resolution:** a finding present in the previous snapshot but absent from a completed, sufficiently complete subsequent analysis emits a `resolved` lifecycle event.
- **Finding reintroduction:** a finding previously resolved that is observed again in a subsequent analysis emits a `reintroduced` lifecycle event.
- **Retention pruning:** pruning expired lifecycle events removes old events according to the retention policy while **leaving the latest complete snapshot completely intact**.
- **Crash recovery:** corrupted, malformed, or invalidly versioned storage files are quarantined and re-initialized to a clean baseline without failing activation or fabricating history.

### 19.7 Integration tests: core

A complete fixture workspace should be passed through the real parser adapter, analyzer, matching, and rule engine. Compare normalized JSON/golden outputs for observations, relationships, findings, warnings, and source positions.

Golden files should be intentionally reviewed when rules change, so false-positive behavior isn't silently normalized.

### 19.8 Extension-host tests

Run through a VS Code extension host to verify:

- activation, commands and contribution registration;
- workspace scan and open-buffer precedence;
- diagnostics and tree/report linkage;
- session restoration: workspace opens, restores last-known snapshot and history, displays "last known state" indicator, triggers fresh analysis, and transitions to "freshly verified";
- snapshot-to-snapshot reconciliation across simulated file edits and sessions;
- incomplete/interrupted runs preserve the valid snapshot;
- changed document invalidates stale output;
- analysis generation prevents old results replacing new ones;
- accepted and rejected Quick Fix flow;
- invalidated fix proposals are not applied;
- result refresh after accepted fix;
- crash-safe persistence and recovery from invalid storage data;
- resource/listener disposal on deactivation.

### 19.9 Evaluation metrics

Track the metrics specified by the PRD, including true positives, false positives, seeded drifts missed, accuracy by rule category, successful re-verification, first-use time, responsiveness, and warning/noise levels. Keep a labeled fixture catalog so every rule can be improved against reproducible examples.

---

## 20. Proof-of-Concept Gates

The code structure should allow these experiments without redesigning the core domain.

### POC-A — Parser binding and package viability

Validate Tree-sitter in the actual bundled extension. Compare `web-tree-sitter` with packaged WASM grammars against the official Node.js binding.

Measure/verify:

- cold-start and grammar initialization;
- JS/TS/JSX/TSX parsing;
- syntax errors and incomplete buffers;
- source ranges and Unicode position mapping;
- incremental edit parsing;
- bundle/asset packaging;
- version compatibility and cross-platform behavior.

**Decision:** choose the concrete binding and pin compatible grammar/runtime versions. If the preferred WASM candidate fails material requirements, use the alternative behind `ParserPort`.

### POC-B — First consumer/provider extraction

Extract direct supported frontend calls and Express routes into the normalized observation model. Test complete and dynamic cases.

**Decision:** publish a precise support matrix for the initial vertical slice and its known limitations.

### POC-C — Semantic depth for TypeScript

Test direct fields, inline response shapes, local interfaces, imported aliases, and responses routed through helpers.

**Decision:** decide whether the lightweight local index is sufficient for V0/V1 or whether an optional TypeScript semantic adapter (TypeScript Compiler API or `ts-morph`) must be included. Do not choose a compiler-backed adapter pre-emptively or make the core depend on it.

### POC-D — Matching accuracy

Run route and shape fixtures covering direct matches, method conflicts, a unique one-segment route conflict, ambiguous candidates, partial schemas, and intentional transformations.

**Decision:** tune or narrow matching rules based on labeled precision/false-positive results. Do not expand fuzzy matching just to increase counts.

### POC-E — Live edit and fix loop

Verify open-buffer precedence, debounce/cancel behavior, generation checks, accepted edits, stale-edit rejection, and re-analysis.

**Decision:** decide whether the in-process model meets responsiveness goals or whether profiling justifies further concurrency architecture.

### POC-F — State persistence, reconciliation, and session recovery

Validate workspace-scoped storage serialization, session restoration on extension activation, snapshot-to-snapshot reconciliation, coverage failure gating, and retention pruning.

**Decision (Resolved in Chunk 4.1):** `ExtensionContext.storageUri` serves as the authoritative, workspace-scoped persistent storage provider using structured JSON files (`snapshot.json`, `history.json`) partitioned by deterministic workspace hash/key. Write-to-temp-and-rename guarantees crash-safe updates, malformed/incompatible records are safely quarantined, and unavailable `storageUri` is explicitly reported. `workspaceState` is not needed as secondary metadata storage, eliminating split-brain desynchronization risks.

---

## 21. Implementation Sequence

### Phase 1 — Repository baseline and parser POC

- reconcile package setup and scripts;
- implement parser port and grammar registry;
- package the extension with parser assets;
- test position mapping and incomplete-source handling.

**Exit:** the extension bundle parses representative source files and returns reliable spans.

### Phase 2 — Observation extraction

- implement frontend `fetch`/Axios patterns in the chosen support matrix;
- implement Express route/handler patterns;
- extract direct request/response shapes and explicit supported types;
- record provenance and analysis warnings.

**Exit:** fixture code yields expected normalized observations.

### Phase 3 — Contract model and drift detection

- implement shape/route normalization;
- generate candidate relationships;
- implement stable rule IDs;
- build expected/actual explanations and report data;
- add negative/ambiguity fixtures.

**Exit:** valid, drifted, and unresolved relationships produce distinct results.

### Phase 4 — VS Code integration, persistence, and state reconciliation

- wire workspace snapshot provider, analysis coordinator, and storage adapter;
- implement workspace-scoped persistence for latest complete analysis snapshot and lifecycle history;
- implement the 8-step session open and state reconciliation pipeline;
- enforce coverage sufficiency failure semantics;
- add diagnostics, sidebar/report, source navigation, commands and status;
- debounce and discard stale analysis.

**Exit:** a developer sees findings from IDE, can close and reopen VS Code retaining finding history, and observes verified transitions upon fresh analysis.

### Phase 5 — Reviewable repair and verification

- implement a narrowly scoped fix generator;
- add target choice/manual path for ambiguous repairs;
- validate hashes/versions and apply through `WorkspaceEdit`;
- trigger re-analysis and verify resolution.

**Exit:** at least one realistic case completes the full detect → explain → review/apply → re-analyze → verify loop.

### Phase 6 — Evaluation and scope adjustment

- run labeled fixture suite and a representative sample project;
- evaluate false positives and missed cases;
- benchmark startup, analysis and editing responsiveness;
- test with developers;
- decide whether to add semantic resolution, expand framework coverage, or focus on report/fix quality.

**Exit:** the next changes are prioritized by measured gaps and real workflow feedback.

---

## 22. Definition of Done for the First End-to-End Slice

The first complete slice is not considered done until:

- [ ] the extension activates and loads all required parser assets in its packaged form;
- [ ] supported JavaScript/TypeScript/JSX/TSX fixtures parse with source mapping tests;
- [ ] a supported frontend API call and Express provider are extracted;
- [ ] observations retain source spans, snapshot identity, evidence strength and limitations;
- [ ] exact matching, a mismatch, and an ambiguous case produce different appropriate results;
- [ ] drift rules have positive and negative fixtures;
- [ ] findings explain expected versus observed data;
- [ ] a finding can be opened from a diagnostic/sidebar/report and navigates to available source sides;
- [ ] closing and reopening VS Code restores the last known complete snapshot as "last known state";
- [ ] fresh analysis after workspace open reconciles findings, producing `detected`, `changed`, `resolved`, or `reintroduced` transitions;
- [ ] incomplete or failed analysis preserves previous snapshot and suppresses false resolution events;
- [ ] persistent state is stored in VS Code workspace storage, not in user repo (`.undrift/`), without requiring external/embedded database;
- [ ] retention pruning does not destroy or degrade the latest complete snapshot;
- [ ] one supported repair proposal is reviewable and applied only after user acceptance;
- [ ] stale proposals are rejected;
- [ ] post-edit analysis confirms resolution only when supported checks establish it;
- [ ] parser/analyzer failures do not crash unrelated workspace analysis;
- [ ] no source or contract evidence is sent to a remote service;
- [ ] documented limitations and supported patterns match actual behavior.

---

## 23. Deferred Decisions

The following remain intentionally outside the finalized implementation details until justified:

- exact Tree-sitter JS/WASM binding and grammar versions (POC-A);
- need and implementation of a TypeScript semantic adapter (POC-C);
- deep inference through arbitrary functions, custom clients and complex framework composition;
- Prisma and other language/framework adapters;
- final configuration filename, mappings and suppression schema;
- incremental dependency graph sophistication;
- worker thread or process isolation;
- CLI/npm, Git hooks and CI;
- LSP/multi-editor support;
- OpenAPI/generated SDK ingestion;
- runtime evidence and multi-repository analysis;
- any optional AI/remote semantic capability;
- SQLite, embedded, or remote databases (excluded from scope);
- storing history in `.undrift/` repository directory (excluded from scope);
- Git history integration as a mandatory dependency (excluded from scope).

**Open implementation decisions (intentionally unresolved in this design):**
1. *Storage API allocation and division of responsibilities:* Exact division of responsibilities between `ExtensionContext.storageUri` (candidate for structured snapshot/history files) and `ExtensionContext.workspaceState` (key-value metadata/indexing), crash-safe write strategy, and low-level JSON serialization format (provisional in design; validated in POC-F).
2. *Retention settings schema and default limits:* Specific retention duration (e.g. days), event-count limits, and user-facing configuration schema.
3. *Stable finding identity algorithm details:* Exact canonical serialization format and cryptographic hashing function.
4. *Material change threshold criteria:* Exact degree of route, method, schema, or location delta that constitutes a `changed` finding versus an unchanged finding.
5. *Multi-root and unsaved workspace partitioning:* Low-level directory mapping when no workspace root folder is formally saved.

---

## 24. Final Implementation Contract

The LLD defines UNDRIFT as a modular local analysis system composed of:

1. a VS Code adapter that snapshots workspace source and presents results;
2. an asynchronous analysis pipeline;
3. a Tree-sitter adapter hidden behind a parser port;
4. JavaScript/TypeScript and Express extractors producing normalized evidence;
5. a language-neutral contract matcher and deterministic drift-rule engine;
6. explanation and fix-proposal generators that preserve evidence and uncertainty;
7. a reviewed, version-aware VS Code edit path;
8. post-edit re-analysis that establishes the resulting state.

The core does not depend on VS Code or a programming-language compiler API. The language adapters can grow over time, but the first release proves one vertical slice deeply instead of claiming broad language support prematurely.

The implementation's primary acceptance loop is:

```text
DISCOVER → MATCH → DETECT → EXPLAIN
        → PROPOSE → REVIEW/APPLY
        → RE-ANALYZE → VERIFY
```

A successful file write is not the goal. A reliable, evidence-backed diagnosis and verified resolution inside the developer's normal workflow is the goal.

---

## 25. Reference Documentation

Recheck upstream versions during implementation; URLs are references, not pinned dependency declarations.

- Tree-sitter: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter WebAssembly binding: https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- Tree-sitter TypeScript/TSX grammars: https://github.com/tree-sitter/tree-sitter-typescript
- VS Code Extension API: https://code.visualstudio.com/api/
- VS Code extension bundling: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- TypeScript Compiler API (for optional semantic-adapter evaluation): https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Vitest: https://vitest.dev/guide/

---

**End of LLD — Version 1.0-draft**
