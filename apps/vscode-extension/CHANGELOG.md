# Changelog

All notable changes to the UNDRIFT VS Code Extension (`ParnilVyawahare.undrift`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - Initial Release

### Added

- **Continuous Workspace Analysis & Live Drift Detection**
  - Automatic workspace analysis triggered on project open (`undrift.analysis.runOnStartup`).
  - Background document change monitoring with intelligent debounce scheduler (`undrift.analysis.debounceMs`).
  - Real-time unsaved editor buffer analysis, detecting contract drift as you type and automatically resolving findings when code is restored.
  - Granular change detection differentiating between consumer/provider changes, limitation triggers, and unrelated files.

- **Tree-sitter WASM Syntax Analysis Engine**
  - In-process WebAssembly Tree-sitter parsers for JavaScript, TypeScript, and TSX.
  - Zero external server or runtime compilation requirements.
  - Fault-tolerant AST parsing with resilient position mapping and syntax node facades.

- **API Contract Extraction**
  - **Frontend Consumers:** Extraction of HTTP methods, target URLs, dynamic path parameters, query parameters, request body schemas, and response expectations for `fetch()` and `axios` calls.
  - **Backend Providers:** Route extraction, HTTP method verbs, dynamic route segments, nested router prefixes, and handler response schemas for Express.js (`app.*`, `express.Router()`) and Next.js (App Router Route Handlers & Pages Router API Routes).

- **Deterministic Contract Drift Evaluation**
  - Missing endpoint / unrouted consumer detection.
  - HTTP method mismatch verification (e.g., consumer `POST` against provider `GET`).
  - Dynamic route parameter incompatibility detection.
  - Request payload and response structure divergence detection.
  - Static evaluation limitation rules for opaque or dynamic runtime values.

- **In-Editor Diagnostics & Quick Fixes**
  - Real-time diagnostic squiggles placed at precise source locations for drifted consumers and providers.
  - Evidence-backed hover cards detailing opposing contract endpoints, parameter schemas, and root causes.
  - Automated Quick Fix code actions (`Ctrl+.` / `Cmd+.`) proposing deterministic alignment for routes and methods.

- **VS Code Workbench & Visual Presentation**
  - Dedicated Activity Bar icon with dynamic badge indicating total active contract findings.
  - Persistent Sidebar Overview panel featuring workspace status indicators, finding tallies, and rapid navigation.
  - Full-page, theme-aware Integration Report (`UNDRIFT: Show Integration Report`) with consumer-provider topology mapping.
  - Commands for on-demand scanning, refreshing, cache clearing, and drift history reset.
