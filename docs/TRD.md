# UNDRIFT — Technical Requirements Document (TRD)

**Document:** TRD.md  
**Project:** UNDRIFT  
**Version:** 0.1 — Hackathon MVP  
**Status:** Technical baseline for implementation  
**Primary Target:** VS Code + React/TypeScript frontend + Node/Express/TypeScript backend  
**Optional Secondary Target:** Prisma schema awareness

---

# 1. Purpose

This document translates the UNDRIFT Product Requirements Document into concrete technical requirements and implementation decisions.

UNDRIFT is a local developer tool composed of:

1. **UNDRIFT Core** — a framework-independent TypeScript analysis engine responsible for extracting, normalizing, matching, and validating application contracts.
2. **UNDRIFT VS Code Extension** — the developer-facing adapter responsible for observing workspace changes and rendering findings through native VS Code experiences.
3. **UNDRIFT CLI** — an optional thin interface over the same Core engine for scans and reports.

The product is intended to run locally and does not require a hosted UNDRIFT service for the hackathon MVP.

IBM Bob 2.0 is a development aid used by the project team during implementation. It is not a runtime dependency or component of UNDRIFT.

---

# 2. Technical Goals

The technical implementation must support the following:

- Discover API consumers from supported frontend TypeScript/TSX source.
- Discover API providers from supported Node.js/Express TypeScript source.
- Optionally discover Prisma data models.
- Normalize frontend and backend observations into a common contract model.
- Match likely consumer/provider pairs.
- Detect predefined classes of contract drift.
- Maintain an in-memory project model during a VS Code session.
- Re-analyze relevant parts of the project after source changes.
- Map findings back to source locations.
- Expose findings through VS Code diagnostics, hover, code actions, and a report.
- Generate structured fix proposals without directly modifying source from Core.
- Allow the extension to apply approved changes through the VS Code workspace editing API.
- Re-run analysis after changes and update the contract state.
- Provide deterministic results for deterministic rules.
- Keep ambiguous semantic matching isolated behind a replaceable resolver interface.

---

# 3. Non-Goals for the Hackathon

The MVP will not attempt to:

- implement a new compiler;
- implement a new language server;
- support every frontend or backend framework;
- support arbitrary programming languages;
- guarantee discovery of dynamically generated endpoints;
- guarantee that an endpoint with no discovered consumer is globally unused;
- provide runtime API interception;
- provide production traffic analysis;
- build a cloud-hosted dashboard;
- require an external database;
- silently modify application source code;
- make an LLM call for every file change;
- replace the native TypeScript language service.

---

# 4. Technology Stack

## 4.1 Core Language

**TypeScript**

Rationale:

- Same language across Core and VS Code extension.
- Strong typing for the contract model.
- Direct access to TypeScript source structure.
- Good fit for React/TSX and Express/TS repositories.
- Simplifies sharing types between Core and extension.

---

## 4.2 Runtime

**Node.js**

UNDRIFT Core will run in Node.js.

The VS Code extension also runs in VS Code's extension host environment and imports the Core package directly for the hackathon MVP.

---

## 4.3 AST Analysis

Primary technology:

**TypeScript Compiler API**

Preferred convenience layer:

**ts-morph**

The extraction layer should parse source structurally rather than relying primarily on regular expressions.

The TypeScript compiler infrastructure provides the AST/type-system foundation; ts-morph exposes a higher-level API for working with projects and source files. The implementation should therefore treat AST nodes and resolved TypeScript symbols as first-class analysis inputs rather than treating files as raw text.

Reference:

https://ts-morph.com/

---

## 4.4 VS Code Integration

**VS Code Extension API**

Primary APIs:

- `workspace.onDidChangeTextDocument`
- `workspace.createFileSystemWatcher`
- `languages.createDiagnosticCollection`
- `languages.registerHoverProvider`
- `languages.registerCodeActionsProvider`
- `languages.registerInlineCompletionItemProvider` — optional
- `window.createTreeView`
- `window.createWebviewPanel`
- `workspace.applyEdit`
- `commands.registerCommand`

Current VS Code APIs provide diagnostics, code-action providers, inline completion providers, TreeViews, Webviews, file watchers, and workspace edit support.

Reference:

https://code.visualstudio.com/api/references/vscode-api

---

## 4.5 Package Management

**npm workspaces**

The repository will use npm workspaces so that:

```text
packages/core
apps/vscode-extension
apps/cli
```

can be developed as linked local packages from one root project.

Reference:

https://docs.npmjs.com/cli/using-npm/workspaces

---

## 4.6 Build Tooling

### Core

TypeScript compiler.

### VS Code Extension

TypeScript bundled with **esbuild**.

Bundling the extension simplifies deployment and reduces runtime module-resolution complexity inside the extension host.

### CLI

TypeScript compiled/bundled according to the same workspace build strategy.

---

## 4.7 Testing

**Vitest**

Used for:

- contract extraction tests;
- normalization tests;
- matcher tests;
- drift rule tests;
- fix proposal tests;
- fixture-based integration tests.

---

## 4.8 Persistence

No external database.

MVP state:

- in-memory during active analysis;
- optional project-local `.undrift/` state for cache/history/debugging.

Example:

```text
.undrift/
├── contracts.json
├── graph.json
└── state.json
```

The exact persistence format is implementation detail and may change during the hackathon.

---

# 5. Repository Architecture

The repository uses a monorepo structure.

```text
undrift/
│
├── apps/
│   ├── vscode-extension/
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── providers/
│   │   │   ├── services/
│   │   │   ├── views/
│   │   │   ├── utils/
│   │   │   └── extension.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── core/
│       ├── src/
│       │   ├── contracts/
│       │   ├── extractors/
│       │   │   ├── frontend/
│       │   │   ├── backend/
│       │   │   └── prisma/
│       │   ├── graph/
│       │   ├── matcher/
│       │   ├── drift/
│       │   ├── fixes/
│       │   ├── workspace/
│       │   ├── semantic/
│       │   ├── store/
│       │   ├── types/
│       │   └── index.ts
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   └── ecommerce-demo/
│
├── tests/
│   ├── fixtures/
│   └── scenarios/
│
├── docs/
│
├── package.json
├── package-lock.json
├── tsconfig.base.json
└── README.md
```

---

# 6. Architectural Layers

The system has five logical layers.

```text
┌───────────────────────────────────────────────────────────┐
│                    VS CODE EXTENSION                      │
│                                                           │
│ Diagnostics │ Hover │ Code Actions │ TreeView │ Webview │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                       CORE API                            │
│                                                           │
│ analyzeWorkspace │ analyzeChanges │ getReport │ getFixes │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                    CONTRACT ENGINE                        │
│                                                           │
│ Extraction → Normalization → Matching → Drift → Fixes    │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                    SOURCE ANALYSIS                         │
│                                                           │
│ TypeScript/TSX AST │ Express AST │ Prisma schema         │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
                        PROJECT FILES
```

---

# 7. Core Module Requirements

## 7.1 Workspace Indexer

Responsible for:

- discovering workspace structure;
- loading relevant `tsconfig.json` files;
- identifying source files;
- classifying frontend/backend/schema files;
- maintaining an in-memory representation of the analyzed workspace.

The indexer should ignore common irrelevant directories, including:

```text
node_modules/
.git/
dist/
build/
coverage/
.cache/
```

unless explicitly configured otherwise.

---

# 8. Contract Extraction

## 8.1 Frontend Extractor

The frontend extractor identifies supported API consumer patterns.

Initial target patterns include:

```ts
fetch("/api/users")
fetch("/api/users", options)

axios.get("/api/users")
axios.post("/api/users", body)

api.get<User>("/api/users")
api.post<LoginResponse>("/api/auth/login", payload)
```

The exact API-client function set may be expanded through an adapter/configuration layer.

### Extraction result

For each consumer, extract where available:

```text
HTTP method
route/path
path parameters
query parameters
request body
request body type
response type
source file
source range
client function
```

---

# 9. Response Type Extraction

Where a response is explicitly typed:

```ts
api.get<User>("/api/users/:id")
```

the extractor should resolve the `User` type.

Supported initial forms:

```ts
interface User { ... }

type User = { ... }

type UserResponse = {...}

z.object({...})
```

Type resolution should use the TypeScript project/type system rather than string parsing where possible.

---

# 10. Backend Extractor

The backend extractor targets Express-style route definitions.

Initial target patterns include:

```ts
router.get("/users/:id", handler)
router.post("/users", handler)
router.put("/users/:id", handler)
router.delete("/users/:id", handler)

app.get("/users", handler)
app.post("/users", handler)
```

The extractor should identify:

```text
HTTP method
route/path
path parameters
request data
response construction
response type information where statically discoverable
source file
source range
```

---

# 11. Request Extraction

For the MVP, request information may be obtained through a combination of:

- inline object literals;
- TypeScript types/interfaces;
- Zod schemas;
- Express request property access;
- validation schema references.

Examples:

```ts
req.body.email
req.body.password
```

may produce:

```text
body:
  email
  password
```

A body validation schema may provide stronger type information.

---

# 12. Response Extraction

Initial response patterns:

```ts
res.json({...})
return res.json({...})
return res.status(200).json({...})
```

The extractor should inspect the response object's shape where statically available.

Example:

```ts
res.json({
  id: user.id,
  user_name: user.userName,
  email: user.email
});
```

Normalized output:

```text
id: unknown/string when resolvable
user_name: unknown/string when resolvable
email: unknown/string when resolvable
```

If a precise type cannot be resolved, the field should retain an `unknown` or `unresolved` representation rather than causing analysis failure.

---

# 13. Prisma Extractor

The Prisma extractor is optional and lower priority than the frontend/backend extractors.

Initial supported input:

```text
prisma/schema.prisma
```

The extractor should identify:

- model names;
- field names;
- field types;
- optional/nullability markers;
- relations;
- enums where practical.

Example:

```prisma
model User {
  id          String  @id
  displayName String?
  email       String
}
```

can produce:

```text
User
 ├── id: string
 ├── displayName: string | null
 └── email: string
```

No live database connection is required for the MVP.

---

# 14. Contract Normalization

Frontend and backend source representations will differ.

The normalizer converts them to a common internal schema.

Example:

```ts
type ApiContract = {
  id: string;

  method: HttpMethod;
  path: NormalizedPath;

  consumer?: ContractEndpoint;
  provider?: ContractEndpoint;

  request?: RequestSchema;
  response?: ResponseSchema;

  sourceLocations: SourceLocation[];

  state: ContractState;
};
```

The normalization layer should eliminate superficial syntax differences.

Example:

```text
/users/:id
/api/users/:id
```

must retain enough information to distinguish an actual route-prefix difference from a normalized project base path where applicable.

---

# 15. Source Locations

Every extracted contract element that can be mapped reliably should retain:

```ts
type SourceLocation = {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
```

This enables the VS Code layer to highlight the correct source.

Source mapping is a first-class requirement rather than an optional convenience.

---

# 16. Contract Matching

Contract matching should happen in ordered stages.

## Stage 1 — Route Candidate Discovery

Candidate pairs are created based primarily on:

```text
HTTP method
normalized route
path parameter structure
```

Example:

```text
Frontend:
GET /users/:id

Backend:
GET /users/:id
```

Candidate match:

```text
MATCH
```

---

## Stage 2 — Request Comparison

Compare:

- path parameters;
- query parameters where discoverable;
- body fields;
- required/optional status;
- types.

---

## Stage 3 — Response Comparison

Compare:

- field presence;
- nested structure;
- field types;
- nullable/optional state.

---

## Stage 4 — Semantic Resolution

Only ambiguous field relationships should reach the semantic resolver.

Example:

```text
userName
user_name
```

or:

```text
displayName
full_name
```

The semantic resolver must be isolated from the deterministic matcher.

---

# 17. Matching Confidence

Matches should carry a confidence level internally.

Example:

```ts
type Confidence = {
  score: number;
  reasons: string[];
};
```

Possible internal ranges:

```text
0.90–1.00   high
0.70–0.89   medium
0.00–0.69   low
```

These thresholds are initial implementation parameters and may be tuned using benchmark fixtures.

Confidence must not be presented as statistical certainty.

---

# 18. Semantic Resolver

The semantic resolver is an extension point.

```ts
interface SemanticResolver {
  resolve(input: SemanticMatchRequest): Promise<SemanticMatchResult>;
}
```

Possible implementations:

```text
HeuristicSemanticResolver
OptionalLLMSemanticResolver
```

The default MVP path should not require an external LLM call for routine analysis.

Initial heuristics may include:

- case normalization;
- camelCase/snake_case normalization;
- tokenization;
- common separator handling;
- exact normalized token comparison;
- safe string similarity.

AI-assisted resolution may be used only for cases that remain ambiguous.

---

# 19. Drift Engine

The drift engine consumes normalized/matched contracts and creates structured findings.

```ts
type Drift = {
  id: string;
  contractId: string;

  type: DriftType;
  severity: DriftSeverity;

  expected: unknown;
  actual: unknown;

  message: string;
  explanation: string;

  locations: SourceLocation[];

  fix?: FixProposal;
};
```

Supported drift types:

```text
missing-endpoint
orphan-endpoint
route-mismatch
method-mismatch
request-mismatch
response-mismatch
type-mismatch
nullability-mismatch
semantic-mismatch
```

---

# 20. Drift Detection Rules

## 20.1 Missing Endpoint

Condition:

```text
consumer exists
AND
no matching provider found
```

Result:

```text
severity = critical
state = waiting/drifted depending on lifecycle context
```

---

## 20.2 Orphan Endpoint

Condition:

```text
provider exists
AND
no known consumer found
```

Result:

```text
severity = info
state = orphaned
```

The system must phrase this as:

> "No known consumer found."

It must not claim:

> "This endpoint is definitely unused."

---

## 20.3 Method Mismatch

Condition:

```text
same/near-matching route
AND
different HTTP method
```

Example:

```text
Frontend:
POST /orders

Backend:
PUT /orders
```

---

## 20.4 Request Mismatch

Examples:

```text
frontend requires email
backend does not consume email

frontend sends customerId
backend expects userId
```

---

## 20.5 Response Mismatch

Examples:

```text
frontend expects userName
backend returns user_name
```

or:

```text
frontend expects avatar
backend omits avatar
```

---

## 20.6 Type Mismatch

Example:

```text
frontend:
price: number

backend:
price: string
```

The finding should identify both locations when possible.

---

## 20.7 Nullability Mismatch

Example:

```text
frontend:
avatar: string

backend:
avatar: string | null
```

---

# 21. Contract Graph

The internal model should represent relationships as a graph.

Example:

```text
Frontend Consumer
       │
       │ CONSUMES
       ▼
API Contract
       │
       │ PROVIDED_BY
       ▼
Backend Provider
       │
       │ READS / WRITES
       ▼
Prisma Model
       │
       ▼
Database Schema
```

The graph is useful for:

- finding affected relationships;
- identifying orphan providers;
- mapping source changes to contracts;
- explaining blast radius;
- future dependency tracing.

---

# 22. Graph Requirements

Nodes should support at least:

```text
FrontendConsumer
BackendProvider
TypeDefinition
SchemaDefinition
DatabaseModel
ApiContract
```

Edges should support at least:

```text
CONSUMES
PROVIDES
EXPECTS
RETURNS
READS_FROM
WRITES_TO
```

The graph implementation may begin as adjacency maps rather than a full graph database.

---

# 23. Fix Engine

The Core shall produce **fix proposals**, not directly edit files.

```ts
type FixProposal = {
  id: string;
  title: string;

  confidence: number;

  explanation: string;

  edits: FileEdit[];

  affectedContracts: string[];
};
```

Example:

```text
title:
Map backend user_name → frontend userName

confidence:
0.96

edits:
[
  {
    file: "src/user/User.ts",
    range: ...,
    replacement: ...
  }
]
```

---

# 24. Fix Safety Levels

## High Confidence

Localized, mechanically safe fix.

Can be exposed as a direct Quick Fix.

## Medium Confidence

Multi-file or semantically inferred fix.

Should require preview/review.

## Low Confidence

No direct automatic fix.

Show explanation and candidate resolution only.

---

# 25. VS Code Extension Architecture

The extension acts as an adapter over UNDRIFT Core.

```text
VS Code API
    │
    ▼
Extension Layer
    │
    ├── Workspace watcher
    ├── Diagnostics provider
    ├── Hover provider
    ├── Code action provider
    ├── TreeView provider
    ├── Report Webview
    └── Commands
    │
    ▼
UNDRIFT Core
```

The extension should not duplicate contract-analysis logic.

---

# 26. Workspace Activation

On activation:

```text
extension activates
        ↓
detect workspace
        ↓
initialize Core
        ↓
load tsconfig/project information
        ↓
perform initial analysis
        ↓
publish diagnostics
        ↓
populate sidebar
```

If the workspace is not supported, the extension should display a clear unsupported-project state rather than failing silently.

---

# 27. File Change Handling

Relevant VS Code events:

```text
workspace.onDidChangeTextDocument
workspace.createFileSystemWatcher
```

Two change classes should be handled:

### Unsaved editor changes

Read content from the active `TextDocument` so the in-memory analysis reflects the editor state.

### Saved filesystem changes

Use the filesystem watcher to detect created/modified/deleted source files.

The extension must avoid running expensive work on every keystroke.

Initial strategy:

```text
document change
      ↓
debounce 500–1000 ms
      ↓
determine relevance
      ↓
re-analyze affected contracts
```

The exact debounce interval is configurable during implementation.

VS Code provides document change events and file system watchers for these integration patterns.  
Reference:

https://code.visualstudio.com/api/references/vscode-api

---

# 28. Incremental Analysis Strategy

The MVP should use a pragmatic hybrid approach.

## Initial workspace load

Perform a complete supported-source analysis.

## Relevant file change

Prefer:

```text
changed file
   ↓
re-extract that file
   ↓
replace its graph nodes
   ↓
re-evaluate affected contract matches
```

A full re-scan may remain as a fallback for correctness.

This allows the prototype to behave live without requiring a fully sophisticated incremental compiler.

---

# 29. VS Code Diagnostics

The extension should use a dedicated diagnostic collection.

Conceptually:

```ts
const collection =
  vscode.languages.createDiagnosticCollection("undrift");
```

Each `Drift` is mapped to one or more diagnostics.

Diagnostics should contain:

```text
severity
message
source = "UNDRIFT"
range
related locations where useful
```

The diagnostic should point to the most actionable source location.

Reference:

https://code.visualstudio.com/api/references/vscode-api

---

# 30. Hover Provider

Hover should provide contextual contract information.

Example:

```text
UNDRIFT — API Contract Drift

Endpoint
GET /api/users/:id

Frontend expects
userName: string

Backend provides
user_name: string

Issue
Response field mismatch

Likely semantic match
96%
```

Hover should not overload the developer with the full project report.

---

# 31. Code Action Provider

Code actions are the primary mechanism for Quick Fix behavior.

Example:

```text
UNDRIFT: Map backend user_name → userName
UNDRIFT: Add missing backend response field
UNDRIFT: Review contract mismatch
```

The first implementation should focus on code actions that apply deterministic `WorkspaceEdit` operations.

VS Code exposes `CodeActionProvider` and workspace edit support for these workflows.

Reference:

https://code.visualstudio.com/api/references/vscode-api

---

# 32. Applying Fixes

Core returns:

```text
FixProposal
```

The extension converts it into:

```text
vscode.WorkspaceEdit
```

and applies it via VS Code.

Conceptually:

```text
Core
 ↓
FixProposal
 ↓
Extension
 ↓
WorkspaceEdit
 ↓
workspace.applyEdit(...)
 ↓
Source changes
 ↓
UNDRIFT re-analysis
```

This keeps the Core independent from VS Code.

---

# 33. Inline Completion

UNDRIFT may optionally use:

```text
registerInlineCompletionItemProvider
```

for highly localized suggestions.

However, inline completion is **not a critical MVP dependency**.

The primary interaction is:

```text
Diagnostic
   ↓
Hover
   ↓
Code Action
   ↓
Apply
```

Inline completion should only be added if the core workflow is already stable.

Reference:

https://code.visualstudio.com/api/references/vscode-api

---

# 34. Sidebar Architecture

Use a TreeView for the primary structured navigation.

Proposed structure:

```text
UNDRIFT
│
├── Integration Health
│   ├── ✓ 18 Verified
│   ├── ⚠ 3 Drifted
│   ├── ○ 2 Waiting
│   └── ◇ 1 Orphaned
│
├── Drifted Contracts
│   ├── ⚠ PUT /users/:id
│   ├── ⚠ GET /orders/:id
│   └── ⚠ POST /auth/login
│
└── Orphaned
    └── ◇ GET /analytics
```

TreeView is appropriate for structured hierarchical information.

Reference:

https://code.visualstudio.com/api/extension-guides/overview

---

# 35. Report Webview

A Webview may provide the polished full report.

The report should display:

```text
Project integration health
Contract counts
Severity counts
Drift categories
Detailed findings
Affected files
Suggested resolutions
```

Communication pattern:

```text
Webview
   ↕
Extension message handler
   ↕
Core
```

The Webview should not directly analyze source code.

Reference:

https://code.visualstudio.com/api/references/vscode-api

---

# 36. Extension Commands

Initial commands:

```text
UNDRIFT: Analyze Workspace
UNDRIFT: Show Integration Report
UNDRIFT: Refresh Contracts
UNDRIFT: Verify Current File
UNDRIFT: Fix Selected Drift
```

The exact command labels can change during UX implementation.

---

# 37. CLI Requirements

The CLI is secondary to the VS Code experience.

Potential commands:

```bash
undrift scan
undrift report
undrift verify
```

The CLI should call the same Core package.

Example:

```text
undrift
   ↓
@undrift/core
   ↓
workspace analysis
   ↓
terminal report
```

No separate CLI analysis engine should be created.

---

# 38. Core Public API

The Core should expose a small API.

Illustrative shape:

```ts
export interface UndriftEngine {
  initialize(config?: UndriftConfig): Promise<void>;

  analyzeWorkspace(
    input: WorkspaceInput
  ): Promise<AnalysisResult>;

  analyzeChanges(
    changes: SourceChange[]
  ): Promise<AnalysisDelta>;

  getContracts(): ApiContract[];

  getDrifts(): Drift[];

  getReport(): IntegrationReport;

  getFixes(driftId: string): FixProposal[];

  dispose(): void;
}
```

The exact signatures are implementation details and may evolve.

---

# 39. Analysis Result

A complete analysis result should contain:

```ts
type AnalysisResult = {
  contracts: ApiContract[];
  drifts: Drift[];
  graph: ContractGraph;
  stats: AnalysisStats;
  timestamp: number;
};
```

Stats may include:

```text
contracts discovered
verified
drifted
waiting
orphaned
analysis duration
files analyzed
```

---

# 40. Integration Report Model

```ts
type IntegrationReport = {
  summary: {
    totalContracts: number;
    verified: number;
    drifted: number;
    waiting: number;
    orphaned: number;
  };

  drifts: Drift[];

  generatedAt: number;
};
```

The report should be derivable from current Core state.

---

# 41. In-Memory State Management

Core should maintain:

```text
ProjectState
    │
    ├── source files/index
    ├── extracted consumers
    ├── extracted providers
    ├── schemas
    ├── contracts
    ├── graph
    └── drifts
```

Updates should replace affected entities rather than accumulating stale copies.

---

# 42. File Classification

Initial file classification heuristics:

```text
*.tsx / frontend paths
    → frontend candidate

Express import/route usage
    → backend candidate

prisma/schema.prisma
    → Prisma schema

otherwise
    → general TypeScript source
```

Classification should be based on observed source structure where possible rather than folder names alone.

---

# 43. Supported API Client Abstraction

Rather than hardcoding only one API client, define:

```ts
interface FrontendApiAdapter {
  name: string;

  canHandle(node: CallExpression): boolean;

  extract(node: CallExpression): FrontendContract | null;
}
```

Initial adapters:

```text
FetchAdapter
AxiosAdapter
GenericTypedApiAdapter
```

This allows future support without changing the matching engine.

---

# 44. Backend Framework Abstraction

Likewise:

```ts
interface BackendRouteAdapter {
  name: string;

  canHandle(node: CallExpression): boolean;

  extract(node: CallExpression): BackendContract | null;
}
```

Initial implementation:

```text
ExpressAdapter
```

Future adapters:

```text
FastifyAdapter
NestAdapter
```

are out of scope for the hackathon.

---

# 45. Route Normalization

Routes must be normalized before matching.

Normalization may handle:

```text
leading/trailing slash
duplicate slash
path parameter naming
base path where configured
```

Example:

```text
/users/:userId
/users/:id
```

These may be treated as structurally equivalent route patterns for matching purposes while preserving the original parameter names for request-parameter comparison.

Route normalization must not blindly make unrelated routes equivalent.

---

# 46. Type Comparison

Type comparison should operate on normalized representations.

Examples:

```text
string == string
number == number
boolean == boolean
```

Potential incompatibilities:

```text
number != string
string != boolean
User != Product
```

Unknown types should not automatically be classified as incompatible.

Example:

```text
frontend:
unknown

backend:
string
```

may produce reduced confidence rather than a hard error.

---

# 47. Optionality and Nullability

The matcher should distinguish:

```text
required
optional
nullable
optional + nullable
unknown
```

Example:

```text
Frontend:
avatar: string

Backend:
avatar?: string
```

should result in an optionality mismatch.

Example:

```text
Frontend:
avatar: string

Backend:
avatar: string | null
```

should result in a nullability mismatch.

---

# 48. Nested Schema Comparison

The MVP should support nested object comparison to a limited depth.

Example:

```json
{
  "user": {
    "name": "..."
  }
}
```

The engine should be able to represent paths such as:

```text
user
user.name
```

A configurable maximum comparison depth should prevent pathological traversal.

Suggested initial depth:

```text
3–5 levels
```

---

# 49. Dynamic Code Handling

UNDRIFT will encounter cases that cannot be resolved statically.

Example:

```ts
const route = `/api/${resource}/${action}`;
fetch(route);
```

The extractor may not know the concrete endpoint.

The correct behavior is:

```text
do not invent a contract
mark as unresolved / unsupported
continue analysis
```

The analyzer must be resilient to partially understood source.

---

# 50. False Positive Control

Because orphan detection and semantic equivalence can be uncertain, findings should include evidence.

For example:

```text
No known consumer found.

Known provider:
GET /api/analytics

Searched:
React/TypeScript API consumer patterns

Confidence:
high within supported static analysis
```

This communicates the analysis boundary accurately.

---

# 51. Error Isolation

A malformed or unsupported source file must not crash the whole analysis.

Per-file processing should use isolated error handling.

Conceptually:

```text
File A → parsed successfully
File B → parse warning
File C → extracted successfully
File D → unsupported dynamic pattern
```

The analysis should continue and produce partial results.

---

# 52. Performance Requirements

For the benchmark/demo application, the extension should feel responsive.

Target development goals:

### Initial scan

Target:

```text < 2 seconds
```

for the intentionally small hackathon demo repository under normal local conditions.

### Incremental update

Target:

```text < 500 ms
```

for straightforward single-contract changes after the debounce window.

These are engineering targets for the prototype, not guarantees for arbitrary production repositories.

Large projects may fall back to slower/full analysis.

---

# 53. Caching

Potential cache keys:

```text
file path
file content hash
tsconfig identity
extractor version
```

A simple content hash can avoid reprocessing unchanged files.

The first implementation may skip sophisticated persistence and rely on in-memory caching.

---

# 54. Concurrency

Analysis work should avoid blocking the extension UI unnecessarily.

A simple initial model:

```text
change event
    ↓
queue analysis
    ↓
cancel/ignore outdated analysis where practical
    ↓
publish latest result
```

The implementation must prevent stale analysis results from overwriting newer workspace state.

---

# 55. Security and Privacy

The hackathon MVP is local-first.

Requirements:

- Do not upload source code to an UNDRIFT server because none is required.
- Do not store source contents in telemetry.
- Keep `.undrift/` local.
- Do not log full source files during normal operation.
- Do not expose secrets from `.env` files in reports.
- Avoid analyzing secret values as contract information.

If an optional external AI resolver is implemented, only the minimum relevant structured context should be sent and secret values must be excluded.

---

# 56. Logging

Core logging levels:

```text
ERROR
WARN
INFO
DEBUG
```

Default:

```text
INFO
```

Debug logs should support troubleshooting extraction/matching issues.

Logs should avoid dumping raw source unless explicitly enabled for development.

---

# 57. Configuration

Potential project configuration:

```json
{
  "version": 1,
  "frontend": {
    "apiClients": ["fetch", "axios"]
  },
  "backend": {
    "frameworks": ["express"]
  },
  "database": {
    "provider": "prisma"
  }
}
```

For the hackathon MVP, automatic discovery should be the default and configuration should remain minimal.

Potential file:

```text
.undriftrc.json
```

Configuration is optional and not required for basic use.

---

# 58. Testing Architecture

Testing should be fixture driven.

```text
tests/
└── fixtures/
    ├── missing-endpoint/
    ├── orphan-endpoint/
    ├── route-mismatch/
    ├── method-mismatch/
    ├── request-mismatch/
    ├── response-mismatch/
    ├── type-mismatch/
    └── nullability-mismatch/
```

Each fixture should contain:

```text
frontend/
backend/
expected.json
```

or an equivalent minimal repository representation.

---

# 59. Golden Test Strategy

A golden fixture should specify the expected analysis output.

Example:

```json
{
  "expectedDrifts": [
    {
      "type": "response-mismatch",
      "path": "/users/:id",
      "field": "userName"
    }
  ]
}
```

Changes to matcher behavior should update fixtures deliberately rather than silently changing expected outputs.

---

# 60. Extension Testing

At minimum:

- extension activates successfully;
- Core initializes;
- commands register;
- diagnostics can be published;
- code actions are returned for known drifts;
- workspace edits can be applied;
- analysis refreshes after file changes.

The core analysis should remain testable independently from the VS Code extension.

---

# 61. End-to-End Test

One end-to-end scenario should exercise the full product:

```text
broken project
    ↓
extension opens
    ↓
UNDRIFT scans
    ↓
drift appears
    ↓
developer invokes Quick Fix
    ↓
WorkspaceEdit applied
    ↓
analysis refreshes
    ↓
contract becomes verified
```

This should become the primary acceptance test for the hackathon demo.

---

# 62. Example Internal Data

Example extracted frontend contract:

```json
{
  "id": "consumer:get:/users/:id",
  "side": "consumer",
  "method": "GET",
  "path": "/users/:id",
  "response": {
    "fields": {
      "id": { "type": "string" },
      "userName": { "type": "string" },
      "email": { "type": "string" }
    }
  }
}
```

Example backend contract:

```json
{
  "id": "provider:get:/users/:id",
  "side": "provider",
  "method": "GET",
  "path": "/users/:id",
  "response": {
    "fields": {
      "id": { "type": "string" },
      "user_name": { "type": "string" },
      "email": { "type": "string" }
    }
  }
}
```

Drift engine output:

```json
{
  "type": "semantic-mismatch",
  "severity": "warning",
  "expected": "userName",
  "actual": "user_name"
}
```

---

# 63. Data Flow — Initial Scan

```text
VS Code activates
      ↓
Core.initialize()
      ↓
Workspace discovery
      ↓
Load TypeScript projects
      ↓
Frontend extractor ───┐
                      │
Backend extractor ────┼──→ Normalizer
                      │
Prisma extractor ────┘
                            ↓
                     Contract Registry
                            ↓
                      Matching Engine
                            ↓
                       Drift Engine
                            ↓
                     Analysis Result
                            ↓
                  ┌─────────┴─────────┐
                  ↓                   ↓
             Diagnostics           Sidebar
                  │                   │
                  └────────┬──────────┘
                           ↓
                         User
```

---

# 64. Data Flow — Live Change

```text
Developer edits file
        ↓
VS Code document event
        ↓
Debounce
        ↓
Relevant-file check
        ↓
Core.analyzeChanges()
        ↓
Re-extract affected file
        ↓
Update contract graph
        ↓
Re-run affected matching
        ↓
Update drift set
        ↓
Return AnalysisDelta
        ↓
Extension refreshes:
    diagnostics
    sidebar
    report
```

---

# 65. Data Flow — Quick Fix

```text
Drift exists
     ↓
Diagnostic shown
     ↓
User opens Code Action
     ↓
Extension requests FixProposal
     ↓
Core returns structured edits
     ↓
Extension creates WorkspaceEdit
     ↓
User accepts
     ↓
VS Code applies edit
     ↓
Document change event
     ↓
UNDRIFT re-analyzes
     ↓
Drift resolved
```

---

# 66. Technical Decision: Core Directly Imported by Extension

The hackathon MVP will **not** introduce a localhost REST server or WebSocket between the extension and Core.

Use:

```text
VS Code Extension
      ↓
direct import
      ↓
@undrift/core
```

Reasons:

- simpler deployment;
- no port management;
- no local service lifecycle;
- fewer failure modes;
- lower implementation overhead;
- easier shared types;
- easier 48-hour development.

If a future architecture requires a separate process for isolation/performance, the Core interface can later be adapted without changing its domain model.

---

# 67. Technical Decision: No Database

The product is fundamentally a code analysis engine.

A database would add:

- schema management;
- persistence complexity;
- migrations;
- configuration;
- synchronization concerns.

The MVP only needs:

```text
in-memory state
+
optional local cache
```

---

# 68. Technical Decision: Deterministic First

The deterministic engine is the authoritative source for:

```text
route
method
fields
types
presence
nullability
orphan detection
```

AI/semantic reasoning is supplemental.

This avoids turning an objective code relationship into a completely LLM-dependent result.

---

# 69. Technical Decision: VS Code Native UX

UNDRIFT should prefer native VS Code APIs for developer interactions:

```text
Diagnostic
Hover
Code Action
TreeView
Commands
WorkspaceEdit
```

Use Webview only for the polished report where native TreeView capabilities are insufficient.

This reduces custom UI code and keeps the tool aligned with the editor.

---

# 70. Technical Decision: Extension as Adapter

The extension must not contain business logic such as:

```text
"if field mismatch then ..."
```

That belongs in Core.

The extension should translate:

```text
Core result
      ↓
VS Code representation
```

This preserves Core reusability for:

```text
CLI
CI
other IDE adapters
future integrations
```

---

# 71. Future Architecture Compatibility

The technical design should make these later additions possible:

```text
UNDRIFT Core
     │
 ┌───┼────────────┬──────────────┐
 ↓   ↓            ↓              ↓
CLI VS Code     CI Adapter    Future IDEs
```

Additional extractors:

```text
React
Vue
Angular
Next.js

Express
Fastify
NestJS

Prisma
OpenAPI
GraphQL
```

The hackathon implementation should not build these adapters yet.

---

# 72. Observability for the Benchmark

For the hackathon, the engine should expose enough metadata to measure:

```text
files analyzed
contracts discovered
drifts detected
analysis duration
fix proposals generated
fixes successfully verified
```

This data enables the team to demonstrate measurable engineering impact without making unsupported productivity claims.

---

# 73. Technical Acceptance Criteria

The TRD is considered successfully implemented when:

## Core

- [ ] TypeScript Core package builds independently.
- [ ] Frontend extractor works on the benchmark React/TypeScript project.
- [ ] Backend extractor works on the benchmark Express/TypeScript project.
- [ ] Optional Prisma extraction works for the benchmark schema.
- [ ] Contracts are normalized into one model.
- [ ] Frontend/backend contracts can be matched.
- [ ] All MVP drift types can be represented and detected in fixtures.
- [ ] Findings retain source locations.
- [ ] Fix proposals can be generated for selected high-confidence cases.

## Extension

- [ ] Extension activates.
- [ ] Initial workspace scan runs.
- [ ] Diagnostics appear in source.
- [ ] Hover shows contract context.
- [ ] Sidebar displays status counts and issues.
- [ ] Full integration report opens.
- [ ] Quick Fix is exposed for at least one drift type.
- [ ] Approved fix is applied with `WorkspaceEdit`.
- [ ] Re-analysis removes the resolved issue.

## CLI

- [ ] CLI can invoke Core.
- [ ] `scan` produces a meaningful terminal result.
- [ ] `report` produces current integration state.

## Performance

- [ ] Demo repository initial analysis targets under 2 seconds.
- [ ] Simple incremental changes target sub-second analysis after debounce.
- [ ] Analysis errors in individual files do not terminate the entire scan.

---

# 74. Hackathon Implementation Priority

If time becomes constrained, implementation priority is:

### P0 — Must Have

```text
Frontend extraction
Backend extraction
Contract model
Matching
Drift detection
VS Code diagnostics
Sidebar/report
One-click fix
Reverification
```

### P1 — Strongly Desired

```text
Incremental analysis
Type-aware response extraction
Orphan endpoint detection
Prisma awareness
Multiple fix types
Benchmark instrumentation
```

### P2 — Stretch

```text
Semantic AI resolver
Inline completions
Contract history
Advanced graph visualization
CLI polish
```

A P0-complete product is preferable to a broad but unreliable implementation.

---

# 75. Recommended Implementation Sequence

The development sequence should follow dependency order.

```text
1. Contract types
       ↓
2. Workspace/index model
       ↓
3. Frontend extractor
       ↓
4. Backend extractor
       ↓
5. Normalizer
       ↓
6. Matcher
       ↓
7. Drift engine
       ↓
8. Fixture tests
       ↓
9. Core public API
       ↓
10. VS Code activation
       ↓
11. Diagnostics
       ↓
12. Sidebar
       ↓
13. Code Actions
       ↓
14. WorkspaceEdit
       ↓
15. Live updates
       ↓
16. Report
       ↓
17. Prisma support
       ↓
18. Semantic resolver
       ↓
19. CLI
       ↓
20. Polish/benchmark
```

This ordering minimizes the risk of building the UI before the analysis engine is trustworthy.

---

# 76. References

Official / primary technical references used for the architecture:

- Visual Studio Code Extension API:  
  https://code.visualstudio.com/api/references/vscode-api

- Visual Studio Code Extension Guides:  
  https://code.visualstudio.com/api/extension-guides/overview

- npm Workspaces:  
  https://docs.npmjs.com/cli/using-npm/workspaces

- ts-morph documentation:  
  https://ts-morph.com/

---

# 77. Final Technical Architecture

```text
                         ┌───────────────────────────┐
                         │         VS CODE           │
                         │                           │
                         │   UNDRIFT Extension       │
                         │                           │
                         │ Diagnostics               │
                         │ Hover                     │
                         │ Code Actions              │
                         │ TreeView                  │
                         │ Report Webview            │
                         │ Commands                  │
                         │ Workspace Events          │
                         └────────────┬──────────────┘
                                      │
                              Direct Core API
                                      │
                         ┌────────────▼──────────────┐
                         │       UNDRIFT CORE         │
                         │                           │
                         │ Workspace Indexer         │
                         │ Contract Extractors       │
                         │ Contract Normalizer       │
                         │ Contract Registry         │
                         │ Contract Graph            │
                         │ Matching Engine            │
                         │ Drift Engine               │
                         │ Semantic Resolver          │
                         │ Fix Engine                 │
                         │ State Store                │
                         └────────────┬──────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
                ▼                     ▼                     ▼
        React / TSX AST       Express / TS AST       Prisma Schema
        Frontend Consumers    Backend Providers       DB Models
                │                     │                     │
                └─────────────────────┼─────────────────────┘
                                      ▼
                              Contract Graph
                                      │
                                      ▼
                              Drift / Fix Result
```

UNDRIFT's technical architecture is therefore centered on a **local, reusable contract-analysis engine**, with VS Code functioning as the primary interaction layer. The analysis engine remains independent from the editor, enabling the same core logic to power the future CLI and CI integrations without rebuilding the product's intelligence.
