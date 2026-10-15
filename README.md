# UNDRIFT

Live frontend-backend API contract intelligence inside the developer workspace.

UNDRIFT analyzes local TypeScript and JavaScript consumer/provider code using Tree-sitter AST parsing, extracts API contract observations, matches endpoints structurally, and detects integration drift with deterministic rules and mechanical quick fixes.

## Repository Structure

- `apps/vscode-extension` — VS Code extension providing in-editor diagnostics, findings sidebar, integration report panel, and quick fixes.
- `packages/core` — Language-neutral contract discovery, candidate matching, drift rules (DRIFT-001 through DRIFT-008), explanations, and report assembly.
- `packages/parser-tree-sitter` — Web-Tree-sitter WASM parser adapter, grammar registry, and syntax node facade.
- `packages/analyzer-js-ts` — JavaScript and TypeScript AST extractors (Express route handlers, Fetch/Axios client calls) and type/shape extraction.
- `examples` — Example projects demonstrating integration scenarios.
- `tests` — Test fixtures, scenarios, and extension host integration tests.
- `docs` — Architecture, requirement specifications, and development guides:
  - `PRD.md` — Product Requirements Document
  - `TRD.md` — Technical Requirements Document
  - `ERD.md` — Entity Relationship Diagram & Logical Model
  - `HLD.md` — High-Level Design
  - `LLD.md` — Low-Level Design
  - `DEVELOPMENT.md` — Development and setup workflow

## Getting Started

### Prerequisites

- Node.js >= 18.0.0 (Node 22 recommended)
- npm >= 9.0.0

### Setup

```bash
# Install workspace dependencies
npm install

# Run type-checking across all workspaces
npm run typecheck

# Build all packages and the VS Code extension bundle
npm run build

# Run tests
npm test
```

### Launching the Extension

Open the repository in VS Code and press `F5` (or choose **Launch Extension** from the Run & Debug panel) to launch an Extension Development Host instance.
