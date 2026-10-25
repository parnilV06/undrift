# UNDRIFT V1 Stack Compatibility Fixture Suite

This directory contains clean, standalone, dependency-free reference fixtures for the supported V1 stack families:

1. **MERN Stack** (`mern-stack/`): React frontend (`fetch` + Axios) + Express backend.
   - _Intended Mismatch_: `/api/auth/login` (Consumer expects `POST`, server declares `GET`). Detected as `UND120` method conflict.
   - _Supported Patterns_: Native `fetch`, Axios static URLs, single-segment template parameters (`/api/posts/${id}`), static pathnames with query parameters (`/api/posts?page=${page}&limit=10`), local object literal resolution for payloads (`registrationData`).
   - _Clean Baseline_: Zero completeness-affecting warnings (`complete: true`, `backendComplete: true`, `consumerComplete: true`).

2. **PERN Stack** (`pern-stack/`): React frontend + Express backend with PostgreSQL-oriented architecture (without requiring a running database).
   - _Intended Mismatch_: `/api/items/:id` (Consumer calls `DELETE /api/items/${itemId}`, server defines `POST /api/items/:id`). Detected as `UND120` method conflict.
   - _Supported Patterns_: Express parameter routes (`:id`), Axios template string parameters, static route endpoints.
   - _Clean Baseline_: Zero completeness-affecting warnings (`complete: true`).

3. **Next.js App Router + TypeScript** (`nextjs-app-router/`): React frontend + App Router Route Handlers (`app/api/**/route.ts`).
   - _Intended Mismatch_: `/api/products/:id` (Consumer calls `PUT /api/products/${id}`, provider exports `DELETE` handler). Detected as `UND120` method conflict.
   - _Supported Patterns_: Named HTTP-method exports (`GET`, `POST`, `PUT`, `DELETE`, etc.), dynamic folder segments (`[id]`), route group folders (`(group)`).
   - _Clean Baseline_: Zero completeness-affecting warnings (`complete: true`).

4. **Next.js Pages Router + TypeScript** (`nextjs-pages-router/`): React frontend + Pages Router API routes (`pages/api/**`).
   - _Intended Mismatch_: `/api/todos` (Consumer calls `POST /api/todos`, provider handles `PUT /api/todos`). Detected as `UND120` method conflict.
   - _Supported Patterns_: Documented switch (`switch (req.method)`) and if-statement (`if (req.method === '...')`) method dispatch patterns.
   - _Partial/Ambiguous Behavior_: `ambiguous.ts` demonstrates an unsupported dynamic dispatch pattern, which emits an `UNSUPPORTED_PATTERN` coverage limitation scoped to `provider`, preserving honesty without fabricating provider methods.

All fixtures are static source code only and do not require external databases, running servers, or framework installations to analyze.

---

## Coverage and Findings Rules

UNDRIFT enforces strict, conservative coverage rules across all V1 stacks:

1. **Scope-Aware Completeness**:
   - `AnalysisWarning.scope` classifies limitations into `"consumer"`, `"provider"`, `"workspace"`, or `"unknown"`.
   - Consumer limitations (e.g., an unresolved Axios payload shape) do not invalidate independently verified provider coverage (`backendComplete: true`).
   - Provider limitations do not invalidate verified consumer coverage (`consumerComplete: true`).

2. **Absence-Based Findings Safety**:
   - Absence-based findings (e.g. `UND100` missing endpoint) are asserted ONLY when the relevant provider scan scope is completely verified (`backendScanComplete: true`).

3. **Provisional Findings**:
   - Positive contract drift findings (e.g. `UND120` method mismatch) discovered during an incomplete scan are presented as **Provisional Findings (Unverified — Incomplete Scan)**.
   - Provisional findings never overwrite the accepted snapshot and never emit false `resolved` lifecycle transitions.

---

## Running Automated Tests

Run the automated acceptance suite for all V1 fixtures:

```bash
npx vitest run tests/integration/v1-compatibility-fixtures.test.ts
```

Run dynamic routes, payload resolution, and coverage regression suites:

```bash
npx vitest run tests/analyzer/v1-dynamic-routes-and-payloads.test.ts
npx vitest run tests/core/v1-coverage-and-reporting.test.ts
```

---

## Manual Smoke-Testing in VS Code Extension Development Host

1. Launch the VS Code Extension Development Host (`F5` in VS Code with the UNDRIFT workspace).
2. Open any fixture subdirectory using **File > Open Folder...** (e.g. `examples/v1-compatibility/mern-stack`).
3. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **UNDRIFT: Scan Workspace Contracts**.
4. Open the **UNDRIFT Integration Report**:
   - Confirm the status is **Contract Divergence Detected** with 1 Active Drift Finding (`UND120`).
   - Confirm **Coverage Limitations** is 0 for clean baselines.
   - Click the primary location link to verify editor navigation to the exact line and character.
5. In `nextjs-pages-router`:
   - Open the folder containing `ambiguous.ts`.
   - Confirm that the report displays the `UNSUPPORTED_PATTERN` coverage limitation in the limitations table with exact source path and line, scoped to `provider`.
