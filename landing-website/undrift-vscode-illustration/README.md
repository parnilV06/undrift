# UNDRIFT — `VSCodeIntegration3D` Component

An interactive, procedurally constructed 3D React + Three.js illustration for the **Visual Studio Code Integration** section of the UNDRIFT website.

## Visual Composition
- **Left — Your Code**: A stack of three slightly offset source-code panels (`</>`) on an isometric rounded pedestal with curved 3D conduits feeding into the main editor and the callout `YOUR CODE / API routes, handlers, schemas`.
- **Centre — Visual Studio Code Editor**: Prominent isometric 3D editor structure featuring a title bar, command bar, vertical activity rail, minimal file explorer, syntax/code lines with a highlighted source-code evidence location, and a 3D extruded Visual Studio Code ribbon mark.
- **Top Brand Callout**: Compact floating header callout (`VS Code Extension / Analyze APIs in your workflow`) with a monochrome Visual Studio Code icon.
- **Foreground — UNDRIFT Findings Panel**: Integrated floating findings panel positioned in front of the editor with the official **UNDRIFT** logo mark, status icons (`!`, `i`, `✓`), illustrative findings (`Method mismatch` on `/api/users` and `Response shape mismatch` on `/api/profile`), and a 3D **Source Evidence Connector** linking Finding 01 directly to the highlighted source line inside the editor.
- **Right — Capability Callout**: Compact three-row capability callout (`Contract drift detection`, `Clear explanations`, `Source-code evidence`) linked via a stepped dashed connector.

## Quick Start (Standalone Preview)
```bash
npm install
npm run dev
```

## Component Usage
```tsx
import { VSCodeIntegration3D } from "./src";

<VSCodeIntegration3D
  animationEnabled={true}
  interactive={true}
  quality="high"
/>
```
