# UNDRIFT — `AboutArchitecture3D` Component

An interactive, procedurally constructed 3D React + Three.js architectural illustration for the **About UNDRIFT** section.

## Visual Composition
- **Left — Frontend API Usage**: Four layered isometric browser/editor windows on a two-tier pedestal with `</>` code framing, HTTP method badges, endpoint rows, and an isometric floating `</> Frontend API Usage` callout.
- **Centre — UNDRIFT API Contract Analysis**: Raised isometric focal platform featuring the exact official **UNDRIFT** logo mark (`UNDRIFT.svg`) embossed onto its top surface, subtle surface highlight sweep, and floating `UNDRIFT / API Contract Analysis` callout.
- **Right — Three Analysis Modules**:
  1. **Routes / Endpoints** (`/api/users, /api/orders`) with 3D route-branch node icon.
  2. **HTTP Methods** (`GET, POST, PUT, DELETE`) with 3D geometric bolt icon.
  3. **Request / Response Shapes** (`JSON, schemas, types`) with 3D nested diamond layers.
- **Connecting Conduits**: Parallel left-to-center lines and rounded 3D branching conduits with junction spheres and animated data-pulse nodes.

## Quick Start (Standalone Preview)
```bash
npm install
npm run dev
```

## Component Usage
```tsx
import { AboutArchitecture3D } from "./src";

<AboutArchitecture3D
  animationEnabled={true}
  interactive={true}
  quality="high"
/>
```
