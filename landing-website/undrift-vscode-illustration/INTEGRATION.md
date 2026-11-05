# Integrating `VSCodeIntegration3D` into the UNDRIFT Website

## 1. Dependencies
Ensure `three` and `@types/three` are installed in your React + TypeScript + Vite project:
```bash
npm install three
npm install -D @types/three
```

## 2. Copy Component Files
Copy the `src/` folder from `undrift-vscode-illustration` into your website repository as `src/components/undrift-vscode-illustration/`:

```text
src/components/undrift-vscode-illustration/
├── VSCodeIntegration3D.tsx
├── assets/
│   ├── undriftLogoDataUri.ts
│   └── vscodeIconSvg.ts
├── geometry/
│   ├── palette.ts
│   ├── primitives.ts
│   ├── yourCodeStack.ts
│   ├── vscodeEditor.ts
│   ├── findingsPanel.ts
│   └── connectors.ts
├── animation/
│   └── useVSCodeSceneAnimation.ts
├── styles/
│   └── vscode-illustration.css
└── index.ts
```

## 3. Import and Render
```tsx
import { VSCodeIntegration3D } from "./components/undrift-vscode-illustration";

export default function VSCodeSection() {
  return (
    <section className="vscode-section">
      <div className="vscode-copy">
        {/* Existing section content */}
      </div>

      <div className="vscode-visual">
        <VSCodeIntegration3D
          animationEnabled={true}
          interactive={true}
          quality="high"
        />
      </div>
    </section>
  );
}
```
