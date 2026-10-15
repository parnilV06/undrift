# UNDRIFT — Product Requirements Document (PRD)

**Document:** `PRD.md`  
**Version:** 1.0-draft  
**Status:** Founder review / product discovery  
**Project:** Personal developer-tool project  
**Initial product surface:** VS Code extension  
**Long-term direction:** Integration intelligence across developer workflows

---

## 1. Executive Summary

UNDRIFT is an IDE-first developer tool that discovers integration contracts between connected parts of an application, detects when those contracts disagree, explains the discrepancy using source-linked evidence, and helps developers review, apply, or manually implement a repair without leaving their normal coding workflow.

A frontend, backend, database layer, generated client, API specification, or separate service can each appear valid in isolation while disagreeing at an integration boundary. These disagreements can lead to undefined values, failed requests, incorrect data handling, broken user flows, delayed testing, and time-consuming debugging.

UNDRIFT's first product surface is planned to be a VS Code extension. Its analysis engine should remain reusable so that a CLI/npm package, commit/CI checks, additional editor integrations, and broader language/framework support may follow without duplicating core logic.

The long-term product ambition is broader than route validation: UNDRIFT should become an integration-intelligence layer that understands what connected components expect, provide, and transform; identifies where those assumptions diverge; explains the likely consequences; and helps developers reconcile them safely.

This PRD separates the long-term vision from the first useful release. It records product requirements and hypotheses without pretending that every technical choice or market assumption has already been validated.

---

# 2. Product Identity

## 2.1 Name

**UNDRIFT** is the current project name. It reflects the central problem: integration assumptions drift as application components evolve, and the product helps bring them back into alignment.

The name is provisional until package names, VS Code Marketplace identifiers, relevant domains, and trademark considerations are checked before public release.

## 2.2 Working Tagline

> **Find the drift. Understand the break. Fix it where you code.**

This tagline is a working draft and may change after prototype testing.

## 2.3 One-Line Description

UNDRIFT continuously discovers integration contracts between application components, detects and explains their drift, and helps developers safely resolve the mismatch directly in the IDE.

---

# 3. Vision and Product Thesis

## 3.1 Vision

Make integration consistency a visible, continuously maintained property of software projects.

A developer should be able to answer:

- What does this component expect?
- What does the other component actually provide?
- Where do they disagree?
- Which files and source changes are involved?
- What may break because of the discrepancy?
- Which representation should be treated as authoritative?
- What is the safest repair?
- Did the repair actually resolve the issue?

UNDRIFT should answer these questions using evidence from source code and, as the product matures, additional evidence from specifications, generated clients, Git history, tests, and runtime observations.

## 3.2 Product Thesis

Connected application components are often created and modified independently—by developers, teams, generators, or AI coding tools. Code may be locally plausible while assumptions at the integration boundary no longer agree.

UNDRIFT reduces the effort to discover, understand, and resolve integration inconsistencies by maintaining a current, explainable model of the contracts connecting components.

## 3.3 Product Philosophy

UNDRIFT should fit into a developer's normal workflow rather than require a separate workflow just to use it. The IDE should offer continuous awareness, unobtrusive status, contextual findings, explicit reports, and actionable repair options.

AI-assisted development is an important motivating context, but the product is for developers generally. The integration problem also occurs in manually written software, team-based development, and existing codebases.

---

# 4. Problem Statement

## 4.1 Core Problem

Connected application layers frequently make different assumptions about the same interaction.

Example:

```text
Frontend expects:
GET /api/users/:id
response.userName: string

Backend provides:
GET /api/user/:id
response.user_name: string

Database stores:
display_name
```

The frontend, backend, and schema can each be syntactically valid while the integrated feature remains incorrect.

A developer may discover the mismatch only after tracing files, running the application, inspecting network requests, reading logs, or debugging a broken user flow.

## 4.2 Types of Integration Failure

### Existence drift
An expected endpoint or required field is not discovered on the other side.

### Route or protocol drift
The route, HTTP method, parameters, or other supported protocol details disagree.

### Request-shape drift
The consumer sends fields or types that the provider does not expect.

### Response-shape drift
The consumer expects fields, types, nesting, or formats that the provider does not return.

### Type / optionality / nullability drift
The two sides disagree about the type or whether a value may be missing or null.

### Transformation drift
A naming or structure conversion between layers is expected, but the transformation is absent, stale, or inconsistent.

### Evolution drift
A previously compatible contract changes on one side while connected components remain on the earlier representation.

### Evidence drift
Source code, an API specification, a generated client, tests, or runtime behavior disagree with each other.

The first release will focus on the contract differences that can be reliably inferred from supported source patterns. More advanced behavioral and evidence conflicts are future capabilities.

## 4.3 Common Causes

- A frontend call is added without a corresponding backend route.
- A backend route is implemented but no consumer is discovered in the analyzed scope.
- A route or HTTP method changes on one side only.
- Field names, types, optionality, nullability, or object structures diverge.
- A serializer, mapper, ORM model, or schema changes but connected code is not updated.
- A generated SDK or shared type becomes stale.
- Frontend and backend work is split across developers or repositories.
- An AI coding tool generates or modifies one layer without preserving the other layer's assumptions.
- Tests or API documentation are incomplete or stale.

## 4.4 Cost to Validate

Likely costs include time spent tracing files, context switching, delayed issue discovery, manual integration testing, fixes made in the wrong layer, and regressions from incomplete changes.

The frequency and magnitude of these costs are hypotheses to validate with developers. UNDRIFT must not claim universal productivity gains without measured evidence.

---

# 5. Product Opportunity

UNDRIFT must do more than say two strings differ.

A useful finding should answer:

1. **What is inconsistent?**
2. **What was expected and what was found?**
3. **Where is each side defined?**
4. **Why does the discrepancy matter?**
5. **What is the likely cause, if evidence supports that conclusion?**
6. **Which connected code may be affected?**
7. **What repair is suggested, and what evidence supports it?**
8. **Can the developer review, apply, modify, reject, or manually make the repair?**
9. **Did a subsequent analysis verify the relationship again?**

UNDRIFT must distinguish facts from inference. If the exact cause cannot be established, it should describe the observed mismatch and state that the cause is unknown or only suspected.

---

# 6. Target Users

UNDRIFT is a general developer utility rather than a product restricted to one job title or coding style.

## 6.1 Solo Developers

Developers who move between frontend, backend, and data-layer code.

**Need:** Find integration discrepancies without manually tracing the entire codebase.

## 6.2 Developers Working in Teams

Developers who own different layers, features, or repositories.

**Need:** Make integration assumptions visible without relying entirely on communication or stale documentation.

## 6.3 AI-Assisted Developers

Developers using code completion, code generation, agents, or prompt-driven application builders.

**Need:** Catch drift introduced when independently generated or modified components do not preserve the same contract.

## 6.4 Developers Maintaining Existing Applications

Developers working in growing, older, frequently changing, or incompletely documented codebases.

**Need:** Reconstruct enough of the implementation to identify mismatches even when a single source of truth is missing.

## 6.5 Teams with Existing API Tooling

Teams using API specifications, generated clients, shared types, contract tests, or other API tooling.

**Need:** Potentially reconcile evidence across these artifacts rather than being forced to discard existing tools.

These segments are hypotheses, not validated market conclusions. Prototype evaluation and developer research should guide prioritization.

---

# 7. Core Use Cases

## UC-01 — Missing provider
A frontend consumer exists but no compatible backend provider is found in the supported analysis scope. UNDRIFT shows the method, route, consumer location, and analysis limitation.

## UC-02 — Provider with no known consumer
A backend route exists but no internal consumer is discovered. UNDRIFT labels it as having **no known consumer**, not as definitely unused.

## UC-03 — Route or method mismatch
The consumer and provider appear related but use different paths or methods. UNDRIFT shows both definitions and the conflict.

## UC-04 — Request-shape mismatch
The consumer sends fields or types that disagree with the provider's expected request.

## UC-05 — Response-shape mismatch
The consumer expects a response field or structure that the provider does not return, or the provider returns an incompatible shape.

## UC-06 — Type / optionality / nullability mismatch
Both sides refer to a field but disagree about its type, presence, or nullability.

## UC-07 — Explain a finding
The developer opens a finding and sees relevant source locations, evidence, likely impact, and a proposed resolution.

## UC-08 — Review and apply a repair
The developer reviews a suggested edit, applies it, modifies the code manually, or rejects the suggestion. UNDRIFT then re-analyzes the affected relationship.

## UC-09 — Detect drift during coding
A contract-related source change updates UNDRIFT's model without requiring the developer to leave the IDE or start a manual full scan.

## UC-10 — Request a project report
The developer opens the sidebar or runs a command to see current integration health, findings, and affected files.

## UC-11 — Check before commit
The developer optionally checks staged changes before committing. This is a later workflow and should be backed by a reusable command/Git integration, not only by an IDE notification.

## UC-12 — Explain change impact
A change to a route, response type, or shared definition is traced to the connected relationships UNDRIFT can identify. Broad change-causality and full impact analysis may follow after the initial release.

---

# 8. Product Principles

## 8.1 IDE-first, not IDE-only
The initial interface is a VS Code extension, but analysis logic should be reusable for later CLI, npm, CI, and editor integrations.

## 8.2 Continuous awareness, controlled interruption
UNDRIFT may analyze relevant changes in the background, but should not interrupt developers for every low-confidence or informational finding.

## 8.3 Evidence before assertion
Every finding should retain the facts that produced it: routes, methods, fields, types, source locations, and supported relationships.

## 8.4 Explain before repair
Show why a change is recommended before asking the developer to apply it.

## 8.5 Safe by default
Never silently modify source. Distinguish mechanical fixes from suggestions that require review or manual resolution.

## 8.6 Deterministic first, semantic reasoning when needed
Analyze routes, methods, explicit fields, and available types deterministically where possible. Mark semantic inference as inference.

## 8.7 Source is not always truth
Frontend code, backend implementation, database schema, specifications, generated clients, tests, and runtime observations may disagree. No layer is universally authoritative.

## 8.8 Recognize intentional transformations
A database may use snake_case while an API uses camelCase through an intentional serializer. Such differences should not automatically be called drift if the transformation is understood or explicitly configured.

---

# 9. Product Scope and Release Strategy

The long-term product vision must not be confused with the first usable release.

## 9.1 V0 — Proof-of-Value Prototype

V0 proves the complete central workflow on one selected, supported stack.

It should:

- discover supported frontend API consumers;
- discover supported backend API providers;
- normalize the observations;
- detect a practical set of mismatches;
- show findings inside VS Code;
- explain a finding with source references to both sides where available;
- offer at least one reviewable fix;
- apply an accepted change through the IDE;
- re-analyze and verify the result.

V0 is a learning milestone, not the permanent product limit.

## 9.2 V1 — Useful IDE Product

V1 should harden the prototype into a tool another developer can install and evaluate:

- robust workspace and project discovery;
- dependable extraction for explicitly documented patterns;
- route, method, request, response, field, type, optionality, nullability, and nested-shape checks where statically available;
- precise source mapping;
- a persistent sidebar and integration report;
- unobtrusive status and selective notifications;
- meaningful explanations with evidence and uncertainty;
- safe/reviewable Quick Fixes for supported cases;
- manual-resolution flow;
- incremental re-analysis;
- ignore/suppression rules for intentional exceptions;
- explicit handling of unsupported dynamic patterns;
- fixtures and tests covering valid relationships as well as known drift;
- documentation of setup, supported patterns, limitations, and privacy behavior.

Framework coverage, performance targets, and final dependency choices will be settled in the TRD after technical experiments.

## 9.3 V1.x — Developer Workflow Integration

Potential additions:

- CLI/npm package;
- staged-change checks;
- pre-commit/pre-push integration;
- CI checks;
- baselines and suppression configuration;
- Git diff awareness;
- contract-change summaries;
- additional repair rules.

## 9.4 V2 — Contract Ecosystem

Potential additions:

- OpenAPI and other API specifications;
- generated SDK/client relationships;
- shared validation schemas;
- contract tests and their results;
- project-defined source-of-truth policies;
- richer multi-file impact analysis;
- additional frontend/backend framework adapters.

## 9.5 Later — Runtime and Multi-Service Intelligence

Potential directions:

- opt-in runtime observations;
- static-versus-runtime discrepancy analysis;
- service-to-service and multi-repository contracts;
- events, webhooks, and message contracts;
- more languages and ecosystems;
- additional editor adapters;
- team and pull-request workflows.

These are options to validate, not commitments to implement immediately.

---

# 10. V1 Interface Requirements

## 10.1 Primary interface
A VS Code extension providing:

- a sidebar/activity entry;
- current integration status;
- drift findings grouped by severity/category;
- source diagnostics;
- hover explanations;
- code actions/Quick Fixes;
- a full report;
- commands to analyze or refresh.

## 10.2 Passive, contextual, and explicit interactions

**Passive:** an unobtrusive status indicator reports whether actionable findings exist.

**Contextual:** a source location may display a diagnostic or relevant code action.

**Explicit:** the developer opens the report or runs a command to analyze, refresh, explain, or request a fix.

## 10.3 Notifications
Notifications should be selective and configurable. Unchanged findings should not repeatedly notify the user. New, high-confidence actionable drift may deserve a badge or notification; informational findings should generally remain passive.

The exact UI mechanism will be validated during implementation.

## 10.4 Inline suggestions and Quick Fixes
Inline preview may be used where appropriate, but code actions are the primary repair mechanism because mismatches often concern existing code or multiple files.

A developer must be able to accept, review, modify manually, reject, or dismiss a suggested repair.

---

# 11. Contract and Drift Model

## 11.1 Contract Definition

For UNDRIFT, a contract is the observable agreement at a communication boundary.

For HTTP APIs, it may include:

- method and route;
- path, query, and header parameters;
- request body schema;
- response schema;
- field types;
- required/optional state;
- nullability;
- status codes;
- error-response shape;
- auth expectations;
- content type and format constraints.

Not all dimensions must be supported in V1.

## 11.2 Drift Categories

### Existence drift
A required consumer/provider, route, or field is not discovered on the other side.

### Structural drift
Fields, types, nesting, optionality, or nullability differ.

### Protocol/behavioral drift
Supported protocol metadata or behavior disagrees, such as method, status code, error format, or content type.

### Transformation drift
A mapping between layers is intended, but is missing, stale, or inconsistent.

### Evolution drift
One side of a previously aligned contract changes without corresponding changes to connected components.

### Evidence drift
Source code, specifications, generated clients, tests, or runtime behavior disagree.

The first release focuses on static differences that can be reliably inferred. It should not claim to prove runtime behavior from source code alone.

## 11.3 Status Semantics

- **Discovered:** a contract observation was extracted.
- **Waiting:** one expected side has not been found in the supported scope.
- **Matched:** a likely consumer/provider pair exists, but compatibility has not been fully established.
- **Verified:** supported checks found no unresolved mismatch for the relationship.
- **Drifted:** one or more supported checks found an incompatibility.
- **Orphaned:** a provider has no known consumer in the analyzed scope.
- **Ignored/Suppressed:** a developer intentionally suppresses a finding under explicit rules.

“Repaired” may be a transient UI event. Final status must be based on re-analysis, not merely on successful file editing.

## 11.4 Severity and Confidence
Severity and confidence are separate:

- **Severity** estimates practical impact.
- **Confidence** describes the strength of evidence for the finding or inferred relationship.

The product must not imply calibrated statistical certainty without evaluation.

---

# 12. Explanation Requirements

Explanation is a core capability, not decorative AI text.

A useful finding should include:

1. **Summary:** a concise statement of the inconsistency.
2. **Expected:** what the consumer or reference artifact expects.
3. **Actual:** what the provider or implementation supplies.
4. **Locations:** file, line, and relevant range for each side where available.
5. **Evidence:** the route, method, field, type, schema, or relationship that supports the finding.
6. **Impact:** what may fail, clearly distinguishing likely consequences from guaranteed behavior.
7. **Cause:** a changed file or edit when supported; otherwise say the exact cause is unknown.
8. **Resolution:** a recommended action and proposed edit where available.
9. **Uncertainty:** limitations caused by dynamic code, external consumers, incomplete analysis, or ambiguous semantics.

Example:

```text
UNDRIFT — Response contract drift

Endpoint:
GET /api/users/:id

Frontend expects:
userName: string
src/components/UserCard.tsx:24

Backend returns:
user_name: string
src/routes/users.ts:41

Why this matters:
The frontend reads userName, but the returned object contains
user_name. Unless a transformation occurs before the value is
consumed, the expected property may be undefined.

Suggested action:
Review the serializer/consumer mapping.

Evidence:
Same discovered endpoint and compatible string field; the
field names differ. No confirmed mapping was found.
```

---

# 13. Fix Requirements

## 13.1 Repair levels

### Level 1 — Mechanical fix
A localized, high-confidence source edit, such as correcting a field reference when the intended mapping is unambiguous.

### Level 2 — Reviewed multi-file fix
A repair that changes multiple related files, such as serializer, client type, and tests. The user should review the affected edits.

### Level 3 — Manual resolution
Used when several interpretations are plausible or the authoritative contract is unclear. UNDRIFT explains the evidence and options without forcing a choice.

### Level 4 — Generated implementation
Future capability to generate a missing provider stub, schema, test, or related artifact. Not required for the first useful release.

## 13.2 Every Fix Proposal Must Explain
- what will change;
- which files are affected;
- why the change is recommended;
- what assumptions are being made;
- whether the change is mechanical or inferred;
- and how success will be checked.

## 13.3 Developer Control
No silent source modification. The developer must initiate or approve application of a change.

## 13.4 Reverification
After an accepted edit, UNDRIFT re-analyzes the affected relationship. Applying a patch is not proof of correctness; the current source must pass the relevant checks.

---

# 14. Source of Truth and Intentional Transformations

Not every difference is a bug.

Example:

```text
Database:
display_name

Backend serializer:
displayName

Frontend:
displayName
```

This may be an intentional transformation.

UNDRIFT should gradually distinguish:

- direct compatibility;
- intentional transformation;
- incompatibility;
- unresolved ambiguity.

Potential evidence includes serializers/mappers, shared types, validation schemas, API specifications, generated clients, tests, configuration, Git changes, and opt-in runtime observations.

UNDRIFT must not assume that the frontend, backend, database, or API specification is always authoritative. A project-defined source-of-truth policy may help, but conflicts should remain explainable.

---

# 15. Local-First and Privacy Requirements

The first release should analyze source locally and should not require a hosted UNDRIFT service.

Requirements:

- no cloud account required for basic analysis;
- no external database required;
- no source-code telemetry by default;
- no raw source logging during normal operation;
- avoid collecting secret values as contract evidence;
- disclose what data is sent if an optional external semantic service is introduced;
- keep project configuration and suppression data local by default.

Privacy behavior must be documented clearly before public release.

---

# 16. Scope Boundaries

## 16.1 In scope for V0/V1

- IDE-native workflow;
- supported consumer/provider discovery;
- route and method matching;
- request/response shape comparison;
- field, type, optionality, nullability, and nesting checks where statically observable;
- missing-provider findings;
- “no known consumer” findings;
- source mapping to both sides;
- actionable explanations;
- safe Quick Fixes for selected cases;
- reviewable repairs;
- reverification;
- current integration report;
- suppression of intentional findings;
- explicit handling of unsupported/dynamic patterns;
- labeled test fixtures containing valid and broken relationships.

## 16.2 Not required for V1

- universal language/framework support;
- perfect understanding of dynamic routes or reflection;
- guaranteed discovery of external consumers;
- runtime traffic interception;
- a complete API management platform;
- replacing OpenAPI, Pact, or API testing products;
- autonomous architectural refactoring;
- hosted team management or billing;
- full visual graph editing;
- silent source changes;
- automatic resolution of every mismatch.

## 16.3 Areas to evaluate later

- Git history and change attribution;
- API specification and generated-SDK ingestion;
- CLI/npm package;
- pre-commit and CI checks;
- runtime evidence;
- multi-repository/service-to-service analysis;
- additional languages/frameworks;
- other IDE adapters;
- team collaboration and contract history.

---

# 17. Product Positioning and Differentiation Hypothesis

UNDRIFT operates near static API analysis, contract testing, API specification validation, generated-client workflows, and runtime monitoring. API drift detection itself is not claimed to be new.

The differentiation hypothesis is the combined workflow:

> **UNDRIFT continuously surfaces integration drift inside the developer's existing IDE, explains both sides using source-linked evidence, identifies likely impact, offers a reviewable repair at the point of work, and verifies the result.**

Potential differentiators to validate:

1. IDE-first, low-friction setup.
2. Discovery from existing source without requiring a complete manually authored contract first.
3. Source-linked explanation of both sides.
4. Actionable repair rather than a report alone.
5. Continuous state and reverification.
6. Careful handling of intentional transformations and uncertain findings.
7. A path from editor feedback to CLI/commit/CI checks using shared analysis logic.

These are hypotheses until tested against comparable tools and real developer workflows. Public competitive claims must be specific, current, and verifiable.

---

# 18. Product Validation Plan

Prototype testing should precede or accompany a developer survey. The goal is to learn about actual workflows rather than collect generic agreement that the idea sounds useful.

## 18.1 Prototype Evaluation

Ask developers to use or observe a supported sample project and evaluate:

- whether UNDRIFT detects known discrepancies;
- whether it reports false positives on valid relationships;
- whether the explanation identifies the expected and actual values;
- whether the source locations are enough to find the problem;
- whether the suggested fix is safe and useful;
- whether they would accept, modify, or reject the fix;
- whether the notifications are helpful or distracting;
- whether installation and setup fit their normal workflow.

## 18.2 Survey Hypotheses

The survey should investigate:

- how often integration mismatch occurs;
- when it is discovered;
- which drift categories cause the most rework;
- what is currently used to prevent it;
- preferred intervention point: IDE, save, commit, PR, CI, or runtime;
- amount of explanation developers need;
- trust requirements for proposed fixes;
- common stacks and repo structures;
- what would cause them to disable or uninstall such a tool.

## 18.3 Avoid Leading Questions

Ask about recent incidents and current practices before presenting UNDRIFT. Do not assume that AI is the cause, that developers experience the issue frequently, or that a new tool is necessarily their preferred solution.

---

# 19. Success Metrics

The primary goal is useful, trusted resolution—not maximizing the number of warnings.

## 19.1 Detection quality
- true positives on labeled fixtures;
- false positive rate;
- missed seeded drifts;
- accuracy by drift category;
- unsupported-pattern reporting.

## 19.2 Explanation quality
Can a developer identify the expected value, actual value, and likely consequence without manually searching the entire repository?

Assess this through prototype tasks and feedback.

## 19.3 Repair quality
- fix acceptance rate;
- fix modification/rejection rate;
- successful reverification rate;
- regressions introduced by proposed repairs;
- time from finding to verified resolution.

## 19.4 Workflow fit
- installation/setup time;
- time to first useful result;
- notification noise;
- whether the tool stays enabled;
- repeat use across sessions.

## 19.5 Productivity evidence
Compare manual identification, diagnosis, repair, and verification against the UNDRIFT workflow on labeled benchmark cases. Report measured results with the benchmark setup and limitations. Do not extrapolate small synthetic tests into universal claims.

---

# 20. V1 Acceptance Criteria

V1 should meet these outcomes for the explicitly supported patterns.

## Discovery
- [ ] Discover supported frontend API consumers.
- [ ] Discover supported backend API providers.
- [ ] Extract route, method, and available request/response shape.
- [ ] Resolve common explicit types where feasible.
- [ ] Retain source locations for actionable findings.
- [ ] Report unsupported or unresolved patterns clearly.

## Detection
- [ ] Detect a consumer with no compatible discovered provider.
- [ ] Detect a provider with no known consumer in the analysis scope.
- [ ] Detect route and method mismatches when the relationship is sufficiently supported.
- [ ] Detect missing/extra request and response fields where statically observable.
- [ ] Detect supported type, optionality, nullability, and nested-shape mismatches.
- [ ] Avoid treating every naming transformation as drift.
- [ ] Distinguish observed mismatch from inferred semantic equivalence.

## Explanation
- [ ] Identify relevant consumer/provider locations where available.
- [ ] Show expected and actual values.
- [ ] Explain the discrepancy and likely consequence.
- [ ] Distinguish likely impact from guaranteed behavior.
- [ ] Disclose uncertainty and incomplete analysis.

## Repair
- [ ] Offer fixes for supported deterministic cases.
- [ ] Let the developer review or accept a proposed change.
- [ ] Allow manual correction without requiring UNDRIFT to apply a fix.
- [ ] Never silently modify source.
- [ ] Re-analyze after edits.
- [ ] Verify resolution from current source state.

## Workflow
- [ ] Install and activate as a VS Code extension.
- [ ] Provide an accessible sidebar/report.
- [ ] Update findings after relevant workspace changes.
- [ ] Avoid repeated notifications for unchanged findings.
- [ ] Provide an explicit analyze/refresh command.
- [ ] Keep normal analysis local by default.

## Validation
- [ ] Include labeled fixtures with both valid relationships and known drifts.
- [ ] Measure detection quality and false positives.
- [ ] Run a small prototype evaluation with developers.
- [ ] Record limitations and prioritize improvements using evidence.

---

# 21. Risks and Mitigations

## Risk 1 — Existing tools cover some features
**Risk:** Basic route mismatch and orphan detection may not be sufficiently differentiated.

**Mitigation:** Focus on the full IDE workflow, source-linked explanation, repair review, low-noise behavior, and reverification. Test these advantages against current tools.

## Risk 2 — Static analysis cannot see all behavior
**Risk:** Dynamic URLs, reflection, indirect calls, external clients, and runtime transformations may be invisible.

**Mitigation:** Define supported patterns, report uncertainty, and add runtime/specification evidence only when justified.

## Risk 3 — False positives reduce trust
**Risk:** Intentional serializers, generated files, public APIs, and dynamic consumers can look like drift.

**Mitigation:** Represent transformation boundaries, provide suppression/configuration, and measure false positives.

## Risk 4 — Wrong-side fixes
**Risk:** Changing the frontend when the backend is correct, or vice versa, may make the project worse.

**Mitigation:** Show evidence, preserve ambiguity, allow a project-defined source of truth, and require review for uncertain or multi-file fixes.

## Risk 5 — IDE interruptions
**Risk:** Continuous findings may distract developers.

**Mitigation:** Prefer passive status and contextual feedback; keep notifications selective and configurable.

## Risk 6 — Scope expansion
**Risk:** Building too many languages, protocols, runtime modes, and entry points at once delays a useful release.

**Mitigation:** Prove one strong end-to-end workflow first while keeping interfaces extensible.

## Risk 7 — Performance
**Risk:** Full-project parsing on every edit could make the extension slow.

**Mitigation:** Debounce events, cache unchanged analysis, and progressively introduce incremental re-analysis.

## Risk 8 — Name/namespace conflict
**Risk:** The name or desired package/extension identifier may conflict with another project.

**Mitigation:** Check package, Marketplace, domain, and relevant trademark considerations before public launch.

---

# 22. Decisions Deferred to the TRD

The following must be chosen after technical evaluation rather than presumed from the previous hackathon scaffold:

- TypeScript Compiler API / ts-morph versus alternative parser approaches;
- whether a hybrid parser architecture is worthwhile for future language support;
- direct extension-to-Core calls versus a separate language-server process;
- the achievable level of incremental analysis;
- the first supported framework patterns;
- how custom API clients and mounted route prefixes are resolved;
- how imported types and schemas are traced;
- how intentional transformations are recognized or configured;
- when CLI and Git integration should be added;
- the configuration/suppression model;
- performance and test coverage targets;
- which repair classes can safely be automatic.

The product requirements should drive these decisions—not the existing scaffold.

---

# 23. Roadmap

## Milestone 0 — Product baseline
- Review this PRD.
- Resolve key scope questions.
- Review current alternatives.
- Select a supported prototype project and patterns.

**Exit condition:** The product goal and first supported workflow are explicit.

## Milestone 1 — Analysis proof of concept
- Extract consumers and providers.
- Normalize route/method and schema information.
- Detect a set of known drifts.
- Test against valid relationships and labeled fixtures.
- Record misses and false positives.

**Exit condition:** The core finds useful, reproducible problems in a controlled project.

## Milestone 2 — IDE proof of concept
- Activate in VS Code.
- Display source-linked findings.
- Provide a sidebar/report.
- Refresh after source changes.

**Exit condition:** A developer can discover and inspect drift within the coding workflow.

## Milestone 3 — Repair loop
- Generate safe fix proposals.
- Apply through a native editor action.
- Re-analyze and verify the result.

**Exit condition:** At least one representative issue completes the full detect → explain → repair → verify loop.

## Milestone 4 — Prototype validation
- Test with a small group of developers.
- Run the survey.
- Collect false positives, friction, missed issues, and workflow feedback.
- Prioritize changes based on evidence.

**Exit condition:** A clear next milestone is supported by real feedback.

## Milestone 5 — V1 hardening
- Improve reliability, performance, and suppression behavior.
- Document supported patterns and limitations.
- Prepare a public preview when quality and naming checks are complete.

---

# 24. Open Product Questions

These are intentionally unresolved:

1. Which frontend API-call and backend route patterns must be supported first?
2. Should analysis use a short debounce, on-save checks, or a combination?
3. Which findings are reliable enough to appear by default?
4. What severity/confidence thresholds are useful without generating noise?
5. How should UNDRIFT detect or learn intentional transformations?
6. Should a project name OpenAPI or another artifact as its source of truth?
7. How much Git change/history context belongs in V1?
8. Which fixes are safe as one-click actions, and which require multi-file review?
9. Should staged-change/commit checks arrive in V1.x or later?
10. Which ecosystem should be supported after the first one?
11. How should public, external, webhook, and dynamically consumed endpoints be classified?
12. What evidence do developers need before trusting explanations and repairs?
13. What is the best way to handle multiple repositories that contain opposite sides of an API boundary?
14. Which capabilities are genuinely differentiating after direct comparison with existing tools?

---

# 25. Product Definition for the Current Phase

UNDRIFT is defined as:

> **An IDE-first integration-intelligence tool that discovers contracts between connected application components, detects and explains their drift using source-linked evidence, helps developers review and apply repairs, and verifies whether the integration has returned to a consistent state.**

The first release should prove this experience in a well-supported ecosystem. The architecture should leave room for future CLI/CI workflows, specifications, generated clients, Git change intelligence, runtime evidence, multiple languages, and service-to-service contracts without making those capabilities prerequisites for V1.

The core product loop is:

```text
DISCOVER
   ↓
MATCH
   ↓
DETECT
   ↓
EXPLAIN
   ↓
PROPOSE
   ↓
REVIEW / APPLY
   ↓
RE-ANALYZE
   ↓
VERIFY
```

The product succeeds when that loop is useful, trustworthy, low-friction, and demonstrably better for a developer than their current approach to finding and resolving integration problems.
