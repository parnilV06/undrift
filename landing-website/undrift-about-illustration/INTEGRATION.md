# Integrating `AboutArchitecture3D` into the UNDRIFT Website

## 1. Install `three`
In your existing React + TypeScript + Vite project:
```bash
npm install three
npm install -D @types/three
```

## 2. Copy Component Files
Copy the `src/` directory from this package into your website repository, for example:
```text
src/components/undrift-about-illustration/
├── AboutArchitecture3D.tsx
├── assets/
│   └── undriftLogoDataUri.ts
├── geometry/
│   ├── palette.ts
│   ├── primitives.ts
│   ├── frontendStack.ts
│   ├── centralPlatform.ts
│   ├── analysisModules.ts
│   └── connectors.ts
├── animation/
│   └── useSceneAnimation.ts
├── styles/
│   └── illustrations.css
└── index.ts
```

*(Note: The official `UNDRIFT.svg` asset is already pre-encoded inside `src/assets/undriftLogoDataUri.ts` so it renders out-of-the-box without requiring external static asset routing, and is also included in `public/UNDRIFT.svg`.)*

## 3. Import and Render
```tsx
import { AboutArchitecture3D } from "./components/undrift-about-illustration";

export default function AboutSection() {
  return (
    <section className="about-section">
      <div className="about-copy">
        {/* Existing UNDRIFT about content */}
      </div>

      <div className="about-visual">
        <AboutArchitecture3D />
      </div>
    </section>
  );
}
```
