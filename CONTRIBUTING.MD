# Contributing to UNDRIFT

First off, thank you for considering contributing to UNDRIFT.

UNDRIFT is an open-source developer tool, and contributions from developers, testers, and documentation writers can help make it more reliable and useful.

This guide explains how to get started, understand the codebase, make changes, run tests, and submit a pull request.

For a deeper understanding of the product and its internal design, refer to the documentation in [`docs/`](docs/).

---

## Before You Start

Before beginning work on a change:

1. Check the [existing issues](https://github.com/parnilV06/undrift/issues) to see whether the problem or feature has already been reported.
2. For larger changes or new functionality, open an issue first to discuss the proposed approach.
3. For bug fixes, try to reproduce the issue and identify the affected component before changing code.
4. Keep contributions focused. Avoid combining unrelated fixes, refactors, and feature additions in one pull request.

Contributions are welcome in areas such as:

- Bug fixes and reliability improvements.
- Parser and language-extraction improvements.
- API contract matching and drift detection.
- Performance and workspace-analysis improvements.
- VS Code extension UI and developer experience.
- Automated tests, documentation, and examples.

## Understanding the Codebase

UNDRIFT is structured as an npm workspaces monorepo. Its architecture separates the analysis engine, source parser, language-specific extractors, and IDE integration.

You do not need to understand the entire codebase before contributing. Start with the component relevant to your change.

### Repository Structure

| Directory | Responsibility |
|---|---|
| `apps/vscode-extension/` | VS Code extension integration, activation, workspace management, diagnostics, fixes, commands, views, and reports. |
| `packages/core/` | Editor-independent domain models, contract normalization, candidate matching, drift rules, guidance, and state reconciliation. |
| `packages/parser-tree-sitter/` | Tree-sitter WebAssembly runtime, grammar registry, syntax-node abstraction, and source-position mapping. |
| `packages/analyzer-js-ts/` | JavaScript/TypeScript API extraction, frontend and backend analyzers, project indexing, and supported-pattern registry. |
| `docs/` | Product and technical documentation, architecture specifications, and development instructions. |
| `tests/` | Unit, integration, regression, and extension-related tests. |
| `examples/` | Example projects and compatibility fixtures used to demonstrate supported patterns. |

### Where Should I Make My Change?

Use this as a starting point when navigating the codebase.

| What you want to work on | Start here |
|---|---|
| API contract models or domain types | `packages/core/src/domain/` |
| Route or shape normalization | `packages/core/src/normalization/` |
| Consumer/provider matching | `packages/core/src/matching/` |
| Drift detection rules | `packages/core/src/rules/` |
| Diagnostic explanations and guidance | `packages/core/src/guidance/` |
| Tree-sitter parsing and syntax handling | `packages/parser-tree-sitter/src/` |
| Fetch or Axios extraction | `packages/analyzer-js-ts/src/frontend/` |
| Express or Next.js extraction | `packages/analyzer-js-ts/src/backend/` |
| Supported extraction patterns | `packages/analyzer-js-ts/src/support-matrix.ts` |
| VS Code activation and analysis scheduling | `apps/vscode-extension/src/activation/` |
| Diagnostics and hover information | `apps/vscode-extension/src/diagnostics/` |
| Code actions and automated fixes | `apps/vscode-extension/src/fixes/` |
| Sidebar and Integration Report | `apps/vscode-extension/src/views/` |
| Workspace snapshots and file handling | `apps/vscode-extension/src/workspace/` |

### Important Architectural Boundaries

A few architectural principles are particularly important when contributing:

- **Keep the core editor-independent.** `packages/core` must not depend on VS Code APIs or Tree-sitter implementation details.
- **Keep parsing separate from analysis policy.** The parser provides syntax structures; language analyzers extract API observations; the core evaluates contracts.
- **Preserve deterministic analysis.** Findings should be based on explicit, traceable source evidence rather than guesses.
- **Preserve uncertainty.** When the source cannot be analyzed confidently, report the relevant limitation instead of silently assuming a contract.
- **Keep the product local-first.** Do not introduce unnecessary cloud services or remote source-code processing into the standard analysis workflow.

For a deeper architectural explanation, read [`docs/HLD.md`](docs/HLD.md) and [`docs/LLD.md`](docs/LLD.md).

---

## Setting Up Your Development Environment

### Prerequisites

- Node.js 18 or later. Node.js 22 LTS is recommended.
- npm 9 or later.
- Visual Studio Code 1.100 or later for extension development and debugging.
- Git.

### 1. Fork and Clone the Repository

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-username>/undrift.git
cd undrift
```

### 2. Install Dependencies

Install the monorepo dependencies from the repository root:

```bash
npm install
```

Use the root package manager configuration rather than installing dependencies independently inside individual workspaces.

### 3. Build the Project

```bash
npm run build
```

This builds the analysis packages and bundles the VS Code extension.

### 4. Verify Your Setup

Run the automated checks:

```bash
npm test
npm run typecheck
npm run lint
```

You can also run:

```bash
npm run format:check
```

---

## Working on UNDRIFT

### Understanding the Analysis Flow

A simplified view of how the main components work together:

1. The VS Code extension obtains workspace source files and editor buffers.
2. The Tree-sitter parser converts supported source code into syntax structures.
3. The JavaScript/TypeScript analyzer extracts frontend consumers and backend providers.
4. The core normalizes and matches the extracted contracts.
5. The drift rules evaluate contract compatibility.
6. Findings and evidence are returned to the extension for diagnostics, guidance, and reporting.

When investigating an issue, trace the relevant data through these layers before changing implementation details.

The [High-Level Design](docs/HLD.md) and [Low-Level Design](docs/LLD.md) documents explain this flow in more detail.

### Adding or Improving Extraction Support

New extraction patterns require particular care because incorrect extraction can lead to misleading findings.

When adding or improving a supported pattern:

1. Identify the exact source-code syntax or construct being supported.
2. Implement the extraction or resolution logic in the appropriate analyzer.
3. Add representative test cases covering the new behavior.
4. Include relevant ambiguous or unsupported cases where appropriate.
5. Update `packages/analyzer-js-ts/src/support-matrix.ts` when supported coverage changes.
6. Update relevant documentation and examples.

Do not silently broaden existing heuristics to recognize patterns that have not been validated.

### Working with Test Fixtures

UNDRIFT uses test fixtures to verify how source code is interpreted and how contracts are compared.

Useful locations include:

- `tests/fixtures/workspaces/` — synthetic source workspaces.
- `tests/fixtures/golden/` — expected analysis results.
- `tests/integration/` — cross-component and compatibility tests.
- `examples/v1-compatibility/` — reference fixtures for supported V1 stack families.

Prefer small, focused fixtures that demonstrate a specific behavior. Tests should make it clear what UNDRIFT is expected to recognize and what it should leave unresolved.

---

## Testing Your Changes

Every bug fix and new behavior should have corresponding test coverage.

The repository uses Vitest for automated tests.

### Run the Full Test Suite

```bash
npm test
```

### Run a Specific Test

```bash
npx vitest run tests/analyzer/fetch-extractor.test.ts
```

Replace the path with the test relevant to your change.

### Test Locations

| Test area | Location |
|---|---|
| Parser runtime and syntax handling | `packages/parser-tree-sitter/test/` |
| Frontend/backend extraction | `tests/analyzer/` |
| Core rules and matching | `tests/core/` |
| Extension activation and scheduling | `tests/activation/` |
| Diagnostics and hovers | `tests/diagnostics/` |
| Code actions and fixes | `tests/fixes/` |
| Views and reports | `tests/views/` |
| Workspace and persistence | `tests/workspace/`, `tests/storage/` |
| Cross-component behavior | `tests/integration/` |

### Manually Testing the Extension

To test your changes inside VS Code:

1. Open the UNDRIFT repository in VS Code.
2. Open **Run and Debug**.
3. Select **Launch Extension**.
4. Press `F5`.
5. An Extension Development Host window will open with your local extension.
6. Open a JavaScript/TypeScript workspace and test the behavior you changed.

Use a disposable example or test workspace when validating analysis behavior.

---

## Submitting a Pull Request

Once your changes are ready:

1. Create a descriptive branch in your fork.
2. Make focused changes and include the necessary tests.
3. Run the relevant checks locally.
4. Push your branch to GitHub.
5. Open a pull request against the `main` branch of `parnilV06/undrift`.

### Pull Request Guidelines

A good pull request should make it easy for someone else to understand and review your work.

Include:

- **Problem:** What issue does this change address?
- **Approach:** What did you change, and why?
- **Testing:** Which tests or validation commands did you run?
- **Documentation:** Were relevant documents, examples, or supported-pattern descriptions updated?
- **Screenshots:** Include them when a UI or visual behavior has changed.

Keep pull requests focused and avoid unrelated formatting or refactoring changes.

### Before Opening a Pull Request

- [ ] The change addresses a clear issue or improvement.
- [ ] New behavior has appropriate test coverage.
- [ ] Existing behavior has not regressed.
- [ ] Relevant documentation and support information have been updated.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` succeeds.
- [ ] The pull request description explains the change and its validation.

All pull requests are subject to maintainer review. Changes may be requested to preserve correctness, architectural boundaries, and consistency with the project's design.

---

## Questions or Issues?

For bugs, feature proposals, or questions about contributing, use the [UNDRIFT GitHub Issues](https://github.com/parnilV06/undrift/issues).

Please provide enough context to reproduce a problem or understand a proposed change.

## License

UNDRIFT is distributed under the [GNU General Public License v3.0 only](LICENSE.md) (`GPL-3.0-only`). Please review the project license before contributing.