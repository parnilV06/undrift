# UNDRIFT — Technical Requirements Document (TRD)

**Document:** `TRD.md`  
**Version:** 1.0-draft  
**Status:** Architecture baseline for founder review  
**Date:** 2026-10-09  
**Project:** UNDRIFT — personal developer-tool project  
**Primary interface:** VS Code extension  
**Analysis mode:** Local-first, static analysis  
**Supersedes:** Earlier hackathon-oriented technical assumptions; this document is the current technical baseline and is not constrained by hackathon requirements.

---

## 1. Purpose

This document translates UNDRIFT's Product Requirements Document (PRD) into an implementable technical direction. It defines the initial technology stack, architecture, module boundaries, analysis pipeline, language-support strategy, data contracts, IDE integration, performance and privacy requirements, testing strategy, and decision gates.

The aim is to build one reliable product loop:

```text
DISCOVER → NORMALIZE → MATCH → DETECT → EXPLAIN
       → PROPOSE → REVIEW/APPLY → RE-ANALYZE → VERIFY
```

The architecture must support new language and framework adapters without requiring the shared drift engine, report model, or VS Code integration to be rewritten. This does not mean a new language is supported merely by adding its grammar: language- and framework-specific extractors, evidence resolution, tests, and documented pattern support will still be required.

### 1.1 Authority and alignment

- The PRD defines the user problem, product scope, V0/V1 goals, and non-goals.
- This TRD defines the technical approach and implementation constraints for those requirements.
- A future High-Level Design (HLD) will describe component interactions and runtime flows in greater detail.
- A future Low-Level Design (LLD) will define concrete types, interfaces, algorithms, modules, and test fixtures after the technical proof of concept has validated the interfaces.

The existing LLD in the project folder was created for an earlier hackathon MVP and contains parser/compiler assumptions that no longer reflect this direction. It is not authoritative for the new parser architecture and should be reconciled after this TRD is reviewed.

### 1.2 Requirement language

The words **MUST**, **SHOULD**, and **MAY** identify mandatory, recommended, and optional requirements respectively. Items marked **provisional** are targets to verify during the proof of concept, not claims that performance or compatibility has already been demonstrated.

---

## 2. Technical Objectives

The implementation MUST:

1. Run the initial analysis locally in the developer's VS Code workspace.
2. Use TypeScript for the core codebase and extension implementation.
3. Use Tree-sitter as the common syntax-parsing foundation.
4. Separate parsing, language/framework extraction, normalized contract modeling, drift detection, fix proposals, and editor presentation.
5. Keep shared domain logic independent of VS Code and independent of any one programming language's compiler API.
6. Preserve source locations and evidence for each extracted observation and finding.
7. Distinguish observed facts, inferred relationships, unknown values, and unsupported patterns.
8. Support safe, reviewable fixes through native VS Code editing mechanisms; never silently rewrite source files.
9. Re-analyze source after a developer applies a change and determine resolution from the new analysis state.
10. Provide a tested path to add new language and framework adapters without creating separate end-to-end engines.
11. Continue to be useful when a source file is incomplete or contains syntax errors.
12. Include deterministic tests for valid relationships as well as seeded drift, ambiguous cases, and known limitations.

The implementation SHOULD:

- prioritize deterministic checks before optional semantic inference;
- use debouncing, caching, cancellation, and file-level incremental parsing where they are beneficial;
- keep dependencies and package size reasonable for a VS Code extension;
- make it possible to add a CLI/CI consumer later without duplicating analysis behavior;
- prefer extension APIs over a custom UI or separate service where the native API is adequate.

---

## 3. Decisions and Decision Status

This section is the canonical summary of what is decided and what is still open.

| Decision area | Current decision | Status |
|---|---|---|
| Product surface | VS Code extension first | **Locked** |
| Main implementation language | TypeScript | **Locked** |
| Runtime model | Local VS Code Node.js extension host for the first desktop release | **Locked** |
| Parsing foundation | Tree-sitter with language-specific grammars | **Locked at architecture level** |
| Parser binding | Prefer `web-tree-sitter` with WebAssembly grammars if the packaging/performance spike passes; compare with official Node.js binding | **POC gate** |
| Core design | Editor-independent, language-neutral analysis core | **Locked** |
| Language support architecture | Pluggable language/framework adapters feeding one normalized evidence model | **Locked** |
| Initial source ecosystem | JavaScript/TypeScript and JSX/TSX frontend code; Node.js/Express backend patterns | **Locked for first vertical slice** |
| TypeScript semantic resolver | Optional adapter boundary; add deeper resolver only if the POC proves syntax and local symbol indexing insufficient | **Deferred pending POC** |
| `ts-morph` | Not a core dependency and not the default parsing layer; may be evaluated only as an implementation detail of an optional TypeScript semantic adapter | **Not selected** |
| Prisma | Not required to prove the first API contract loop; later adapter after the first loop works | **Deferred** |
| Analysis process | In-process async calls first, with cancellable operations and a stable interface boundary | **Locked for initial version** |
| LSP / separate server | Not used initially; consider only for real multi-editor/process-isolation needs | **Deferred** |
| Build | esbuild for extension bundling, with TypeScript type-checking as a separate step | **Selected** |
| Package manager | npm with npm workspaces | **Selected** |
| Tests | Vitest for unit/integration tests plus VS Code extension-host tests | **Selected** |
| Persistence | In-memory analysis state; explicit project configuration/suppressions only when needed | **Selected for V0** |
| Backend/database/cloud | None required for V0/V1 | **Locked out of initial scope** |
| Required LLM/API key | None | **Locked out of initial scope** |
| CLI/CI/hooks | Reuse core later; not a V0 requirement | **Deferred** |

“Locked” means that new work should follow the decision unless the proof of concept identifies a material technical problem. It does not mean a dependency version has been frozen forever.

---

## 4. Technology Stack

### 4.1 Selected stack

| Layer | Technology | Responsibility / notes |
|---|---|---|
| Implementation language | TypeScript | Core, adapters, extension, tooling. Enable strict type checking. |
| Runtime | Node.js-compatible VS Code extension host | Runs the desktop/local extension and local analysis. Do not assume the end user's separate Node installation is available to the extension. |
| IDE integration | VS Code Extension API | Diagnostics, hover, code actions, commands, tree view/sidebar, report webview, workspace edits, output channel, document/workspace events. |
| Syntax parser | Tree-sitter | Common parser interface and concrete syntax trees with node source ranges. Use grammar packages per language. |
| Initial grammars | Tree-sitter JavaScript and TypeScript grammars, including JSX/TSX coverage | Pin compatible runtime/grammar versions and test all supported extensions. Do not infer grammar support merely from a language name. |
| Preferred parser binding candidate | `web-tree-sitter` + packaged WASM grammars | Preferred for portability and avoiding per-platform native builds, subject to the POC for startup time, bundling, compatibility, package size, and performance. |
| Build/bundle | esbuild | Bundle extension/runtime code; externalize the VS Code API. Keep grammar/WASM assets explicitly copied and loaded. |
| Type checking | TypeScript compiler (`tsc --noEmit` or equivalent workspace check) | Run independently of bundling. esbuild bundling is not a substitute for type checking. |
| Tests | Vitest + VS Code extension-host test runner | Unit and fixture-driven integration tests in the engine; real extension activation/UI editing tests for integration. |
| Package manager | npm + npm workspaces | One lockfile and coordinated internal package versions. |
| Lint/format | ESLint + Prettier (or equivalent repository-wide, consistently configured tools) | Enforce predictable formatting and basic static quality. Exact preset is a repository setup detail. |
| Persistence | In-memory structures; versioned JSON project configuration where needed | No database required for the first release. |
| Future CLI | Node.js executable consuming the same analysis interfaces | Later; must not introduce a second implementation of detection logic. |

### 4.2 Runtime compatibility

The extension runs in the VS Code extension host, not automatically in the user's shell environment. The minimum supported VS Code version and compatible extension-host runtime must be specified in the extension manifest and validated in CI before publishing. Build-time tooling can use a current supported Node.js LTS release; the extension bundle must target the actual declared VS Code compatibility range.

The initial release targets the local/remote **Node.js extension host**, not browser-only VS Code Web. Supporting browser-host execution can be evaluated later. Using a WebAssembly parser binding may help portability, but does not by itself make the whole extension web-compatible.

### 4.3 Why Tree-sitter is the common syntax layer

Tree-sitter supports incremental parsing, returns concrete syntax trees with source positions, and is designed to continue producing useful trees while source is temporarily syntactically invalid. Its official ecosystem has both Node.js and WebAssembly JavaScript bindings and separate parsers for a number of languages. These characteristics make it a suitable common syntax foundation for an editor-based, eventually multi-language tool.

Tree-sitter provides **syntax**, not complete program semantics. It does not by itself resolve imports and symbols, infer arbitrary types, determine runtime values, understand all framework conventions, or prove whether two values are semantically equivalent. UNDRIFT MUST retain a separate layer for language/framework extraction and optional semantic resolution.

### 4.4 Parser binding decision gate

The architecture is committed to Tree-sitter, but the exact JavaScript binding remains a validation gate.

The POC MUST compare at least:

- loading the parser and TypeScript/TSX grammar in the bundled extension;
- extension startup and first-parse overhead;
- grammar/WASM packaging and version compatibility;
- parse throughput and incremental edit behavior;
- handling of syntax errors and unfinished editor buffers;
- bundle size and cross-platform behavior;
- source byte offsets and conversion to VS Code position semantics.

**Preferred initial candidate:** `web-tree-sitter` with packaged WASM grammars. If it creates unacceptable startup, packaging, compatibility, or performance issues, evaluate the official Node.js binding behind the same internal adapter. No core module may depend directly on binding-specific parser objects.

### 4.5 TypeScript semantic analysis decision gate

Tree-sitter should handle syntax-driven extraction and explicitly declared shapes first. If the POC shows important gaps—for example, imported aliases or types routed through common helpers—the TypeScript ecosystem may gain a **TypeScript-specific semantic adapter**. That adapter can evaluate the TypeScript Compiler API or `ts-morph`, but only behind a stable interface.

Do not make the shared core depend on the TypeScript Compiler API. Do not require every future language to use the TypeScript semantic stack. Do not add a second parsing flow pre-emptively. Add deeper semantic analysis only to close evidenced gaps, and preserve the provenance of the evidence it contributes.

---

## 5. Supported Technical Scope

### 5.1 Initial vertical slice

The first end-to-end implementation will focus on a realistic JavaScript/TypeScript web application with a React frontend and an Express backend.

**Source files in the first supported slice:**

- `.js` and `.jsx`
- `.ts` and `.tsx`

**Initial frontend observations:**

- `fetch()` calls with statically discoverable URLs;
- common Axios method calls such as `axios.get`, `axios.post`, `axios.put`, `axios.patch`, `axios.delete`, and equivalent simple configured-client patterns only where explicitly supported;
- statically discoverable HTTP method, route, and request payload;
- explicitly declared TypeScript interfaces, type aliases, generic response annotations, and inline object shapes where local syntax/reference resolution can support them;
- direct response parsing and common result annotations, when evidence is available.

**Initial backend observations:**

- Express route registrations with statically discoverable path and method, including `app.get`, `app.post`, `app.put`, `app.patch`, `app.delete`, and equivalent `router` patterns;
- route handler source locations;
- direct response shapes such as a statically visible object passed to `res.json()` / supported response methods;
- explicit request/response/type annotations where supported;
- simple router-prefix composition only when deterministically resolvable.

The exact set of accepted code patterns is maintained in a support matrix and backed by fixtures. A pattern is not considered supported merely because it is syntactically valid JavaScript/TypeScript.

### 5.2 Initial drift categories

Prioritize checks that can be made with defensible evidence:

1. Consumer has no compatible provider discovered in scope.
2. Provider has no known consumer discovered in scope.
3. Route or HTTP method mismatch when there is sufficient evidence to relate the observations.
4. Request body/field mismatch for statically discovered shapes.
5. Response field, nesting, or type mismatch for statically discovered shapes.
6. Explicit field type, optionality, or nullability mismatch when the relevant declarations are known.
7. Unsupported/dynamic patterns that could affect completeness, reported as an analysis limitation rather than confidently mislabeled as drift.

Do not assert a backend route is globally unused. The accurate term is **“no known consumer in the analyzed scope.”** External consumers, dynamic clients, generated SDKs, and other repositories may exist.

### 5.3 Deliberately deferred

The following are not required to demonstrate the first useful API workflow:

- Prisma/database schema analysis;
- universal language or framework support;
- deep inference through arbitrary helper functions, reflection, callbacks, or runtime values;
- arbitrary custom API-client configuration;
- full OpenAPI/specification ingestion;
- runtime request interception/traffic collection;
- multi-repository/multi-service correlation;
- graph database or server storage;
- CLI, Git hook, commit, and CI workflows;
- AI-powered code generation or required external model API calls.

Prisma can be added as another extractor/evidence provider later. It must feed the shared contract model and must not cause a separate drift engine to be built.

---

## 6. System Architecture

### 6.1 High-level component view

```text
┌─────────────────────────────────────────────────────────────┐
│                  VS Code Extension (host)                    │
│ Activation, workspace events, UI, diagnostics, code actions  │
└──────────────────────────────┬──────────────────────────────┘
                               │ calls shared analysis interface
┌──────────────────────────────▼──────────────────────────────┐
│                  UNDRIFT Analysis Orchestrator                │
│ Debounce, revisions, cancellation, phase coordination        │
└───────────────┬──────────────────────┬───────────────────────┘
                │                      │
┌───────────────▼──────────────┐  ┌────▼──────────────────────┐
│ Tree-sitter Parsing Adapter  │  │ Language/Framework       │
│ grammar loading, parse tree, │  │ Extractors               │
│ spans, parse errors          │  │ JS/TS consumers, Express │
└───────────────┬──────────────┘  └────┬──────────────────────┘
                └──────────────┬───────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Normalized Evidence Model                    │
│ endpoints, shapes, types, source spans, provenance, confidence│
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Language-neutral Core                    │
│ normalization → candidate matching → compatibility rules     │
│ drift findings → explanation data → fix proposals → report   │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Extension Presentation                     │
│ Diagnostics, sidebar/report, hover, commands, code actions   │
└─────────────────────────────────────────────────────────────┘
```

The drawing is a logical boundary diagram, not a requirement to split every box into a separately published package. Keep initial implementation simple while preserving the dependency direction.

### 6.2 Logical layers

**Editor adapter:** translates VS Code events, document buffers, positions, commands, and user decisions into analysis requests. It translates findings back into VS Code UI primitives. It contains no contract comparison rules.

**Analysis orchestrator:** coordinates workspace scanning, cancellation, revision IDs, changed-file invalidation, extraction and core analysis. Its interface is reusable outside VS Code.

**Parser adapter:** owns Tree-sitter initialization, grammar loading, parse-tree lifetime, syntax node access, parse errors, and source-range conversion. It hides all binding-specific objects from other modules.

**Language/framework extractors:** recognize supported constructs such as frontend API calls, type declarations, Express routes, and response bodies. Each extractor emits normalized observations with explicit provenance and extraction limitations.

**Optional semantic resolver:** provides extra evidence where syntax-only extraction is insufficient. It is not assumed to exist for every language and its outputs must be distinguishable from direct syntactic evidence.

**Language-neutral core:** owns normalized contracts, matching, compatibility rules, drift status, confidence policy, findings, fix-proposal contracts, and report generation. It does not import VS Code, Tree-sitter, React, Express, Prisma, or a language compiler package.

**Fix application adapter:** converts an accepted fix proposal into native workspace edits. The core proposes structured changes; the extension applies them only after user review/approval and then re-runs analysis.

### 6.3 Dependency rules

Allowed direction:

- `apps/vscode-extension` → `core`, parser adapter, supported analyzers, and extension-specific UI modules;
- language/framework analyzers → `core` domain contracts and parser adapter;
- parser adapter → Tree-sitter binding and pinned grammars;
- `core` → TypeScript standard library and its own domain modules only.

Forbidden coupling:

- `core` importing `vscode`;
- `core` importing `tree-sitter`, `web-tree-sitter`, React, Express, Prisma, or the TypeScript Compiler API;
- editor UI directly walking syntax trees or implementing duplicate drift rules;
- one language adapter depending on another language's compiler implementation to produce the normalized model;
- code-action UI independently recomputing whether a finding is valid.

---

## 7. Monorepo and Package Layout

Use the existing repository as the starting point and evolve it into the following logical structure. Do not create every future package before there is an implementation that needs it.

```text
undrift/
├── apps/
│   └── vscode-extension/
│       ├── src/
│       │   ├── commands/
│       │   ├── providers/
│       │   ├── views/
│       │   ├── services/
│       │   └── extension.ts
│       ├── package.json
│       └── esbuild.config.mjs
│
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   ├── normalize/
│   │   │   ├── match/
│   │   │   ├── drift/
│   │   │   ├── fixes/
│   │   │   ├── report/
│   │   │   ├── engine/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── parser-tree-sitter/
│   │   ├── src/
│   │   │   ├── parserManager.ts
│   │   │   ├── grammarRegistry.ts
│   │   │   ├── parsedDocument.ts
│   │   │   └── sourcePositions.ts
│   │   └── package.json
│   │
│   └── analyzer-typescript/
│       ├── src/
│       │   ├── frontend/
│       │   ├── backend-express/
│       │   ├── types/
│       │   ├── supportMatrix.ts
│       │   └── index.ts
│       └── package.json
│
├── tests/
│   ├── fixtures/
│   ├── scenarios/
│   └── extension/
├── examples/
├── docs/
├── package.json
├── package-lock.json
├── tsconfig.base.json
└── eslint.config.js
```

### 7.1 Package ownership

`@undrift/core` owns the language-neutral domain model, compatibility model, drift classification, finding aggregation, fix proposal interfaces, and report representation. It should be importable by future consumers that do not run inside VS Code.

`@undrift/parser-tree-sitter` owns binding initialization and parse-tree wrappers. It exposes stable internal abstractions such as `ParsedDocument`, `SyntaxNodeView`, `SourceSpan`, and parse warnings rather than exposing raw binding-specific types to analyzers.

`@undrift/analyzer-typescript` owns JavaScript/TypeScript syntax extraction, import/type declaration indexing where supported, frontend API call extractors, Express route extractors, and support/limitation reporting. It may depend on the parser adapter and core model.

`apps/vscode-extension` composes the adapters, handles editor/workspace events, renders results, and applies reviewed edits. Future CLI integration should be a consumer of the same core and analyzer interfaces.

An optional TypeScript semantic adapter MUST NOT be created unless the POC demonstrates a need. If added, it should be a separate optional package/module with its own tests.

### 7.2 Package management and build

- Use npm workspaces for local package linking and a single `package-lock.json`.
- Internal imports should use stable package exports rather than deep relative imports across package boundaries.
- Bundle extension code with esbuild, and ensure required grammar/WASM assets are included and resolvable in the packaged extension.
- Keep `vscode` as an external module; VS Code supplies it at runtime.
- Type-check the workspace independently of the bundling step.
- The final packaged extension must be tested from its built artifact, not only through the development host.

---

## 8. Parser and Language-Adapter Requirements

### 8.1 Parser abstraction

The parser package MUST expose a small internal API with these capabilities:

- initialize the Tree-sitter runtime once per extension process;
- load and cache the required language grammar once available;
- choose a grammar based on file type and configured support;
- parse a source string/document into a `ParsedDocument`;
- support reparsing a changed document, using incremental edits when the selected binding makes this practical;
- expose syntax node kind, named children, relevant fields, byte offsets, and row/column source positions through wrapper methods;
- report error/missing nodes without failing the entire workspace scan;
- release parser/tree resources when appropriate;
- avoid leaking raw Tree-sitter objects beyond the parser adapter.

The parser is responsible for understanding syntax, not for deciding whether a route is compatible with a frontend consumer.

### 8.2 Grammar registry

The grammar registry will map supported source types to compatible language grammars, for example:

| Extension | Initial grammar role |
|---|---|
| `.js` | JavaScript |
| `.jsx` | JavaScript grammar with JSX support, where provided by the selected grammar package |
| `.ts` | TypeScript |
| `.tsx` | TSX grammar |

The exact grammar artifacts, generated WASM filenames, and versions must be verified in the POC and checked into reproducible dependency/build configuration. Do not fetch grammar binaries dynamically at runtime from the network.

### 8.3 Language adapter contract

Every language analyzer SHOULD implement a contract equivalent to:

```ts
interface LanguageAnalyzer {
  id: string;
  supportedLanguageIds: string[];
  supportedPatterns(): SupportPattern[];
  analyzeDocument(input: AnalyzerInput): Promise<AnalyzerOutput>;
}
```

This is illustrative, not the final LLD interface. `AnalyzerOutput` must contain observations and warnings, not editor-specific Diagnostics. `SupportPattern` metadata should let the report explain which patterns are recognized and where coverage is incomplete.

### 8.4 Normalized evidence

A source extractor should produce facts in a normalized language-neutral shape, such as:

- observation identity and kind;
- normalized HTTP method/path when applicable;
- consumer/provider role;
- available request/response shape;
- field names, known types, required/optional/nullability signals;
- source span(s);
- provenance explaining whether the fact came from literal syntax, explicit annotation, local declaration resolution, framework rule, config, or optional semantic resolution;
- confidence/strength and unresolved references;
- limitations and warnings.

Unknown is not a substitute for null, optional, or absent. Those are different states and MUST remain distinct in the model.

### 8.5 Adding a language later

To add a language, implement and test:

1. grammar loading and file-type registration;
2. source and position handling;
3. language-specific consumer/provider extraction;
4. framework- or protocol-specific extractors as applicable;
5. reference/type resolution for the supported patterns;
6. mapping into existing normalized evidence contracts;
7. support matrix and analysis warnings;
8. fixtures for valid, broken, and ambiguous integrations.

Existing matching, drift classification, report UI, source evidence model, and fix review flow should remain reusable. Adding a grammar by itself does not constitute language support.

---

## 9. Contract Normalization and Matching

### 9.1 Pipeline stages

The analysis pipeline SHOULD execute in this order:

1. **Discover project scope:** identify workspace roots and relevant source files while excluding generated/vendor/dependency output by default.
2. **Load document content:** prefer current editor buffers for open documents; use disk content otherwise.
3. **Parse:** obtain syntax trees and parse warnings.
4. **Extract observations:** run registered source/framework extractors.
5. **Resolve supported local references:** resolve simple/imported declarations where the implementation can do so deterministically; unresolved references remain explicit.
6. **Normalize:** canonicalize HTTP methods, route parameter notation, available schema fields, type names, optionality, nullability, and source evidence.
7. **Create candidate relationships:** compare consumer/provider candidates based on route and protocol evidence.
8. **Classify compatibility:** run deterministic drift rules on related observations.
9. **Build findings and explanations:** produce findings with expected/actual data and both source sides where known.
10. **Produce repair proposals:** offer only supported, evidence-backed edit plans.
11. **Render report/diagnostics:** translate findings into the IDE's UI model.

Each stage should be testable without VS Code.

### 9.2 Normalization rules

- HTTP methods are case-normalized to the supported canonical representation.
- Route paths are normalized without silently removing meaningful segments.
- Parameter placeholders such as Express `:id` and equivalent known forms may normalize to a common parameter token when the equivalence is unambiguous.
- Trailing slash, query string, base-path, router-mount, URL-prefix and API-version behavior must be explicitly defined and tested; do not apply broad string heuristics that can match unrelated routes.
- Route joins must retain evidence of mounted prefixes and configuration used to derive the final path.
- Type normalization must preserve distinctions between `unknown`, unresolved, optional, nullable, union, array, object, and absent.
- Field names must not be automatically converted between snake_case and camelCase as if their shapes were identical unless an explicit mapping or a supported serializer/mapping rule provides evidence.
- Schema depth limits, if necessary, must be visible as analysis limits rather than silently truncating with a full-confidence claim.

### 9.3 Matching approach

Candidate matching should be evidence-first and staged:

1. strong exact match on normalized method and path;
2. route candidates with the same path but conflicting methods;
3. route candidates with plausible path differences only when supporting evidence exists, such as a unique adjacent declaration or an explicitly configured mapping;
4. request/response shape comparison after a candidate relationship is sufficiently supported.

Do not pair every frontend and backend route with a similar string. Weak candidates should be reported as possible relationships or unresolved candidates, not definitive drift.

### 9.4 Compatibility rules

The first rules include:

- missing provider with no compatible route discovered;
- provider with no known consumer;
- method mismatch for a supported, evidenced candidate;
- missing/extra field only where the compared request/response contract is sufficiently known;
- incompatible field type when both sides' types are known enough to compare;
- optionality/nullability mismatch where declarations provide those semantics;
- nested object incompatibility within a defined supported depth;
- unresolved/unsupported pattern warning.

A missing field inferred from an incomplete response observation must not be presented as proof that the runtime response never contains the field. Findings should communicate the evidence boundary.

### 9.5 Confidence and status

Confidence should be derived from evidence, not a hand-tuned score presented as scientific certainty. A rule can use evidence classes such as:

- **Direct:** literal route/method/object or direct explicit declaration;
- **Resolved:** reference traced through supported local/imported declarations or framework composition;
- **Inferred:** candidate relationship based on weaker structural evidence;
- **Unknown:** insufficient information.

Initially, deterministic high-confidence findings should be surfaced as actionable. Lower-confidence observations should remain qualified or be withheld from noisy default diagnostics. Thresholds should be tuned on the labeled fixture suite.

Contract/finding state should distinguish at least: discovered, waiting, matched-but-unverified, verified for supported checks, drifted, no-known-consumer, ignored/suppressed, and unresolved. A repair must not count as resolved until re-analysis confirms it.

---

## 10. Semantic Resolution Strategy

### 10.1 Deterministic first

UNDRIFT should extract direct syntax and explicit declarations first. Do not use an LLM for routine route matching or direct field comparisons. The initial release must work without network calls, model access, or API keys.

### 10.2 TypeScript-specific semantic adapter

Tree-sitter syntax nodes and local type-declaration indexing may be sufficient for many cases, but not for all imported types, aliases, inferred values, overloads, generic transformations, or helper-driven responses.

The analysis interfaces SHOULD allow an optional semantic provider to enrich evidence with:

- import/symbol resolution;
- alias and interface resolution;
- explicit and inferred TypeScript type information where reliable;
- source provenance for the resolved symbol/type;
- an unresolved result when resolution is unavailable or ambiguous.

The TypeScript Compiler API and `ts-morph` are candidates for that optional adapter, not dependencies of the shared core. The POC must decide whether either is justified for the first vertical slice. Avoid committing to both.

### 10.3 Cross-language semantic neutrality

Normalized core types must not embed raw TypeScript compiler types or TypeScript-only object instances. A Python or Go adapter should be able to provide comparable evidence through its own resolver. If a language lacks semantic information, the core should still be able to perform syntax-supported checks and clearly mark the missing evidence.

### 10.4 LLMs and remote services

No remote LLM or external API is required by V0/V1. A future optional semantic assistant may be evaluated, but it must not silently send proprietary source code externally, must disclose what data is transmitted, must operate behind a user-controlled configuration, and must never be the sole authority for applying source changes.

---

## 11. Workspace Discovery and Incremental Analysis

### 11.1 Workspace scope

The extension MUST analyze only the explicitly opened workspace/folders and supported source patterns. It should respect VS Code workspace exclusions and an UNDRIFT-specific exclusion/suppression configuration where required.

By default, exclude or ignore generated/dependency/build folders such as `node_modules`, `.git`, common build output, coverage output, and tool cache folders. Do not assume these names cover every project; allow the configuration to add exclusions. Generated code should be excluded from automatic fixes unless explicitly enabled.

### 11.2 Open-document overlays

For an open document, the current in-memory VS Code document text takes precedence over the on-disk version. The analysis revision must track document versions so a late-running analysis cannot overwrite newer results with stale results.

### 11.3 Initial and changed-file analysis

The first scan may analyze the relevant workspace scope. Subsequent edits SHOULD:

- debounce bursts of editor events;
- cancel obsolete jobs where cancellation is practical;
- reparse the changed document incrementally where supported by the binding;
- invalidate observations extracted from the prior document version;
- recompute relationships/findings involving changed observations;
- fall back to a scoped/full re-analysis when dependencies are uncertain.

Do not claim complete dependency-aware incremental analysis until it is implemented and measured. A correct scoped full scan is preferable to an incomplete stale result.

### 11.4 Background execution

Analysis MUST NOT synchronously block normal editor input. Expensive workspace work should run asynchronously and yield/cancel where practical. A worker thread or separate process is a future optimization if measurements show it is needed; do not add a language server or process protocol before profiling.

### 11.5 Revisions and stale results

Every analysis run should have a monotonically increasing revision/generation ID. The UI should apply results only if they correspond to the latest valid workspace/document state. When the workspace changes during analysis, mark or discard stale results and schedule a fresh run.

### 11.6 Initial provisional performance goals

These are acceptance targets to benchmark, not measured guarantees:

- editor input remains responsive during analysis;
- repeated changes to one file do not trigger an unbounded queue of full scans;
- common single-file edits produce updated findings promptly after a short debounce;
- a small sample application reaches a first useful report without an excessive cold-start delay;
- memory usage does not grow continuously across repeated edits/re-analysis.

The proof of concept should record cold-start time, parse time, extraction time, matching time, incremental-edit latency, fixture count, and peak/steady memory on a documented sample repository. Set firm numeric budgets after observing the baseline.

---

## 12. VS Code Integration Requirements

### 12.1 Extension contribution points

The extension should expose:

- a sidebar or activity entry for UNDRIFT;
- a tree/list of findings grouped by category or severity;
- an integration report/webview where helpful;
- native diagnostics for actionable findings;
- hover or detail views for expected/actual values and provenance;
- code actions/Quick Fixes for supported repair proposals;
- explicit commands to analyze/refresh, open the report, explain a finding, and verify after a change;
- a status item showing overall state without continuous interruption;
- an Output Channel for diagnostic logs and analysis warnings.

Exact icons, names, and presentation details belong in the design/UI work and must not change core result semantics.

### 12.2 Diagnostics

Diagnostics must include stable codes/rule identifiers, severity, source range, and a concise message. Diagnostic details should link to the corresponding normalized finding. Diagnostics should be updated/cleared when the finding changes or disappears.

Use separate language-analysis warnings for incomplete/unsupported patterns rather than representing every unknown as an error. Avoid warning spam from syntax-error nodes during normal typing.

### 12.3 Findings report

A finding should provide, where available:

- finding category and confidence/evidence class;
- affected consumer and provider source references;
- expected versus observed route, method, or field information;
- reason the values are considered incompatible;
- likely impact, carefully distinguished from guaranteed runtime behavior;
- analysis limitations or unresolved references;
- available fix proposals and risk classification;
- current resolution state.

### 12.4 Fix application

The core returns a `FixProposal` containing a stable proposal ID, explanation, evidence references, risk level, affected files, and version-aware edit intent. The VS Code adapter translates an accepted proposal into native `WorkspaceEdit` operations.

Before applying a proposal, verify that the source documents still match the assumptions or source versions used to create it. If relevant content has changed, invalidate the proposal and ask the user to re-analyze. Apply only edits that have been reviewed/accepted according to the interaction. Re-run the relevant analysis after applying and update the finding based on actual results.

The first release should prefer localized mechanical edits. A route mismatch may have no obvious correct side; the extension must not choose the source of truth without evidence or explicit developer direction.

### 12.5 Notifications

Use passive status and contextual diagnostics by default. Avoid repeated popups for an unchanged finding. Notifications should be reserved for useful, high-confidence, actionable events and should be configurable. No notification should suggest certainty beyond the evidence.

---

## 13. Domain Contracts and Data Model Requirements

The final TypeScript interfaces belong in the LLD; this section states required semantics.

### 13.1 Source span

Every source-backed fact should carry a source span with URI/path, start/end positions, and enough information to map back to the current document version. Store byte offsets internally where required by Tree-sitter, but expose positions compatible with VS Code's UTF-16 line/character model through a tested conversion layer. Include a document version/content hash when proposals must be invalidated after edits.

### 13.2 Observation

An observation is a fact extracted from a source or config file. It is not yet a confirmed contract match. The model should include:

- stable ID or stable identity basis;
- language, framework, extractor/rule ID;
- observation role (consumer/provider/type/schema/transformation etc.);
- available route/method/request/response data;
- source span(s);
- provenance/evidence class;
- unresolved symbol/route details;
- warnings and known extraction limitations.

### 13.3 Normalized contract

The contract model must support request and response shapes without storing raw parser nodes. Type/shape representations should support primitive, object, array, union, reference, unknown/unresolved, optionality, and nullability where evidence makes those distinctions available.

A normalized field type MUST distinguish:

- field absent from an extracted shape;
- field declared optional;
- field allowed to be null;
- type not known;
- type reference unresolved;
- type known but too complex for the supported comparison.

These states have different diagnostic meaning.

### 13.4 Finding

A finding must have a stable rule/category identifier, summary, detailed explanation data, severity, evidence class/confidence, affected observation/contract IDs, expected/actual information, source spans, current state, and zero or more fix proposals. The core should not manufacture a path to the source side when it has not been located.

### 13.5 Fix proposal

A proposal should be represented as structured, version-aware edits rather than arbitrary imperative code. It should contain risk classification (for example safe/mechanical, requires review, manual/no automatic edit), reason, edit spans, replacement content, affected documents, and assumptions. The extension owns the act of editing; the core owns proposal generation.

### 13.6 Stable identities

IDs must not rely solely on array order or run-time object identity. Prefer source-derived deterministic keys and stable rule identifiers. When a relationship changes materially, it is acceptable for its derived ID to change; the implementation should avoid avoidable flicker for unchanged findings.

---

## 14. Configuration and Suppression

V0 may start with minimal VS Code settings. Before broader V1 use, UNDRIFT SHOULD support versioned project-level configuration for include/exclude paths, enabled analyzers/rules, and intentional exceptions.

The configuration format should be:

- local and readable;
- schema-validated and versioned;
- safe to share in a repository;
- explicit about which rule/relationship is suppressed and why;
- able to express a known transformation/mapping only where the evidence format is defined;
- tolerant of unknown future fields where practical, with clear warnings for invalid configuration.

Do not hard-code one source of truth for every contract. A project may explicitly nominate a schema/specification or a side of the implementation as authoritative for selected relationships. Source-of-truth policies must be scoped and visible.

The exact filename and schema are LLD-level decisions; an initial `.undrift/` project configuration directory is a candidate, not a final commitment in this version of the TRD.

---

## 15. Privacy, Security, and Resilience

### 15.1 Local-first operation

- Source analysis runs locally by default.
- No source code or derived contract data is uploaded to a hosted service in V0/V1.
- No external account or API key is required.
- No required telemetry is sent.
- Analysis should function offline after the extension package and required parser assets have been installed.

### 15.2 File handling

- Read only within the open workspace and necessary extension-owned resources.
- Respect workspace exclusions and configured ignore patterns.
- Avoid parsing binary, oversized, generated, or unsupported files unless explicitly requested.
- Do not execute workspace code, run package scripts, or start application services as part of static analysis.
- Do not follow arbitrary filesystem paths discovered in source comments/config without validating that they remain within the allowed workspace scope.

### 15.3 Fix safety

- Never modify source without developer approval.
- Validate source ranges and document revisions before applying edits.
- Do not overwrite a file based on stale source offsets.
- Ensure multi-file edits are reviewable and are applied through the editor API.
- After an edit, re-analyze and show remaining mismatches or failed verification; do not imply the fix succeeded merely because the write completed.

### 15.4 Failure isolation

A parser failure, unexpected syntax node, missing grammar, unsupported pattern, or malformed project configuration must not crash the whole extension. Return an analysis warning for the affected file/pattern and continue where possible. Internal exceptions should be logged to the Output Channel without dumping full source text by default.

### 15.5 Dependency and supply-chain hygiene

Pin and review parser/grammar versions together. Keep grammar artifacts reproducibly sourced and packaged. Avoid runtime downloads of native binaries or grammars. Audit dependency licenses and update cadence before public release; preserve a lockfile and run tests after parser/grammar updates.

---

## 16. Error Handling and Observability

Internal analysis errors should use structured error codes and contextual metadata such as phase, file, extractor, and revision. Do not expose stack traces in ordinary diagnostics. The developer should be able to see relevant warnings in the report/output channel.

Logging SHOULD record:

- analysis start/completion and revision ID;
- counts of files parsed, observations extracted, relationships considered, findings produced, and warnings;
- phase duration and cancellation reason;
- parser/grammar initialization failures;
- extractor exceptions and invalid configuration.

Logging SHOULD NOT record source bodies, request payload samples, secrets, environment values, or entire paths outside the workspace. Source text must not be included in telemetry because telemetry is not part of the initial product.

The extension should distinguish “no drift found” from “analysis was incomplete” or “no supported patterns were discovered.” An empty report must not imply complete coverage when the scanner skipped relevant files or encountered unresolved constructs.

---

## 17. Testing Strategy

Trustworthy analysis requires measuring both detection and non-detection. A fixture corpus must include positive findings, valid relationships, and ambiguous/unsupported patterns.

### 17.1 Unit tests

Test language-neutral logic independently:

- route canonicalization;
- path-parameter normalization;
- request/response shape comparison;
- type/optionality/nullability comparisons;
- match candidate ranking and unresolved states;
- finding creation and stable IDs;
- severity/confidence policy;
- fix proposal validation and stale edit rejection;
- report summaries and state transitions.

### 17.2 Parser and extractor tests

Use source snippets/files to test:

- JavaScript, JSX, TypeScript, and TSX parsing;
- partially typed/incomplete code and parser error nodes;
- direct `fetch` and supported Axios patterns;
- direct Express `app` and `router` route declarations;
- router prefix composition where supported;
- direct request/response literals;
- explicitly declared interface/type aliases;
- supported imports/local type references;
- helper/wrapper cases the product claims to support;
- dynamic routes, unresolved references, custom clients, and unsupported syntax as warnings rather than invented facts;
- Unicode characters and source-position conversion to VS Code ranges.

### 17.3 Scenario fixtures

Each scenario should label the expected outcome and what should *not* be reported. Include at minimum:

1. exact compatible frontend/backend endpoint;
2. missing provider;
3. provider with no known in-scope consumer;
4. method mismatch;
5. route mismatch with strong and weak candidate evidence;
6. missing response field;
7. request body mismatch;
8. explicit field type mismatch;
9. optionality/nullability mismatch;
10. nested object mismatch;
11. intentional snake_case-to-camelCase mapping;
12. hardcoded/mock frontend data that cannot yet be tied to a provider;
13. route behind a supported router prefix;
14. route/call built dynamically and intentionally left unresolved;
15. type imported from another file;
16. response assembled through a helper outside supported data-flow coverage;
17. syntax error in an unrelated file;
18. ignored/generated file;
19. stale result from an earlier document version;
20. fix proposal invalidated because source changed before application.

### 17.4 Extension-host tests

Verify extension activation, command registration, diagnostics lifecycle, sidebar/report updates, cancellation/stale-result behavior, code-action availability, accepted edits, and re-analysis after edits. Test against the declared minimum VS Code version and a current stable version before release.

### 17.5 Quality metrics

Track true positives, false positives, missed seeded drift, unsupported-pattern reporting, source-span accuracy, fix acceptance/verification results, and runtime performance by fixture group. The target is trustworthy findings, not maximum findings.

### 17.6 Build checks

CI should run:

- install from lockfile;
- lint/format checks;
- TypeScript type-checking;
- unit/fixture tests;
- extension-host tests;
- production bundle/package validation;
- artifact inspection to ensure grammars/WASM assets are present and load correctly.

---

## 18. Build, Release, and Versioning

### 18.1 Development scripts

The repository should expose consistent root scripts equivalent to:

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:extension`
- `npm run package`

Names may be adjusted to the scaffold, but the same checks must remain easy to run locally and in CI.

### 18.2 Version compatibility

- Pin compatible Tree-sitter runtime and grammar versions.
- Treat grammar/runtime updates as potentially behavior-changing and run the full fixture suite.
- Document the minimum VS Code version and supported extension host.
- Keep internal package versions coordinated in the monorepo.
- Use semantic versioning for public releases after the project reaches public preview.

### 18.3 Packaging checks

The packaged `.vsix` must include compiled extension code, required Tree-sitter runtime and grammar assets, license notices where required, and all assets expected at runtime. It must exclude development-only tests/source where appropriate, secrets, local logs, and fixtures not intended for distribution. Validate actual extension installation and parser initialization from the package, not only via a dev-host launch.

### 18.4 Release readiness

Do not publish broadly until:

- the project and extension identifiers are checked for collisions;
- license and dependency notices are reviewed;
- supported patterns and limitations are documented;
- the fixture suite passes;
- false-positive behavior is acceptable on at least one representative real project;
- local-only behavior is confirmed;
- the packaged extension works on the supported OS/VS Code matrix.

---

## 19. Non-Functional Requirements

### 19.1 Correctness and trust

Correctness takes precedence over breadth. The tool should report uncertainty rather than overstate certainty. A finding must be traceable to evidence and a rule. Re-analysis must be the authority for whether a finding is resolved.

### 19.2 Performance

Analysis is asynchronous and cancellation-aware. It must not block editor input, repeatedly analyze the entire workspace for every keystroke, or leak memory across edits. Numeric targets will be finalized from the initial benchmark rather than invented before measurement.

### 19.3 Portability

The core and normalized model must not depend on one language compiler or one editor. The first deployment is VS Code's Node.js extension host. Cross-platform packaging of parser assets is a required POC verification.

### 19.4 Maintainability

Keep core domain logic free of presentation and parser specifics. Use explicit module interfaces, unit-testable deterministic rules, fixture-driven extractor tests, and a documented support matrix.

### 19.5 Extensibility

A new language should be introduced as a parser/grammar plus analyzer adapters and evidence resolution, reusing the same normalized model and core drift workflow. Shared core changes may be necessary for genuinely new contract concepts, but routine language additions must not fork the engine.

### 19.6 Privacy

The initial release analyzes locally. It does not require an account, backend, database, API key, telemetry, or source-code upload.

### 19.7 Usability

Findings should be contextual and non-spammy, source references should navigate to the correct location, explanations should show expected/actual values where available, and fixes must be reviewable.

---

## 20. Proof-of-Concept Plan and Exit Gates

The POC is a required engineering step before treating the parser binding and semantic-resolution depth as implementation-final.

### POC-A: Tree-sitter runtime/packaging

Prove the selected binding and TypeScript/TSX grammars load from the VS Code development host and from the bundled extension. Measure cold initialization, parse latency, package size, source-position conversion, syntax error recovery, and incremental edit behavior.

**Pass condition:** reproducible cross-platform grammar loading and acceptable responsiveness with no binding-specific objects escaping the adapter.

### POC-B: Syntax extraction and contracts

On a small React/TypeScript + Express sample, discover direct frontend calls and backend routes, extract direct/static request/response shapes and explicit type declarations, normalize and match them, and produce source-linked findings.

**Pass condition:** all explicitly supported fixture scenarios behave as labeled; unsupported/dynamic cases produce warnings or qualified results rather than confidently incorrect findings.

### POC-C: Semantic-resolution gap

Test imported type aliases, local helper-return types, router prefixes, shared API client wrappers, and explicit generic response annotations. Count which important cases Tree-sitter plus a local declaration index can resolve and which require the TypeScript Compiler API or `ts-morph`.

**Pass condition:** make a documented decision whether the first release needs an optional TypeScript semantic adapter, and define the smallest supported scope. Do not add the resolver merely because it is available.

### POC-D: Repair and reverification

Create at least one safe deterministic fix path, apply it through a native workspace edit, and run analysis again. Change the source between proposal generation and acceptance to verify stale proposals are rejected.

**Pass condition:** a fix is never applied against stale spans, and the UI treats successful re-analysis—not edit application alone—as proof of resolution.

### POC-E: Incremental behavior

Change one route/type source file while analysis is running, and verify old results cannot overwrite new results. Measure whether changed-file parsing and bounded recomputation are useful compared with scoped full re-analysis.

**Pass condition:** no stale result is rendered as current; the implementation can fall back to a correct scan when it cannot determine the affected dependency set.

---

## 21. Implementation Sequence

### Phase 1 — Repository and parser foundation

- Confirm current scaffold and workspace package boundaries.
- Set npm workspaces, strict TypeScript checking, linting, tests, and CI scripts.
- Implement Tree-sitter binding and grammar loading behind an adapter.
- Build parser fixtures and source-position conversion tests.

### Phase 2 — Initial analyzers

- Implement source discovery and supported-file filtering.
- Implement frontend `fetch`/Axios patterns in the support matrix.
- Implement Express route patterns.
- Extract literal routes/methods and supported request/response shapes.
- Emit provenance-rich observations and unresolved-pattern warnings.

### Phase 3 — Shared contract engine

- Implement canonicalization and normalized shape model.
- Build candidate relationship matching.
- Implement high-confidence deterministic drift rules.
- Build findings, explanations, report data, and stable identities.

### Phase 4 — VS Code workflow

- Add workspace/document change orchestration and revision control.
- Display diagnostics, findings tree/report, status, hover/details, and explicit commands.
- Connect findings to both source locations.

### Phase 5 — Repair loop

- Implement a small class of safe fix proposals.
- Validate proposal staleness and apply through native workspace edit APIs.
- Re-analyze and update states based on verification.

### Phase 6 — Validation and expansion decision

- Run the labeled fixture suite and test a representative real project.
- Benchmark parser and incremental behavior.
- Decide whether to add deeper TypeScript semantic resolution.
- Fix false positives and document support/limitations before increasing framework scope.

Prisma, multi-language production support, CLI, LSP, and AI assistance are not prerequisites for completing the first full product loop.

---

## 22. Technical Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tree-sitter grammar/binding packaging is harder than expected | Extension fails on some platforms or ships without grammar files | Test the bundled artifact early; pin compatible versions; keep the binding behind an adapter; evaluate the Node binding if WASM packaging is problematic. |
| Syntax parsing is mistaken for semantic analysis | False positives/negatives from imports, aliases, wrappers, inferred types, or dynamic routes | Maintain distinct syntax and optional semantic layers; record provenance; qualify unknowns; gate deeper resolution on POC evidence. |
| New-language design is too generic too early | Slow progress without useful first support | Implement TypeScript/Express deeply enough to validate interfaces; keep interfaces modest and evolve from actual adapters. |
| False positives undermine trust | Developers ignore/disable findings | Test intentional transformations and ambiguous routes; require evidence-backed matching; support suppressions; track false-positive rate. |
| Wrong source-of-truth assumption | Proposed fix makes the integration worse | Show both sides; do not infer authority without evidence; use reviewed edits; prefer manual choice for ambiguous route fixes. |
| Full scans degrade editor performance | The extension disrupts normal coding | Debounce, cache, cancel, profile, and fall back to correct scoped scans; use a worker only if measurements justify it. |
| WASM/runtime/grammar version mismatch | Crashes or incorrect syntax tree coverage | Pin compatible versions, test every grammar in CI, and treat upgrades as analyzer behavior changes. |
| Unhandled dynamic behavior | Incomplete analysis is misread as complete | Report unsupported patterns and coverage; distinguish empty findings from incomplete scans. |
| Existing old LLD conflicts with TRD | Implementation drifts to hackathon-era design | Treat this TRD as current; reconcile HLD/LLD after this document is approved. |

---

## 23. Decisions Deferred to HLD/LLD or Later Experiments

The following do not block the architecture decision but must be resolved at the appropriate implementation stage:

1. Exact `web-tree-sitter` and grammar versions; final choice between WebAssembly and Node.js binding after POC-A.
2. Exact TypeScript semantic resolver, if any, after POC-C.
3. Final internal TypeScript interfaces and DTO schemas.
4. Exact route canonicalization rules for nested routers, mount prefixes, base URLs, and URL interpolation.
5. Exact initial list of response methods and Axios/custom-client patterns.
6. Whether supported local/imported type references can be resolved without a compiler-backed semantic adapter.
7. Exact severity/confidence thresholds after fixture benchmarking.
8. Configuration filename/schema and transformation mapping syntax.
9. Final webview/report UI design.
10. Whether any analysis work needs a worker thread after profiling.
11. Numeric performance budgets after baseline measurements.
12. Scope/timing for Prisma, Fastify/NestJS, Python and further languages.
13. CLI, Git hooks, CI, OpenAPI, runtime evidence, LSP and AI assistance.

These deferred details must not be treated as implicit approval to add architecture or dependencies without a use case.

---

## 24. Technical Definition for the Current Phase

The current UNDRIFT technical baseline is:

> **A TypeScript-based, local-first VS Code extension with an editor-independent analysis core, Tree-sitter as the common syntax parser, pluggable JavaScript/TypeScript and Express extractors, a normalized evidence/contract model, deterministic-first drift detection, and reviewable repair proposals followed by re-analysis.**

The architecture is intentionally multi-language-capable, but the first validated vertical slice is JavaScript/TypeScript (including JSX/TSX) frontend clients talking to Node.js/Express APIs. It does not require Prisma, a database, a cloud service, an LLM, or a separate language server.

Tree-sitter is the committed parser strategy. The exact binding and the need for deeper TypeScript semantic analysis are the two primary proof-of-concept gates. They must be resolved through packaging, performance, and correctness evidence—not guesswork.

---

## 25. Reference Documentation

The following upstream documentation informed the technical direction. These references should be rechecked when pinning dependencies or changing the implementation target.

- Tree-sitter introduction, incremental parsing, bindings, and grammar ecosystem: https://github.com/tree-sitter/tree-sitter/blob/master/docs/src/index.md
- Tree-sitter WebAssembly binding and grammar loading: https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- Tree-sitter parser fundamentals: https://tree-sitter.github.io/tree-sitter/using-parsers/
- VS Code extension host and runtime types: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code extension bundling guidance (including esbuild): https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- TypeScript Compiler API overview, for evaluating the optional semantic adapter: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Vitest getting-started guide and runtime prerequisites: https://vitest.dev/guide/

---

**End of TRD — Version 1.0-draft**
