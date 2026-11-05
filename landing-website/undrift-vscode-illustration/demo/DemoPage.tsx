import React, { useState } from "react";
import { VSCodeIntegration3D } from "../src";

export const DemoPage: React.FC = () => {
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const [interactive, setInteractive] = useState(true);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#050505",
        color: "#F0F0F0",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "40px 24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            paddingBottom: 24,
            marginBottom: 32,
            borderBottom: "1px solid #222",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "0.08em" }}>
              UNDRIFT — VS Code Integration 3D Component Preview
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#888" }}>
              Interactive procedural Three.js component recreating the VS Code Extension workflow
            </p>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={animationEnabled}
                onChange={(e) => setAnimationEnabled(e.target.checked)}
              />
              Animation
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={interactive}
                onChange={(e) => setInteractive(e.target.checked)}
              />
              Pointer Parallax
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as "low" | "medium" | "high")}
              style={{
                background: "#111",
                color: "#eee",
                border: "1px solid #444",
                borderRadius: 6,
                padding: "4px 8px",
              }}
            >
              <option value="low">Quality: Low</option>
              <option value="medium">Quality: Medium</option>
              <option value="high">Quality: High</option>
            </select>
          </div>
        </header>

        <section
          style={{
            background: "#070707",
            border: "1px solid #1c1c1c",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <VSCodeIntegration3D
            animationEnabled={animationEnabled}
            interactive={interactive}
            quality={quality}
          />
        </section>
      </div>
    </div>
  );
};

export default DemoPage;
