# UNDRIFT — High-Level Design (HLD)

**Document:** HLD.md  
**Project:** UNDRIFT  
**Version:** 0.1 — Hackathon MVP  
**Status:** Architecture baseline  
**Primary Interface:** VS Code Extension  
**Core Runtime:** Local TypeScript/Node.js analysis engine  
**Primary Supported Stack:** React + TypeScript frontend, Node.js + Express + TypeScript backend, optional Prisma schema

---

# 1. Purpose

This document describes the high-level architecture of UNDRIFT.

The HLD defines:

- major system components;
- responsibilities and boundaries;
- relationships between Core and the VS Code extension;
- repository analysis flow;
- contract discovery and lifecycle;
- drift detection flow;
- live development behavior;
- fix application flow;
- data ownership;
- runtime architecture;
- extensibility boundaries;
- failure handling;
- security and privacy boundaries;
- deployment model;
- major architectural decisions.

The HLD intentionally does not define every class, function, AST node visitor, or exact implementation detail. Those belong in the Low-Level Design (LLD).

---

# 2. System Objective

UNDRIFT continuously maintains a code-derived view of the integration contract between supported application layers.

The system answers four questions:

1. **What API contracts exist in the current codebase?**
2. **Which frontend consumers correspond to which backend providers?**
3. **Where do those relationships disagree or remain incomplete?**
4. **What actionable change can the developer make to resolve the issue?**

The product is designed to operate inside the developer's normal coding environment.

The target workflow is:

```text
Developer writes/changes code
        ↓
UNDRIFT observes workspace changes
        ↓
Contracts are extracted
        ↓
Contracts are normalized
        ↓
Consumers/providers are matched
        ↓
Drift is detected
        ↓
Developer receives explanation in VS Code
        ↓
Fix is proposed
        ↓
Developer reviews/accepts
        ↓
Workspace is edited
        ↓
UNDRIFT re-analyzes
        ↓
Contract becomes verified
```

---

# 3. System Context

UNDRIFT operates on an application repository opened in VS Code.

For the hackathon MVP, the repository is expected to contain primarily:

```text
React + TypeScript frontend
Node.js + Express + TypeScript backend
optional Prisma schema
```

UNDRIFT does not require a hosted backend for normal operation.

High-level context:

```text
                         ┌───────────────────────┐
                         │       Developer       │
                         │                       │
                         │ Writes / edits code   │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │        VS CODE        │
                         │                       │
                         │ Application workspace │
                         │ + UNDRIFT Extension   │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │    UNDRIFT CORE       │
                         │                       │
                         │ Contract intelligence │
                         └───────────┬───────────┘
                                     │
                         ┌───────────┼───────────┐
                         │           │           │
                         ▼           ▼           ▼
                    Frontend     Backend      Prisma
                    TypeScript   Express       Schema
```

---

# 4. Architectural Principles

## 4.1 Local-First

The primary MVP runtime is local.

No UNDRIFT cloud service is required to analyze the project.

---

## 4.2 Core/Interface Separation

The analysis engine must remain independent of VS Code.

```text
UNDRIFT Core
   │
   ├── VS Code Extension
   └── CLI
```

This prevents editor-specific behavior from leaking into the analysis domain.

---

## 4.3 Deterministic Core

The core should derive objective facts from source code wherever possible.

Examples:

```text
route
method
field
type
presence
nullability
source location
```

AI/semantic reasoning is supplemental rather than foundational.

---

## 4.4 Continuous State

UNDRIFT is not only a one-shot scanner.

It maintains a current representation of:

```text
contracts
relationships
drifts
statuses
```

and updates that representation as source changes.

---

## 4.5 Explainable Findings

Every meaningful drift should retain enough evidence to explain:

```text
what was expected
what was found
where it was found
why the relationship is considered inconsistent
```

---

## 4.6 Controlled Modification

The Core produces fix proposals.

The VS Code extension applies approved changes.

Core must not directly rewrite source files.

---

# 5. High-Level Component Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                           VS CODE                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 UNDRIFT EXTENSION                            │  │
│  │                                                              │  │
│  │  Workspace Watcher                                           │  │
│  │        │                                                     │  │
│  │        ├── Diagnostics Provider                              │  │
│  │        ├── Hover Provider                                    │  │
│  │        ├── Code Action Provider                              │  │
│  │        ├── TreeView Provider                                 │  │
│  │        ├── Report Webview                                    │  │
│  │        └── Command Handlers                                  │  │
│  │                                                              │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
│                                 │                                  │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │
                            Core API Calls
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                         UNDRIFT CORE                               │
│                                                                    │
│  ┌───────────────────┐                                             │
│  │ Workspace Indexer │                                             │
│  └─────────┬─────────┘                                             │
│            ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Extractor Layer                         │   │
│  │                                                             │   │
│  │  Frontend Extractor │ Backend Extractor │ Prisma Extractor  │   │
│  └────────────────────────────┬────────────────────────────────┘   │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Contract Normalizer │                        │
│                    └──────────┬──────────┘                        │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Contract Registry   │                        │
│                    └──────────┬──────────┘                        │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Contract Graph      │                        │
│                    └──────────┬──────────┘                        │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Matching Engine     │                        │
│                    └──────────┬──────────┘                        │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Drift Engine        │                        │
│                    └──────────┬──────────┘                        │
│                               ▼                                    │
│                    ┌─────────────────────┐                        │
│                    │ Fix Engine          │                        │
│                    └─────────────────────┘                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          Local Application
                           Source Workspace
```

---

# 6. Component Responsibilities

## 6.1 VS Code Extension

The extension is the primary presentation and interaction layer.

Responsibilities:

- detect workspace activation;
- observe source/document changes;
- initialize the Core engine;
- request analysis;
- display diagnostics;
- display contextual explanations;
- expose Quick Fix actions;
- provide project-level integration status;
- display detailed reports;
- apply approved workspace changes;
- refresh the UI after analysis.

The extension does not own the contract-analysis rules.

---

# 7. Workspace Watcher

The workspace watcher connects the VS Code editor to Core.

Inputs include:

```text
document changes
file creation
file deletion
file modification
workspace open/close
```

Processing:

```text
VS Code event
      ↓
relevance check
      ↓
debounce
      ↓
Core analysis request
```

The watcher should distinguish between:

- unsaved editor content;
- saved filesystem changes.

Unsaved content should be analyzed from the active `TextDocument` so the developer sees feedback before saving.

---

# 8. Core API Boundary

The VS Code extension communicates with Core through a direct in-process TypeScript API for the hackathon MVP.

```text
Extension
    │
    │ direct import
    ▼
@undrift/core
```

There is intentionally no mandatory:

```text
REST server
WebSocket server
localhost HTTP service
external database
```

between the extension and Core.

This minimizes runtime complexity and makes the system easier to package.

---

# 9. Workspace Indexer

The Workspace Indexer creates the initial analysis context.

Responsibilities:

- discover relevant files;
- discover TypeScript configuration;
- establish source projects;
- classify source candidates;
- exclude irrelevant/generated directories;
- provide source files to extractors;
- maintain file-level indexing state.

Typical exclusions:

```text
node_modules/
.git/
dist/
build/
coverage/
.cache/
```

---

# 10. Extractor Layer

The extractor layer converts source-specific representations into domain-level observations.

```text
                   Extractor Layer
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Frontend        Backend         Prisma
      Extractor       Extractor       Extractor
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                  Normalized Domain
```

The extractor layer is intentionally adapter-oriented.

---

# 11. Frontend Extractor

The frontend extractor identifies API consumers.

Primary targets:

```text
fetch
axios
typed api clients
supported custom request wrappers
```

It extracts when available:

```text
HTTP method
route
path parameters
query information
request body
request body type
response type
source location
```

The extractor does not directly compare the result with backend code.

It only produces a frontend contract observation.

---

# 12. Backend Extractor

The backend extractor identifies API providers.

Primary target for the MVP:

```text
Express
```

Supported patterns include route declarations such as:

```text
router.get(...)
router.post(...)
router.put(...)
router.delete(...)

app.get(...)
app.post(...)
```

It extracts:

```text
HTTP method
route
path parameters
request information
response structure where statically discoverable
source location
```

---

# 13. Prisma Extractor

The Prisma extractor is secondary.

It analyzes:

```text
prisma/schema.prisma
```

and represents:

```text
models
fields
types
optional fields
relations
```

It provides a database-side representation that can later be linked into the application graph.

A live connection to PostgreSQL is not required for the hackathon MVP.

---

# 14. Contract Normalizer

Source structures vary across frontend and backend.

The Contract Normalizer converts extracted observations into a common domain model.

Conceptually:

```text
Frontend observation
        │
Backend observation
        │
Prisma observation
        │
        ▼
Contract Normalizer
        │
        ▼
Common Contract Representation
```

Normalization includes:

- HTTP method normalization;
- route normalization;
- field representation;
- type representation;
- source location normalization;
- optionality/nullability representation.

---

# 15. Contract Registry

The Contract Registry stores the current discovered contract observations.

It provides a central logical view of:

```text
consumer contracts
provider contracts
matched relationships
unmatched observations
contract states
```

The registry is a Core-owned data structure.

It should not depend on VS Code UI concepts.

---

# 16. Contract Graph

The registry is transformed into a relationship graph.

Example:

```text
Frontend Component
       │
       │ CONSUMES
       ▼
Frontend API Contract
       │
       │ MATCHES
       ▼
Backend API Contract
       │
       │ PROVIDED_BY
       ▼
Backend Route
       │
       │ READS/WRITES
       ▼
Prisma Model
```

The graph allows UNDRIFT to reason about relationships rather than isolated files.

---

# 17. Graph Node Types

Initial conceptual nodes:

```text
FrontendConsumer
BackendProvider
ApiContract
TypeDefinition
DatabaseModel
SchemaDefinition
```

Nodes retain identifiers and source references.

---

# 18. Graph Edge Types

Initial relationships:

```text
CONSUMES
PROVIDES
EXPECTS
RETURNS
MATCHES
READS_FROM
WRITES_TO
```

A graph relationship may also contain evidence and confidence metadata.

---

# 19. Matching Engine

The Matching Engine determines which provider observations correspond to consumer observations.

Matching occurs in ordered stages.

```text
Route/method candidate discovery
            ↓
Request comparison
            ↓
Response comparison
            ↓
Type/optional comparison
            ↓
Semantic resolution where necessary
```

This avoids immediately relying on fuzzy or probabilistic reasoning for straightforward cases.

---

# 20. Match Lifecycle

A typical relationship progresses as:

```text
DISCOVERED
    ↓
WAITING
    ↓
MATCHED
    ↓
VERIFIED
```

If one side changes incompatibly:

```text
VERIFIED
    ↓
DRIFTED
```

After resolution:

```text
DRIFTED
    ↓
REPAIRED
    ↓
VERIFIED
```

A provider with no known consumer may be represented as:

```text
ORPHANED
```

---

# 21. Drift Engine

The Drift Engine evaluates matched and unmatched contract observations.

It produces structured findings.

```text
Contracts / Graph
        ↓
   Drift Engine
        ↓
     Findings
```

Supported findings:

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

# 22. Missing Endpoint Flow

Example:

```text
Frontend:
GET /users/:id
        │
        X
No compatible provider
```

Flow:

```text
Frontend contract discovered
        ↓
Matching engine searches providers
        ↓
No candidate
        ↓
Drift Engine
        ↓
CRITICAL / WAITING finding
        ↓
VS Code diagnostic
```

---

# 23. Orphan Endpoint Flow

Example:

```text
Backend:
GET /analytics
        │
        X
No known consumer
```

Flow:

```text
Backend provider discovered
        ↓
Matching engine searches consumers
        ↓
No known consumer
        ↓
Drift Engine
        ↓
ORPHANED finding
```

The product should communicate that this means:

> No known consumer was found within UNDRIFT's supported static analysis scope.

It should not claim that the route can never be consumed externally.

---

# 24. Response Drift Flow

Example:

```text
Frontend:
userName: string

Backend:
user_name: string
```

Flow:

```text
Consumer/provider matched
        ↓
Response schemas compared
        ↓
Field-name difference detected
        ↓
Drift created
        ↓
Source locations attached
        ↓
VS Code diagnostic
```

---

# 25. Semantic Resolution

Semantic resolution is an optional stage for ambiguous differences.

Example:

```text
displayName
        ↕
full_name
```

Pipeline:

```text
Deterministic comparison
        ↓
Ambiguous difference
        ↓
Semantic Resolver
        ↓
Possible relationship
        ↓
Confidence + reasoning
```

The architecture intentionally isolates this capability:

```ts
SemanticResolver
```

so the core deterministic engine remains independent from any particular AI/LLM provider.

---

# 26. Fix Engine

The Fix Engine converts findings into structured proposals.

```text
Drift
  ↓
Fix Engine
  ↓
FixProposal
```

A proposal contains conceptually:

```text
title
confidence
explanation
affected contracts
source edits
```

The Fix Engine does not edit files.

---

# 27. Extension Fix Flow

```text
Diagnostic
    ↓
User opens Code Action
    ↓
Extension asks Core for fix
    ↓
FixProposal returned
    ↓
Extension renders proposed action
    ↓
Developer approves
    ↓
WorkspaceEdit
    ↓
VS Code applies edit
    ↓
Source change event
    ↓
UNDRIFT re-analysis
    ↓
Drift disappears / becomes verified
```

This provides a closed loop.

---

# 28. VS Code Diagnostic Architecture

The extension maps each relevant `Drift` to a VS Code diagnostic.

Conceptually:

```text
Core Drift
    │
    ├── type
    ├── severity
    ├── message
    ├── explanation
    └── source locations
           │
           ▼
VS Code Diagnostic
```

The diagnostic should point to the source location most useful for the developer.

---

# 29. Hover Architecture

Hover information is derived from Core state.

```text
Editor cursor
     ↓
Extension resolves source location
     ↓
Core lookup
     ↓
Contract / Drift context
     ↓
Hover content
```

Hover should show concise context rather than the entire project report.

---

# 30. Code Action Architecture

Code Actions query Core for applicable fixes at a given location.

```text
Source position
      ↓
Relevant drift
      ↓
Fix proposals
      ↓
Code actions
```

The Code Action layer is responsible for translating the proposal into VS Code workspace edits.

---

# 31. Sidebar Architecture

The sidebar provides a project-level view.

```text
UNDRIFT
│
├── Integration Health
│   ├── Verified
│   ├── Drifted
│   ├── Waiting
│   └── Orphaned
│
├── Drifted Contracts
│
└── Orphaned Providers
```

The sidebar should be driven from the current Core report/state.

It should not maintain a separate version of the contract state.

---

# 32. Report Architecture

The detailed report may be rendered using a VS Code Webview.

```text
Core Report Model
       ↓
Extension message bridge
       ↓
Report Webview
```

The Webview is presentation-only.

It must not become a second analysis engine.

---

# 33. Live Analysis Architecture

The central live-development loop is:

```text
                    SOURCE EDIT
                         │
                         ▼
                  VS CODE EVENT
                         │
                         ▼
                   DEBOUNCE
                         │
                         ▼
                 RELEVANCE CHECK
                         │
                         ▼
                  CORE ANALYSIS
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        File re-extraction      Graph update
              └──────────┬──────────┘
                         ▼
                   Re-matching
                         │
                         ▼
                  Drift evaluation
                         │
                         ▼
                    Core state
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Diagnostics   Sidebar    Report
```

---

# 34. Initial Workspace Scan

When a project opens:

```text
VS Code extension activates
        ↓
Workspace discovered
        ↓
Core initialized
        ↓
Workspace indexed
        ↓
TypeScript projects loaded
        ↓
Extractors run
        ↓
Contracts normalized
        ↓
Graph created
        ↓
Matching performed
        ↓
Drift detected
        ↓
UI populated
```

---

# 35. Incremental Update

When a supported file changes:

```text
Changed file
    ↓
Identify source type
    ↓
Re-extract changed file
    ↓
Remove old observations for file
    ↓
Insert new observations
    ↓
Update graph
    ↓
Re-evaluate affected relationships
    ↓
Refresh findings
```

A full re-scan may remain available as a correctness fallback.

---

# 36. Unsaved Changes

The system should analyze the in-memory content from VS Code when available.

```text
Unsaved editor buffer
        ↓
TextDocument.getText()
        ↓
Core source update
        ↓
analysis
```

This allows UNDRIFT to identify drift before a developer saves the file.

---

# 37. Stale Analysis Protection

Because analysis may be asynchronous, Core/Extension interaction should associate analysis work with a workspace revision or request identifier.

Conceptually:

```text
Revision 10 → analysis starts
Revision 11 → user edits again
Revision 10 → returns
```

Revision 10 must not overwrite the newer Revision 11 state.

Only the current/latest applicable result should be published.

---

# 38. State Ownership

Ownership should remain clear.

## Core owns

```text
Contract Registry
Graph
Drift state
Analysis results
Fix proposals
```

## Extension owns

```text
VS Code diagnostics
TreeView presentation
Webview lifecycle
workspace edit application
editor-specific interaction state
```

This prevents duplicate sources of truth.

---

# 39. Persistence Architecture

Runtime state is primarily in memory.

Optional project-local state:

```text
.undrift/
├── contracts.json
├── graph.json
└── state.json
```

Persistence is not authoritative over current source code.

When the workspace changes, source analysis remains the source of truth.

---

# 40. CLI Architecture

The CLI uses the same Core.

```text
             UNDRIFT CORE
              /        \
             /          \
VS Code Extension       CLI
```

CLI responsibilities:

- parse CLI arguments;
- construct Core configuration;
- request workspace analysis;
- format output for terminal use.

The CLI must not implement its own matching or drift engine.

---

# 41. Application-to-Core Runtime Model

The hackathon MVP is local and in-process.

```text
                VS Code Extension Host
                         │
               ┌─────────┴─────────┐
               │                   │
               ▼                   ▼
        Extension Runtime      UNDRIFT Core
                                   │
                                   ▼
                            Local File System
```

No application source needs to be uploaded to an UNDRIFT server.

---

# 42. Deployment Model

For hackathon use:

```text
Developer machine
│
├── VS Code
│   └── UNDRIFT extension
│
└── Project repository
    ├── frontend
    ├── backend
    └── prisma
```

Installation should result in:

```text
Install extension
        ↓
Open project
        ↓
UNDRIFT starts
```

No separate infrastructure is required.

---

# 43. Build-Time Architecture

The monorepo contains:

```text
apps/
├── vscode-extension
└── cli

packages/
└── core
```

Build relationship:

```text
@undrift/core
      │
      ├──────────────► vscode-extension
      │
      └──────────────► cli
```

Core is built independently.

The extension is bundled for VS Code.

---

# 44. Error Handling Architecture

Errors should be isolated at the smallest reasonable scope.

```text
Workspace
   │
   ├── File A → success
   ├── File B → parse warning
   ├── File C → success
   └── File D → unsupported dynamic pattern
```

A single unsupported file should not terminate the entire workspace scan.

The resulting analysis may include:

```text
successful findings
+
warnings
+
unsupported-analysis metadata
```

where useful.

---

# 45. Analysis Confidence

Confidence metadata should be preserved for ambiguous findings.

Example:

```text
semantic match:
0.91
```

The system should retain reasons such as:

```text
same normalized tokens
same owner type
same source model
same usage context
```

Confidence is used to determine whether an automatic fix is appropriate.

---

# 46. Security Boundary

UNDRIFT should avoid treating secret values as contract data.

The analyzer should ignore or avoid reading values from:

```text
.env
.env.local
credential files
private keys
```

where the contents are not required for contract analysis.

The architecture does not require access to production credentials or database credentials for the MVP.

---

# 47. Privacy Boundary

The default architecture is local.

```text
Source code
   ↓
Local extraction
   ↓
Local graph
   ↓
Local report
```

No source synchronization with a UNDRIFT-hosted backend is necessary.

If future external semantic services are introduced, the semantic resolver should receive only the minimum necessary structured information.

---

# 48. Performance Architecture

Performance is addressed through several layers.

## Initial scan

Allowed to perform broad project indexing.

## Incremental analysis

Prefer re-analysis of changed/affected files.

## Debouncing

Coalesce rapid editor events.

## Caching

Reuse unchanged source analysis where possible.

## Selective graph recomputation

Re-evaluate only relationships affected by changed observations when practical.

---

# 49. Extensibility Architecture

Framework support is isolated through adapters.

```text
                 Extraction Framework
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     Frontend         Backend          Database
      Adapters         Adapters          Adapters
        │                │                │
     ┌──┼──┐          ┌──┼──┐          ┌──┼──┐
     ▼  ▼  ▼          ▼  ▼  ▼          ▼  ▼  ▼
   React ...         Express ...      Prisma ...
```

The matching and drift layers consume normalized domain models and therefore should not need framework-specific rules.

---

# 50. Future IDE Support

Because Core has no dependency on VS Code APIs:

```text
             UNDRIFT CORE
             /    |     \
            /     |      \
        VS Code   CLI     Future IDE
```

A future IDE integration would provide a new adapter/presentation layer.

The Core contract graph and drift engine remain reusable.

---

# 51. Architectural Decision: No Separate UNDRIFT Server

### Decision

Do not create a separate local HTTP server for the hackathon MVP.

### Reason

The product does not require process isolation or remote computation.

Direct Core invocation provides:

- simpler setup;
- fewer runtime failure modes;
- lower implementation complexity;
- easier shared typing;
- faster iteration.

A separate process can be introduced later if Core becomes resource-heavy or requires stronger isolation.

---

# 52. Architectural Decision: No Runtime API Proxy

UNDRIFT will not sit between frontend and backend traffic during normal MVP operation.

The primary analysis source is the repository itself.

Reason:

- the product's value is detecting drift during coding;
- static source provides direct explanations and source locations;
- runtime instrumentation creates setup and data complexity;
- runtime data is unnecessary for the core hackathon scenario.

Runtime verification can become a later extension.

---

# 53. Architectural Decision: No Required API Specification

The MVP does not require a complete manually-authored OpenAPI/Pact contract before analysis.

Instead:

```text
Source code
    ↓
Implicit contract discovery
    ↓
Normalized contract
```

This is central to UNDRIFT's product thesis.

The product is designed for repositories where documentation may be incomplete or where different code-generation/development steps produced divergent assumptions.

---

# 54. Architectural Decision: Deterministic Before Semantic

The system should first answer objective questions:

```text
Does this route exist?
Does this method match?
Does this field exist?
Do these types conflict?
```

Only ambiguous questions proceed to semantic reasoning:

```text
Could userName and displayName mean the same thing?
```

This reduces unnecessary AI dependence and improves predictability.

---

# 55. Architectural Decision: Core Does Not Edit Files

Core outputs structured proposals.

```text
Core
 ↓
FixProposal
```

The IDE decides when/how to apply it.

This ensures:

- Core remains IDE-independent;
- changes are user-controlled;
- VS Code can provide native previews/actions;
- future CLI/CI modes can choose different application policies.

---

# 56. Primary End-to-End Architecture

The complete system flow is:

```text
┌──────────────────────────────────────────────────────────────────┐
│                           DEVELOPER                              │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                            VS CODE                               │
│                                                                  │
│  Editor                                                         │
│    │                                                             │
│    ├── Change Events                                             │
│    ├── Diagnostics                                               │
│    ├── Hover                                                     │
│    ├── Quick Fix                                                 │
│    ├── Sidebar                                                   │
│    └── Report                                                    │
│                              │                                   │
│                              ▼                                   │
│                    UNDRIFT EXTENSION                             │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                         Core API calls
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                           UNDRIFT CORE                            │
│                                                                  │
│  Workspace Indexer                                               │
│          ↓                                                       │
│  Source Extractors                                               │
│          ↓                                                       │
│  Contract Normalizer                                             │
│          ↓                                                       │
│  Contract Registry                                               │
│          ↓                                                       │
│  Contract Graph                                                  │
│          ↓                                                       │
│  Matching Engine                                                 │
│          ↓                                                       │
│  Drift Engine                                                    │
│          ↓                                                       │
│  Fix Engine                                                      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       Frontend             Backend             Prisma
       React/TS              Express/TS          Schema
            │                  │                  │
            └──────────────────┼──────────────────┘
                               ▼
                         Contract State
                               │
                               ▼
                         Drift Findings
                               │
                               ▼
                       Developer Resolution
```

---

# 57. Core Responsibility Boundary

UNDRIFT Core answers:

```text
What exists?
What connects?
What disagrees?
Why does it disagree?
What can be changed?
```

The VS Code extension answers:

```text
Where should I show it?
How should the developer interact with it?
How should an approved change be applied?
```

This separation is the key architectural boundary of the product.

---

# 58. Hackathon MVP Architecture

The minimum viable architecture is:

```text
VS Code Extension
       │
       ▼
UNDRIFT Core
       │
       ├── Frontend Extractor
       ├── Backend Extractor
       ├── Contract Model
       ├── Matcher
       ├── Drift Engine
       └── Fix Engine
```

Then add, in priority order:

```text
Prisma Extractor
Incremental Analysis
Semantic Resolver
CLI
Inline Completion
Contract History
```

The product should remain useful even when the lower-priority modules are absent.

---

# 59. Architecture Quality Goals

The architecture should satisfy these properties:

## Cohesion

Each module owns one major responsibility.

## Low Coupling

Core modules should not depend on VS Code.

## Determinism

Objective contract checks should produce repeatable results.

## Extensibility

New framework adapters should plug into extraction without rewriting the matcher.

## Testability

Core analysis should be runnable without starting VS Code.

## Safety

Source changes require developer approval.

## Performance

Common editor changes should not require full project analysis.

---

# 60. Final Architecture Summary

UNDRIFT is a **local code-intelligence system with a VS Code-native interface**.

The architecture is centered on:

```text
Source Code
    ↓
Extraction
    ↓
Normalization
    ↓
Contract Registry
    ↓
Contract Graph
    ↓
Matching
    ↓
Drift Detection
    ↓
Fix Proposal
    ↓
VS Code Interaction
    ↓
Workspace Edit
    ↓
Re-analysis
```

The architectural distinction that must remain intact is:

```text
                   UNDRIFT PRODUCT

              ┌─────────────────────┐
              │    UNDRIFT CORE      │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        VS Code Extension         CLI
```

IBM Bob 2.0 is external to this product architecture.

It is the AI development environment used by the UNDRIFT team during the hackathon to assist with design, implementation, debugging, testing, and documentation. It is not required for a developer to run UNDRIFT.

The HLD therefore preserves the core product proposition:

> **UNDRIFT continuously reconstructs the implicit integration contracts of an application and makes contract drift visible and actionable inside the developer's existing workflow.**
