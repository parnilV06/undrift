# UNDRIFT — Development Guide

## Environment Prerequisites

- **Node.js**: v18.0.0 or later (v22 LTS recommended)
- **npm**: v9.0.0 or later
- **VS Code**: v1.100.0 or later (for extension development and debugging)

## Workspace Architecture

The repository is structured as an npm workspaces monorepo:

| Package | Path | Purpose |
|---------|------|---------|
| `@undrift/core` | `packages/core` | Domain models, candidate matching, rule catalog, and pipeline engine |
| `@undrift/parser-tree-sitter` | `packages/parser-tree-sitter` | Web-Tree-sitter WASM parser adapter and grammar registry |
| `@undrift/analyzer-js-ts` | `packages/analyzer-js-ts` | Language extractors for Express, Fetch, Axios, and shape extraction |
| `undrift-vscode` | `apps/vscode-extension` | VS Code extension host, diagnostics, views, and webview reports |

## Common Commands

### Dependency Management

```bash
# Install all dependencies across the monorepo
npm install
```

### Type Checking

```bash
# Typecheck all packages and extension
npm run typecheck

# Typecheck a specific package
npm run typecheck --workspace=@undrift/core
npm run typecheck --workspace=@undrift/parser-tree-sitter
npm run typecheck --workspace=@undrift/analyzer-js-ts
npm run typecheck --workspace=undrift-vscode
```

### Building

```bash
# Build all packages and bundle the VS Code extension
npm run build

# Build only the VS Code extension (bundles extension.js and copies WASM assets)
npm run build --workspace=undrift-vscode
```

### Testing

```bash
# Run unit and integration tests via Vitest
npm test
```

### Debugging the VS Code Extension

1. Open this repository in VS Code.
2. Select **Run and Debug** (`Ctrl+Shift+D` or `Cmd+Shift+D`).
3. Select **Launch Extension**.
4. Press `F5`. An Extension Development Host window will launch with the bundled extension loaded.

## Continuous Workspace Analysis & Live Testing

UNDRIFT continuously analyses the workspace in the background:
- **Startup Scan:** Automatically scans the workspace upon opening (`undrift.analysis.runOnStartup: true`).
- **Live Debounced Monitoring:** Listens to document edits, file creation, renaming, and deletion, coalescing bursts of edits into a single scan after an 800ms debounce quiet period (`undrift.analysis.debounceMs: 800`).
- **In-Memory Editor Buffers:** Analyzes dirty in-memory editor buffers directly, surfacing drift diagnostics and badge count updates before the developer saves the file.
- **Dynamic Configuration:** Toggling `undrift.analysis.autoRun` or adjusting `debounceMs` in Settings takes effect immediately without reloading the IDE window.
- **Manual Scanning:** Explicit scan commands (`undrift.scanWorkspace` and `undrift.refresh`) remain available even when `autoRun` is disabled.
