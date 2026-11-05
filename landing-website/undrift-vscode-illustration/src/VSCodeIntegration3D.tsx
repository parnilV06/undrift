import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createSharedMaterials } from "./geometry/palette";
import { createIsometricFloorGrid } from "./geometry/primitives";
import { buildYourCodeStack } from "./geometry/yourCodeStack";
import { buildVSCodeEditor } from "./geometry/vscodeEditor";
import { buildFindingsPanel } from "./geometry/findingsPanel";
import { buildVSCodeConnectors } from "./geometry/connectors";
import {
  stepVSCodeSceneAnimation,
  VSCodeLabelDOMRefs,
  VSCodeSceneTargets,
} from "./animation/useVSCodeSceneAnimation";
import { VSCODE_ICON_DATA_URI } from "./assets/vscodeIconSvg";
import "./styles/vscode-illustration.css";

export interface VSCodeIntegration3DProps {
  className?: string;
  style?: React.CSSProperties;
  animationEnabled?: boolean;
  interactive?: boolean;
  quality?: "low" | "medium" | "high";
  /** Optional custom URL override for UNDRIFT.svg */
  logoSvgUrl?: string;
}

export const VSCodeIntegration3D: React.FC<VSCodeIntegration3DProps> = ({
  className = "",
  style,
  animationEnabled = true,
  interactive = true,
  quality = "high",
  logoSvgUrl,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const yourCodeBadgeRef = useRef<HTMLDivElement | null>(null);
  const topExtensionBadgeRef = useRef<HTMLDivElement | null>(null);
  const findingsDetailBadgeRef = useRef<HTMLDivElement | null>(null);
  const rightCapabilityBadgeRef = useRef<HTMLDivElement | null>(null);

  const [webglSupported, setWebglSupported] = useState(true);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: quality !== "low",
        powerPreference: "high-performance",
      });
    } catch {
      setWebglSupported(false);
      return;
    }

    const maxDpr =
      quality === "low" ? 1 : quality === "medium" ? 1.5 : 2;
    const isMobile = window.innerWidth < 768;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : maxDpr)
    );
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Orthographic isometric camera matching AboutArchitecture3D
    const scene = new THREE.Scene();
    const frustumHeight = 6.5;
    const initialAspect =
      (container.clientWidth || 960) / (container.clientHeight || 600);
    const camera = new THREE.OrthographicCamera(
      (-frustumHeight * initialAspect) / 2,
      (frustumHeight * initialAspect) / 2,
      frustumHeight / 2,
      -frustumHeight / 2,
      -50,
      100
    );

    camera.position.set(11.5, 9.6, 11.5);
    camera.lookAt(0.15, -0.05, 0.1);

    // Consistent monochrome architectural lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
    keyLight.position.set(6, 14, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(-10, 6, -8);
    scene.add(rimLight);

    // Build Procedural 3D Composition
    const materials = createSharedMaterials();
    const sceneRoot = new THREE.Group();
    scene.add(sceneRoot);

    const floorGrid = createIsometricFloorGrid(20, 20);
    sceneRoot.add(floorGrid);

    const yourCode = buildYourCodeStack(materials);
    sceneRoot.add(yourCode.root);

    const editor = buildVSCodeEditor(materials);
    sceneRoot.add(editor.root);

    const findings = buildFindingsPanel(materials, logoSvgUrl);
    sceneRoot.add(findings.root);

    const connectors = buildVSCodeConnectors(materials);
    sceneRoot.add(connectors.root);

    const targets: VSCodeSceneTargets = {
      sceneRoot,
      yourCode,
      editor,
      findings,
      connectors,
    };

    const labelRefs: VSCodeLabelDOMRefs = {
      yourCodeBadge: yourCodeBadgeRef.current,
      topExtensionBadge: topExtensionBadgeRef.current,
      findingsDetailBadge: findingsDetailBadgeRef.current,
      rightCapabilityBadge: rightCapabilityBadgeRef.current,
    };

    // Responsive sizing & camera framing via ResizeObserver
    let width = container.clientWidth || 960;
    let height = container.clientHeight || 600;

    const updateSize = () => {
      if (!container) return;
      width = Math.max(container.clientWidth, 1);
      height = Math.max(container.clientHeight, 1);
      const aspect = width / height;

      const isMobileSmall = width <= 480;
      const isMobileMed = width <= 768;

      const yourCodeW = isMobileSmall ? 130 : isMobileMed ? 145 : 184;
      const yourCodeOffset = isMobileSmall ? -68 : isMobileMed ? -76 : -102;
      const yourCodeMargin = -yourCodeOffset;

      const capW = isMobileSmall ? 130 : isMobileMed ? 155 : 200;
      const capOffset = isMobileSmall ? 2 : 4;
      const capTotalRight = capOffset + capW;

      const safety = isMobileSmall ? 14 : isMobileMed ? 20 : 26;
      const pixelOverhead = yourCodeMargin + capTotalRight + safety * 2;
      const availableFraction = Math.max(0.2, (width - pixelOverhead) / width);

      const requiredFrustumW = Math.max(14.0, 7.85 / availableFraction);
      const effectiveFrustumH = Math.max(
        frustumHeight,
        requiredFrustumW / aspect
      );
      const actualFrustumW = effectiveFrustumH * aspect;

      const leftAnchorUnit = -3.68;
      const leftPedestalUnit = -4.89;
      const leftEdgeUnit = Math.min(
        leftAnchorUnit - ((yourCodeMargin + safety) * actualFrustumW) / width,
        leftPedestalUnit - (safety * actualFrustumW) / width
      );
      const rightEdgeUnit =
        2.6 + ((capTotalRight + safety) * actualFrustumW) / width;
      const midScreenUnit = (leftEdgeUnit + rightEdgeUnit) / 2;

      const offsetMag = midScreenUnit / Math.SQRT2;
      const lookAtX = offsetMag;
      const lookAtZ = -offsetMag;

      camera.position.set(lookAtX + 11.5, 9.6, lookAtZ + 11.5);
      camera.lookAt(lookAtX, -0.05, lookAtZ);
      camera.updateMatrixWorld();

      camera.left = -actualFrustumW / 2;
      camera.right = actualFrustumW / 2;
      camera.top = effectiveFrustumH / 2;
      camera.bottom = -effectiveFrustumH / 2;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height, false);
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    // Pause animation when outside viewport
    let isVisible = true;
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(container);

    // Subtle pointer parallax
    const pointer = { x: 0, y: 0 };
    const currentParallax = { x: 0, y: 0 };

    const handlePointerMove = (e: PointerEvent) => {
      if (!interactive || isTouchDevice) return;
      const rect = container.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    };

    const handlePointerLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };

    container.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    container.addEventListener("pointerleave", handlePointerLeave, {
      passive: true,
    });

    const clock = new THREE.Clock();
    let frameId = 0;

    const renderLoop = () => {
      frameId = requestAnimationFrame(renderLoop);
      if (!isVisible) return;

      const shouldAnimate =
        animationEnabled && !reducedMotionQuery.matches;
      const elapsed = clock.getElapsedTime();

      stepVSCodeSceneAnimation(
        elapsed,
        targets,
        pointer,
        currentParallax,
        shouldAnimate,
        interactive && !isTouchDevice,
        camera,
        labelRefs,
        width,
        height
      );

      renderer.render(scene, camera);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);

      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.LineLoop ||
          obj instanceof THREE.LineSegments
        ) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else if (obj.material) {
            obj.material.dispose();
          }
        }
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [animationEnabled, interactive, quality, logoSvgUrl]);

  if (!webglSupported) {
    return (
      <div
        className={`undrift-vscode-3d ${className}`.trim()}
        style={style}
        role="img"
        aria-label="UNDRIFT Visual Studio Code Integration 3D Illustration"
      />
    );
  }

  return (
    <div
      className={`undrift-vscode-3d ${className}`.trim()}
      style={style}
      role="img"
      aria-label="UNDRIFT Visual Studio Code Extension showing API contract findings linked to source-code evidence"
    >
      <div ref={mountRef} className="undrift-vscode-3d__canvas-mount" />

      {/* Editable, Accessible HTML Overlay Badges Synced to 3D Anchors */}
      <div className="undrift-vscode-3d__overlay">
        {/* A. Left Callout: YOUR CODE */}
        <div
          ref={yourCodeBadgeRef}
          className="undrift-vscode-3d__card undrift-vscode-3d__card--your-code"
        >
          <span className="undrift-vscode-3d__title">YOUR CODE</span>
          <span className="undrift-vscode-3d__subtitle">
            API routes, handlers, schemas
          </span>
        </div>

        {/* B. Top Brand Callout: VS Code Extension */}
        <div
          ref={topExtensionBadgeRef}
          className="undrift-vscode-3d__card undrift-vscode-3d__card--extension"
        >
          <img
            src={VSCODE_ICON_DATA_URI}
            alt=""
            className="undrift-vscode-3d__vscode-icon"
          />
          <div>
            <span className="undrift-vscode-3d__title">VS Code Extension</span>
            <span className="undrift-vscode-3d__subtitle">
              Analyze APIs in your workflow
            </span>
          </div>
        </div>

        {/* C. Foreground UNDRIFT Findings Details */}
        <div
          ref={findingsDetailBadgeRef}
          className="undrift-vscode-3d__card undrift-vscode-3d__card--findings"
        >
          <div className="undrift-vscode-3d__findings-header">
            <span>UNDRIFT FINDINGS</span>
            <span>2 DISCREPANCIES</span>
          </div>
          <div className="undrift-vscode-3d__findings-row undrift-vscode-3d__findings-row--active">
            <span>01 · Method mismatch · /api/users</span>
            <span className="undrift-vscode-3d__finding-code">
              GET ≠ POST
            </span>
          </div>
          <div className="undrift-vscode-3d__findings-row undrift-vscode-3d__findings-row--secondary">
            <span>02 · Response shape · /api/profile</span>
            <span className="undrift-vscode-3d__finding-code">
              missing: role
            </span>
          </div>
        </div>

        {/* D. Right Capability Callout */}
        <div
          ref={rightCapabilityBadgeRef}
          className="undrift-vscode-3d__card undrift-vscode-3d__card--capabilities"
        >
          <div className="undrift-vscode-3d__cap-row">
            <svg
              viewBox="0 0 24 24"
              className="undrift-vscode-3d__cap-icon"
              aria-hidden="true"
            >
              <path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z" />
            </svg>
            <span>Contract drift detection</span>
          </div>

          <div className="undrift-vscode-3d__cap-row">
            <svg
              viewBox="0 0 24 24"
              className="undrift-vscode-3d__cap-icon"
              aria-hidden="true"
            >
              <path d="M12 3L2 21H22L12 3Z" />
              <line x1="12" y1="10" x2="12" y2="15" />
              <circle cx="12" cy="18" r="0.8" fill="#e5e5e5" />
            </svg>
            <span>Clear explanations</span>
          </div>

          <div className="undrift-vscode-3d__cap-row">
            <svg
              viewBox="0 0 24 24"
              className="undrift-vscode-3d__cap-icon"
              aria-hidden="true"
            >
              <path d="M13 2L4 14H12L11 22L20 10H12L13 2Z" />
            </svg>
            <span>Source-code evidence</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VSCodeIntegration3D;
