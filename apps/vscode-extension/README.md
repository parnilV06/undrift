# UNDRIFT

Live frontend-backend API contract drift detection inside Visual Studio Code.

UNDRIFT analyzes your frontend API calls and backend route handlers in real time, detecting mismatched endpoints, incompatible HTTP methods, missing route parameters, and payload divergence directly as you write code — before bugs reach production or CI.

---

## Why UNDRIFT?

In modern full-stack web development, frontend client requests (`fetch`, `axios`) and backend server routes (Express, Next.js) constantly evolve. When an API route changes or a payload schema shifts, frontend calls frequently break silently due to contract drift.

UNDRIFT bridges this divide right inside your editor:

- **Zero build or server execution required:** Operates entirely via static analysis powered by WebAssembly-based Tree-sitter parsers.
- **Continuous and live:** Automatically analyzes your workspace on startup, tracks file changes, and monitors unsaved editor buffers in real time.
- **Evidence-backed:** Pinpoints the exact source lines of both the consumer and the provider with actionable explanations and automated Quick Fixes.

---

## Features

### 1. Continuous Workspace Analysis & Live Monitoring

- Automatically scans your workspace when opened.
- Monitors document edits with an intelligent debounce scheduler (`undrift.analysis.debounceMs`).
- Inspects unsaved editor buffers as you type, detecting newly introduced drift and automatically clearing resolved findings the moment compatibility is restored.

### 2. Deep API Contract Observation

- **Frontend Observation:** Extracts HTTP method, target route template, query parameters, URL parameters, request body schemas, and response expectations from client calls.
- **Backend Observation:** Extracts HTTP route declarations, nested router prefixes, route parameters, request body validation schemas, and handler responses.

### 3. Deterministic Drift Detection

Evaluates contract pairs against deterministic rules:

- **Missing Provider:** A frontend consumer targets an endpoint or route pattern that does not exist in the backend.
- **Method Mismatch:** A consumer sends a request (e.g., `POST`) to a route registered for a different HTTP method (e.g., `GET`).
- **Route Parameter Incompatibility:** Missing or mismatched dynamic route segments (e.g., `/api/users/:id`).
- **Payload & Response Shape Drift:** Divergence between sent request bodies or expected response properties and provider definitions.

### 4. In-Editor Diagnostics, Hovers & Quick Fixes

- **Editor Squiggles:** Highlights drifted calls directly at the offending source location.
- **Detailed Hovers:** Explains why the contract drifted, referencing the corresponding provider or consumer definition.
- **Quick Fixes:** Provides one-click automated code actions to align route paths, adjust HTTP methods, or update parameters.

### 5. Dedicated Workbench Integration

- **Activity Bar Icon:** Dedicated UNDRIFT icon in the VS Code Activity Bar with a live badge showing active drift count.
- **Sidebar Overview:** Persistent sidebar panel showing workspace health status, findings summary, and fast navigation.
- **Full Integration Report:** Rich, theme-aware editor panel (`UNDRIFT: Show Integration Report`) visualizing full consumer-provider topology, drift status, and historical reconciliation.

---

## Supported Technologies

| Layer                  | Framework / Library                                    | Supported Capabilities                                                                   |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Frontend Consumers** | **Fetch API** (`fetch()`)                              | Route URLs, method options, request headers, JSON body payloads                          |
|                        | **Axios** (`axios.get`, `axios.post`, `axios()`, etc.) | Direct method calls, URL parameters, request configurations                              |
|                        | **Next.js Client Data Fetching**                       | Client components, route calls                                                           |
| **Backend Providers**  | **Express.js** (`app.*`, `express.Router()`)           | Route handlers, method verbs, router mounting prefixes, dynamic parameters               |
|                        | **Next.js Route Handlers** (App Router)                | HTTP method exports (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) in `route.ts` / `route.js` |
|                        | **Next.js API Routes** (Pages Router)                  | Default export handlers in `pages/api/**`                                                |
| **Languages**          | **TypeScript & JavaScript**                            | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`                                             |

### Scope & Extraction Boundaries

- Supported patterns rely on static syntactic and local reference dataflow analysis.
- Calls constructed using dynamic runtime string evaluation (e.g., `fetch(window.myCustomUrlBuilder())`) or heavily abstracted custom HTTP wrapper libraries without recognizable signatures are flagged as limitations or unobserved.

---

## Getting Started

### Installation

Once published to the Visual Studio Code Marketplace:

1. Open Visual Studio Code.
2. Press `Ctrl+P` (or `Cmd+P` on macOS) and type:
   ```
   ext install ParnilVyawahare.undrift
   ```
3. Alternatively, search for **UNDRIFT** in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

To install a release package manually:

```bash
code --install-extension ParnilVyawahare.undrift-1.0.0.vsix
```

### Usage

1. Open any workspace containing JavaScript or TypeScript frontend and backend code.
2. UNDRIFT will automatically trigger an initial workspace scan upon startup.
3. Click the **UNDRIFT** icon in the Activity Bar to open the Sidebar Overview and inspect active findings.
4. As you write or edit API endpoints, diagnostics will update live in the editor.
5. Use `Ctrl+.` (or `Cmd+.` on macOS) on any highlighted drift diagnostic to preview and apply available Quick Fixes.

---

## Available Commands

Access these commands from the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command Title                                      | Identifier               | Description                                                       |
| -------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| **UNDRIFT: Scan Workspace**                        | `undrift.scanWorkspace`  | Triggers a full workspace re-scan across all supported files.     |
| **UNDRIFT: Show Integration Report**               | `undrift.showReport`     | Opens the full-page theme-aware Integration Report.               |
| **UNDRIFT: Refresh Analysis**                      | `undrift.refresh`        | Re-evaluates observed contracts and refreshes diagnostics.        |
| **UNDRIFT: Explain Finding**                       | `undrift.explainFinding` | Shows detailed diagnostic explanation for a selected finding.     |
| **UNDRIFT: Reset Drift History**                   | `undrift.resetHistory`   | Resets historical drift reconciliation records for the workspace. |
| **UNDRIFT: Clear In-Memory Workspace State Cache** | `undrift.clearCache`     | Flushes cached parse trees and in-memory analysis snapshots.      |

---

## Configuration

UNDRIFT provides the following configurable settings under `undrift.analysis.*`:

```json
{
  // Automatically run background drift analysis when files are edited, created, or deleted.
  "undrift.analysis.autoRun": true,

  // Debounce delay in milliseconds before triggering background analysis following document changes.
  // Minimum: 100 ms, Maximum: 5000 ms.
  "undrift.analysis.debounceMs": 800,

  // Automatically run an initial drift analysis when a workspace is opened.
  "undrift.analysis.runOnStartup": true
}
```

---

## Limitations

- **Dynamic URLs:** Fully dynamic runtime route strings that cannot be resolved statically are reported as unobserved or flagged via limitation rules.
- **Backend Frameworks:** Phase 1 focuses on Express.js and Next.js (App Router & Pages Router). Other backend ecosystems (e.g., Fastify, NestJS, Python Flask/FastAPI, Go Gin) are scheduled for future releases.
- **Database / ORM Drift:** UNDRIFT is dedicated to HTTP API contract compatibility between frontend consumers and backend providers; database schema migration drift is outside the scope of this extension.

---

## Documentation & Community Links

- **Landing Page & Overview:** [https://undrift-landing-website.vercel.app/](https://undrift-landing-website.vercel.app/)
- **Documentation:** [https://undrift-landing-website.vercel.app/docs](https://undrift-landing-website.vercel.app/docs)
- **Source Repository:** [https://github.com/parnilV06/undrift](https://github.com/parnilV06/undrift)
- **Issue Tracker:** [https://github.com/parnilV06/undrift/issues](https://github.com/parnilV06/undrift/issues)
- **License:** GNU General Public License v3.0 ([GPL-3.0-only](LICENSE.md))
