# UNDRIFT — Product Requirements Document (PRD)

**Document:** PRD.md  
**Project:** UNDRIFT  
**Version:** 0.1 — Hackathon MVP  
**Status:** Product definition locked for implementation  
**Target Event:** IBM Bob 2.0 Hackathon, September 25–27, 2026

---

## 1. Product Overview

### 1.1 Product Name

**UNDRIFT**

### 1.2 Product Tagline

> **Detect the drift. Understand the gap. Fix the contract.**

### 1.3 One-Line Product Definition

UNDRIFT is a developer-side tool that continuously discovers and tracks the implicit API contracts between application layers, primarily frontend and backend, detects integration drift as developers work, explains exactly what is inconsistent or missing, and provides actionable fixes directly inside the developer's IDE.

### 1.4 Product Vision

Modern application development increasingly involves multiple independently evolving components. A frontend developer, backend developer, or AI coding agent can implement a feature based on a slightly different interpretation of an API contract. Each individual part may look correct in isolation while the integrated application is inconsistent.

UNDRIFT aims to make these integration assumptions visible and continuously verifiable during development.

Instead of asking a developer to finish an application and later run a separate integration audit, UNDRIFT maintains a live representation of the application's discovered contracts while the developer is coding.

### 1.5 Core Product Thesis

> **AI-assisted development makes code generation faster, but independently generated or rapidly changing application layers can drift apart. UNDRIFT addresses the integration bottleneck by continuously reconstructing the application's implicit contracts and surfacing inconsistencies at the point where they are introduced.**

---

# 2. Problem Statement

## 2.1 The Problem

In a typical modern application, the frontend, backend, and database are developed as separate but connected layers.

A single logical feature may involve:

- a frontend component,
- a frontend API client,
- a request or response type,
- a backend route,
- a controller or service,
- a response serializer,
- an ORM model,
- and a database schema.

These pieces are often created or modified independently.

The integration between them is usually based on an implicit contract rather than a single continuously enforced source of truth.

This creates several recurring failure modes.

### Missing provider

The frontend expects an endpoint that the backend never implemented.

```text
Frontend
GET /api/profile
        │
        X
Backend has no matching provider
```

### Orphaned provider

The backend implements an endpoint that has no known frontend consumer.

```text
Backend
GET /api/analytics
        │
        X
No known frontend consumer
```

### Route mismatch

```text
Frontend:
GET /api/users/:id

Backend:
GET /api/user/:id
```

### HTTP method mismatch

```text
Frontend:
POST /api/orders

Backend:
PUT /api/orders
```

### Request contract mismatch

```text
Frontend sends:
{
  "password": "..."
}

Backend expects:
{
  "pass": "..."
}
```

### Response contract mismatch

```text
Frontend expects:
userName

Backend returns:
user_name
```

### Type mismatch

```text
Frontend:
price: number

Backend:
price: string
```

### Nullability mismatch

```text
Frontend:
avatar: string

Backend:
avatar: string | null
```

### Structural mismatch

```text
Frontend expects:
{
  "user": {
    "name": "..."
  }
}

Backend returns:
{
  "name": "..."
}
```

### Multi-layer drift

A value may differ at several layers:

```text
Frontend:
displayName

Backend:
full_name

Database:
display_name
```

The problem is not limited to whether an endpoint exists. The problem is whether the connected layers agree on what the endpoint means, accepts, and returns.

---

# 3. Why the Problem Matters Now

AI-assisted and rapid application development reduce the cost and time of creating code, but they also make it easier for different parts of a codebase to be generated or modified independently.

A common workflow is:

```text
Prompt AI to build frontend
        ↓
Prompt AI to build backend
        ↓
Developer modifies one side
        ↓
Another developer/agent modifies the other side
        ↓
Integration assumptions diverge
```

The resulting code may compile independently while failing when the application is executed end-to-end.

UNDRIFT therefore focuses on a gap between:

> **"The code exists."**

and

> **"The parts of the code agree."**

---

# 4. Product Goal

UNDRIFT must provide a developer with a continuous, local, IDE-native answer to:

> **"Do the application layers currently agree on their API contracts, and if not, exactly what needs to change?"**

The product should make this possible without requiring the developer to:

- upload source code to another website,
- manually create a complete API contract first,
- leave the IDE,
- run a large manual audit as a separate workflow,
- or wait until runtime failure to discover common integration mismatches.

---

# 5. Target Users

## 5.1 Primary User — Solo Developer

A developer building a full-stack application independently.

Typical workflow:

```text
React frontend
+
Node/Express backend
+
ORM/database
```

The developer may switch between layers frequently and can accidentally introduce integration drift.

### User need

Fast, local feedback without changing development context.

---

## 5.2 Primary User — Small Development Team

Two or more developers work on different layers or features.

Example:

```text
Developer A → frontend
Developer B → backend
Developer C → database
```

UNDRIFT provides a shared, code-derived view of the contracts that connect these layers.

### User need

Visibility into integration assumptions without relying entirely on human communication or stale documentation.

---

## 5.3 Secondary User — AI-Assisted Developer

A developer uses AI coding tools or agents to generate and modify code.

### User need

A continuously updated safety layer that identifies when independently generated code no longer agrees with the rest of the application.

---

# 6. Product Principles

UNDRIFT will follow these principles.

## 6.1 Local First

Source code remains in the developer's workspace for the hackathon MVP.

The core analysis should run locally.

## 6.2 In-Flow, Not Post-Flow

UNDRIFT should be present while the application is being developed, rather than requiring a separate post-development audit.

## 6.3 Explain Before Changing

UNDRIFT should tell the developer:

1. what differs,
2. where the two sides are,
3. why they are considered inconsistent,
4. what the likely impact is,
5. and what change is proposed.

## 6.4 Safe Automation

High-confidence fixes can be directly actionable.

Ambiguous changes should be reviewable before application.

## 6.5 Deterministic Core

Basic contract discovery and comparison should rely on code structure and deterministic analysis wherever possible.

AI reasoning should be reserved for ambiguous semantic cases rather than being required for every scan.

## 6.6 Developer Remains in Control

UNDRIFT proposes and applies changes only through explicit developer actions for the MVP.

The product should not silently modify application code.

---

# 7. Product Scope

## 7.1 MVP Scope

The hackathon MVP will focus on:

### Supported application stack

Primary supported prototype:

- Frontend: React + TypeScript
- Backend: Node.js + Express + TypeScript
- Optional database awareness: Prisma schema

### Primary integration boundary

**Frontend ↔ Backend**

### Secondary integration boundary

**Backend ↔ Prisma schema**

### Core capabilities

1. Discover API consumers in frontend code.
2. Discover API providers in backend code.
3. Extract the important parts of each contract.
4. Normalize the representations into a common contract model.
5. Match frontend consumers to backend providers.
6. Detect mismatches and missing relationships.
7. Maintain contract state as the code changes.
8. Show findings inside VS Code.
9. Explain each finding.
10. Provide selected quick fixes.
11. Re-run analysis after a fix.
12. Present an integration report.

---

# 8. Contract Model

UNDRIFT considers an API contract to consist of the observable agreement between an API consumer and provider.

A contract may contain:

- HTTP method,
- route/path,
- path parameters,
- query parameters,
- request body fields,
- request field types,
- response fields,
- response field types,
- optional/required state,
- nullable state,
- relevant response structure,
- source locations.

For the initial prototype, the product does not require the developer to manually author a contract specification first.

The contract is **discovered from the codebase**.

---

# 9. Contract Lifecycle

Each discovered relationship should move through a recognizable lifecycle.

```text
DISCOVERED
    ↓
WAITING
    ↓
MATCHED
    ↓
VERIFIED
    ↓
DRIFTED
    ↓
REPAIRED
    ↓
VERIFIED
```

Additional state:

```text
ORPHANED
```

An endpoint is considered orphaned when UNDRIFT detects a provider but no known consumer relationship in the supported analysis scope.

---

# 10. Drift Categories

The MVP will classify drift into the following categories.

## 10.1 Missing Endpoint

A frontend consumer exists but no compatible backend provider is found.

## 10.2 Orphan Endpoint

A backend provider exists but no known frontend consumer is found.

## 10.3 Route Mismatch

The expected and provided routes differ.

## 10.4 HTTP Method Mismatch

The consumer and provider use different HTTP methods for a presumed contract.

## 10.5 Request Mismatch

The request body, query, or path parameter expectations differ.

## 10.6 Response Mismatch

The response structure or fields differ from the consumer's expectations.

## 10.7 Type Mismatch

A shared field exists but its expected and provided types are incompatible.

## 10.8 Nullability / Optionality Mismatch

One side treats a value as always present while the other allows it to be null or absent.

## 10.9 Semantic Field Mismatch

Two identifiers appear different syntactically but may represent the same concept.

Example:

```text
userName
user_name
username
displayName
```

Semantic resolution is considered an advanced capability and should not block the deterministic MVP.

---

# 11. Severity Model

UNDRIFT should communicate the practical seriousness of each finding.

## Critical

The relationship is likely to fail or is fundamentally disconnected.

Examples:

- no backend provider for a required frontend API call,
- HTTP method mismatch,
- incompatible required request structure.

## Warning

Both sides exist, but their representations do not agree.

Examples:

- response field mismatch,
- type mismatch,
- nullability mismatch.

## Info

Potentially unused or suspicious behavior that requires context.

Example:

- provider with no known consumer.

Severity is descriptive, not a guarantee that a runtime failure will occur.

---

# 12. Primary User Experience

UNDRIFT should be experienced as an extension of normal coding.

### Initial project open

```text
Developer opens project
        ↓
UNDRIFT activates
        ↓
Workspace analyzed
        ↓
Contracts discovered
        ↓
Integration status displayed
```

Example:

```text
24 contracts discovered

18 verified
3 drifted
2 waiting
1 orphaned
```

---

# 13. Live Monitoring Experience

When relevant source code changes:

```text
Developer edits code
        ↓
UNDRIFT receives workspace change
        ↓
Contract representation updated
        ↓
Affected relationships re-evaluated
        ↓
Diagnostics/report updated
```

The developer should not be required to manually start a full scan after every change.

The implementation may debounce analysis to avoid excessive work during active typing.

---

# 14. IDE Experience

The primary interaction surface is a VS Code extension.

## 14.1 Inline Diagnostic

When UNDRIFT identifies a mismatch, the relevant code should be annotated inside the editor.

Example:

```text
response.userName
        ~~~~~~~~
        UNDRIFT: backend provides user_name
```

---

## 14.2 Hover Explanation

Hovering over a finding should explain:

```text
UNDRIFT — API Contract Drift

Endpoint:
GET /api/users/:id

Frontend expects:
userName: string

Backend provides:
user_name: string

Severity:
Warning

Reason:
The consumer and provider expose different field names
for what appears to be the same response property.
```

---

## 14.3 Quick Fix

Where a high-confidence fix exists:

```text
UNDRIFT: Map user_name → userName
```

The user can:

- review the change,
- apply it,
- modify the proposed change,
- or reject it.

---

## 14.4 Integration Sidebar

The extension should provide a compact overview.

Example:

```text
UNDRIFT

Integration Health

✓ 18 Verified
⚠  3 Drifted
○  2 Waiting
◇  1 Orphaned

Drifted

⚠ PUT /users/:id
⚠ GET /orders/:id
⚠ POST /auth/login

Orphaned

◇ GET /analytics
```

---

## 14.5 Full Integration Report

The user should have a command or sidebar action that opens the current report.

The report should include:

- total contracts,
- verified contracts,
- drifted contracts,
- waiting relationships,
- orphaned providers,
- severity counts,
- detailed findings,
- affected source files,
- suggested fixes where available.

The report should represent the **current state** of the project rather than requiring a separate manual analysis workflow.

---

# 15. Fix Experience

UNDRIFT should support multiple levels of intervention.

## Level 1 — Automatic Quick Fix

For high-confidence, localized changes.

Example:

```text
Backend:
user_name

Frontend:
userName
```

Possible fix:

```text
Map backend user_name → userName
```

The user accepts the fix directly.

---

## Level 2 — Proposed Multi-File Fix

For a change affecting more than one source file.

Example:

```text
Backend serializer
+
Frontend response type
+
Regression test
```

The user should be able to review the proposed edits before applying them.

---

## Level 3 — Manual Resolution

For ambiguous or low-confidence issues, UNDRIFT should provide:

- explanation,
- evidence,
- impacted locations,
- possible resolutions,

while allowing the developer to fix the code manually.

UNDRIFT should not force automation where semantic intent is uncertain.

---

# 16. Product Workflow

The complete MVP workflow is:

```text
                 OPEN PROJECT
                      ↓
              DISCOVER CONTRACTS
                      ↓
             BUILD CONTRACT MAP
                      ↓
                 MATCH LAYERS
                      ↓
            ┌─────────┴─────────┐
            ↓                   ↓
        MATCHED              MISMATCH
            ↓                   ↓
        VERIFIED          EXPLAIN DRIFT
                                ↓
                         SUGGEST FIX
                                ↓
                   ┌────────────┼────────────┐
                   ↓            ↓            ↓
                 APPLY        MODIFY       MANUAL
                   ↓            ↓            ↓
                   └────────────┼────────────┘
                                ↓
                         RE-ANALYZE
                                ↓
                           VERIFIED
```

---

# 17. Functional Requirements

## FR-01 — Workspace Analysis

UNDRIFT shall analyze a supported project workspace and discover supported frontend and backend API contracts.

## FR-02 — Frontend Contract Discovery

UNDRIFT shall identify supported API consumer patterns and extract their relevant contract information.

## FR-03 — Backend Contract Discovery

UNDRIFT shall identify supported API provider patterns and extract their relevant contract information.

## FR-04 — Contract Normalization

UNDRIFT shall convert discovered consumer and provider information into a normalized representation.

## FR-05 — Contract Matching

UNDRIFT shall attempt to match frontend consumers with backend providers using route and method information, followed by structural comparison.

## FR-06 — Drift Detection

UNDRIFT shall detect supported classes of contract mismatch.

## FR-07 — Missing Provider Detection

UNDRIFT shall report supported frontend consumers for which no compatible provider can be found.

## FR-08 — Orphan Detection

UNDRIFT shall report supported backend providers for which no known consumer can be found.

## FR-09 — Source Mapping

Each finding shall identify relevant source files and locations when available.

## FR-10 — Continuous Updates

UNDRIFT shall update analysis after relevant workspace changes.

## FR-11 — Diagnostics

UNDRIFT shall expose supported findings as VS Code diagnostics.

## FR-12 — Explanations

UNDRIFT shall provide an explanation of the expected and actual contract elements involved in a finding.

## FR-13 — Fix Proposals

UNDRIFT shall generate structured fix proposals for supported high-confidence cases.

## FR-14 — Workspace Edits

The VS Code extension shall be able to apply an approved fix to the workspace.

## FR-15 — Reverification

After applying a fix, UNDRIFT shall re-analyze the affected contract and update its status.

## FR-16 — Integration Report

UNDRIFT shall provide a project-level integration report.

## FR-17 — Contract State

UNDRIFT shall track the state of discovered relationships using the defined lifecycle.

## FR-18 — Local Execution

The MVP shall be capable of running locally without requiring a hosted UNDRIFT backend.

---

# 18. Non-Functional Product Requirements

## 18.1 Responsiveness

Common contract edits should produce feedback quickly enough to feel like part of the normal coding loop.

The implementation should avoid performing expensive full-project work on every keystroke.

## 18.2 Reliability

Deterministic checks should produce repeatable results for the same project state.

## 18.3 Transparency

Every finding should expose why UNDRIFT considers it a drift.

## 18.4 Safe Changes

UNDRIFT should never silently rewrite application code.

## 18.5 Privacy

For the hackathon MVP, source analysis is local to the workspace and source code should not be uploaded merely to generate the normal integration report.

## 18.6 Extensibility

The internal product model should allow additional frontend frameworks, backend frameworks, databases, and contract patterns to be added later.

---

# 19. Success Metrics

The hackathon MVP should measure value with a controlled benchmark rather than unsupported industry-wide claims.

## 19.1 Detection Coverage

Measure the percentage of seeded integration issues that UNDRIFT correctly identifies.

Suggested benchmark categories:

- missing endpoint,
- orphan endpoint,
- route mismatch,
- method mismatch,
- response field mismatch,
- request mismatch,
- type mismatch,
- nullability mismatch.

## 19.2 Resolution Time

Compare:

```text
Manual workflow:
identify → diagnose → fix → verify
```

against:

```text
UNDRIFT:
detect → understand → apply → verify
```

The benchmark should report actual measured times from the team's seeded repository.

## 19.3 False Positive Rate

Track the number of reported issues that are intentionally valid relationships in the benchmark project.

## 19.4 Fix Success Rate

For supported automatic fixes:

```text
accepted fixes
      ↓
successfully verified fixes
```

## 19.5 Integration Recovery

Measure:

```text
Number of seeded drifts
        ↓
Number of unresolved drifts
```

after using UNDRIFT's workflow.

---

# 20. Hackathon Demo Success Criteria

A successful demonstration should show a complete before/after workflow.

### Scenario

Use a deliberately broken but realistic full-stack application.

Seed several integration problems.

Example:

```text
2 missing endpoints
2 orphan endpoints
1 method mismatch
2 field mismatches
1 type mismatch
```

### Demonstration flow

1. Open the project.
2. Show the application code.
3. Show UNDRIFT discovering contracts.
4. Show the integration report.
5. Open a detected mismatch.
6. Show the explanation.
7. Apply a suggested fix.
8. Re-run verification.
9. Show the contract moving to verified.
10. Demonstrate at least one live drift appearing after a code change.
11. Show how the developer resolves it without leaving VS Code.
12. State measured benchmark impact.

The video should prioritize the product working in action rather than spending most of the runtime on slides.

---

# 21. Out of Scope for Hackathon MVP

The following are intentionally excluded from the first implementation.

## Unsupported application ecosystems

- Native Android/Kotlin
- Native iOS/Swift
- Flutter
- arbitrary programming languages
- all frontend frameworks
- all backend frameworks

## Advanced API technologies

- GraphQL contract analysis
- gRPC contract analysis
- arbitrary RPC systems
- advanced event-driven contract discovery

## Production platform features

- hosted cloud dashboard
- user accounts
- team management
- SaaS billing
- organization administration
- centralized telemetry
- repository hosting
- Git provider authentication

## Advanced analysis

- perfect understanding of dynamically constructed URLs
- guaranteed discovery of dynamically invoked endpoints
- full runtime behavioral verification
- arbitrary reflection/metaprogramming analysis
- universal semantic equivalence

## Autonomous editing

- silent code modification
- automatic multi-file changes without user approval

These may become future capabilities after the hackathon.

---

# 22. Future Product Direction

After the hackathon, UNDRIFT could expand from API contract drift into a broader application integration intelligence platform.

Potential directions include:

### More Frameworks

```text
React
Vue
Angular
Next.js
NestJS
Django
Spring
Go
etc.
```

### More Boundaries

```text
Frontend ↔ Backend
Backend ↔ Database
Service A ↔ Service B
API ↔ Event Bus
Application ↔ External API
```

### Runtime Verification

Compare discovered/static contracts with actual observed API behavior in development or test environments.

### CI/CD Integration

Run:

```bash
undrift verify
```

during pull requests or CI pipelines.

### Contract History

Track when a contract changed and which source changes caused the drift.

### Semantic Reconciliation

Use AI-assisted reasoning to determine whether differently named fields represent the same semantic concept.

### Team Collaboration

Provide contract changes and drift history at repository level.

---

# 23. Product Risks

## Risk 1 — Dynamic API Patterns

Some applications construct routes or API calls dynamically.

### Mitigation

Constrain the MVP to recognizable static patterns and clearly report when confidence is limited.

---

## Risk 2 — False Orphan Detection

An endpoint may be consumed externally or dynamically and therefore appear unused.

### Mitigation

Use the term "no known consumer" rather than claiming absolute unused status.

---

## Risk 3 — Ambiguous Field Semantics

Fields such as `name`, `displayName`, `title`, and `full_name` cannot always be mapped safely.

### Mitigation

Keep deterministic matching separate from optional semantic reasoning and require user approval for ambiguous fixes.

---

## Risk 4 — IDE Performance

Continuous scanning could become expensive on large projects.

### Mitigation

Use incremental or affected-file analysis where possible and debounce rapid changes.

---

## Risk 5 — Scope Expansion

Trying to support many languages and frameworks within the hackathon could reduce the quality of the core experience.

### Mitigation

Deliver a polished vertical slice for React/TypeScript + Express/TypeScript, with limited Prisma awareness.

---

# 24. Acceptance Criteria for Hackathon MVP

UNDRIFT is considered MVP-complete when all of the following are demonstrated:

### Contract discovery

- [ ] Frontend API consumers are discovered from supported TypeScript patterns.
- [ ] Backend API providers are discovered from supported Express patterns.
- [ ] Relevant request and response structures can be represented.
- [ ] Frontend and backend contracts can be matched.

### Drift detection

- [ ] Missing endpoint is detected.
- [ ] Orphan endpoint is detected.
- [ ] Method mismatch is detected.
- [ ] Request mismatch is detected.
- [ ] Response field mismatch is detected.
- [ ] Type mismatch is detected.
- [ ] At least one nullability/optionality mismatch is detected.

### Developer workflow

- [ ] UNDRIFT runs inside VS Code.
- [ ] Findings appear in the editor.
- [ ] Findings can be inspected.
- [ ] The integration report is accessible without leaving the IDE.
- [ ] At least one drift can be fixed with a quick action.
- [ ] Fixing the issue triggers reverification.
- [ ] The resolved issue changes to a verified state.

### Product validation

- [ ] A seeded demo application contains known integration drifts.
- [ ] UNDRIFT detects the seeded issues.
- [ ] The team records benchmark timings.
- [ ] The final demo shows before/after results.

---

# 25. Relationship to IBM Bob 2.0

IBM Bob 2.0 is a **development tool used by the UNDRIFT team during the hackathon**, not a runtime dependency of the UNDRIFT product.

UNDRIFT users should not require IBM Bob to run the product.

During development, the team will use IBM Bob for activities such as:

- repository exploration,
- implementation planning,
- code generation,
- debugging,
- refactoring,
- test creation,
- documentation,
- and iterative development.

The hackathon guide requires IBM Bob IDE to be a core part of the development process and requires participants to provide evidence of Bob usage through task-session summaries. fileciteturn0file0L96-L108

The product architecture therefore remains independent of IBM Bob.

---

# 26. Product Positioning

UNDRIFT should not be positioned as:

> "Another AI coding assistant."

It should not be positioned as:

> "An AI code reviewer."

It should not be positioned as:

> "A generic API testing platform."

The product should be positioned as:

> **A live integration-awareness layer that reconstructs the implicit contracts between application layers and catches contract drift while developers are still coding.**

### Core value proposition

```text
Without UNDRIFT

Build
  ↓
Integrate
  ↓
Run application
  ↓
Discover mismatch
  ↓
Debug
  ↓
Fix
  ↓
Retest
```

```text
With UNDRIFT

Build
  ↓
Contract observed
  ↓
Contract compared
  ↓
Drift surfaced immediately
  ↓
Explain
  ↓
Fix
  ↓
Continue
```

---

# 27. Example End-to-End Scenario

Consider a full-stack user profile feature.

### Frontend

```ts
const response = await api.get<User>("/api/users/:id");
```

Frontend expects:

```ts
type User = {
  id: string;
  userName: string;
  email: string;
};
```

### Backend

```ts
router.get("/api/users/:id", async (req, res) => {
  const user = await getUser(req.params.id);

  return res.json({
    id: user.id,
    user_name: user.userName,
    email: user.email
  });
});
```

UNDRIFT determines:

```text
Route:
✓ GET /api/users/:id

Request:
✓ compatible

Response:
⚠ field mismatch

Frontend:
userName

Backend:
user_name
```

The developer sees:

```text
⚠ UNDRIFT — Response contract drift

Frontend expects:
userName

Backend provides:
user_name

Likely semantic match.

[Apply suggested mapping]
[Review]
```

The developer accepts the change.

UNDRIFT re-analyzes the relationship.

```text
GET /api/users/:id

✓ Frontend consumer
✓ Backend provider
✓ Request contract
✓ Response contract

STATUS: VERIFIED
```

The important behavior is not merely that an error was detected.

The complete workflow is:

> **Discover → Compare → Explain → Fix → Reverify**

---

# 28. Product North Star

The long-term product goal is to make integration consistency a continuously visible property of an application.

A developer should be able to open a project and immediately answer:

> **Which parts of my application agree, which parts are drifting, why are they drifting, and what can I do about it right now?**

UNDRIFT exists to make that answer available **during development, at the point where integration drift is created—not after the application has already failed.**
