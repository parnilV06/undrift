import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createSharedMaterials } from "./geometry/palette";
import { createIsometricFloorGrid } from "./geometry/primitives";
import { buildFrontendStack } from "./geometry/frontendStack";
import { buildCentralPlatform } from "./geometry/centralPlatform";
import { buildAnalysisModules } from "./geometry/analysisModules";
import { buildConnectorSystem } from "./geometry/connectors";
import {
  LabelDOMRefs,
  SceneTargets,
  stepSceneAnimation,
} from "./animation/useSceneAnimation";
import "./styles/illustrations.css";

export interface AboutArchitecture3DProps {
  className?: string;
  style?: React.CSSProperties;
  animationEnabled?: boolean;
  interactive?: boolean;
  quality?: "low" | "medium" | "high";
  /** Optional custom URL override for UNDRIFT.svg (by default uses the embedded official UNDRIFT.svg data URI) */
  logoSvgUrl?: string;
}

export const AboutArchitecture3D: React.FC<AboutArchitecture3DProps> = ({
  className = "",
  style,
  animationEnabled = true,
  interactive = true,
  quality = "high",
  logoSvgUrl,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const frontendBadgeRef = useRef<HTMLDivElement | null>(null);
  const centralBadgeRef = useRef<HTMLDivElement | null>(null);
  const routesBadgeRef = useRef<HTMLDivElement | null>(null);
  const methodsBadgeRef = useRef<HTMLDivElement | null>(null);
  const shapesBadgeRef = useRef<HTMLDivElement | null>(null);

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

    const scene = new THREE.Scene();
    const frustumHeight = 6.4;
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
    camera.lookAt(0.35, -0.05, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
    keyLight.position.set(6, 14, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(-10, 6, -8);
    scene.add(rimLight);

    const materials = createSharedMaterials();
    const sceneRoot = new THREE.Group();
    scene.add(sceneRoot);

    const floorGrid = createIsometricFloorGrid(20, 20);
    sceneRoot.add(floorGrid);

    const frontend = buildFrontendStack(materials);
    sceneRoot.add(frontend.root);

    const central = buildCentralPlatform(materials, logoSvgUrl);
    sceneRoot.add(central.root);

    const modules = buildAnalysisModules(materials);
    modules.forEach((m) => sceneRoot.add(m.group));

    const connectors = buildConnectorSystem(materials);
    sceneRoot.add(connectors.root);

    const targets: SceneTargets = {
      sceneRoot,
      frontend,
      central,
      modules,
      connectors,
    };

    const labelRefs: LabelDOMRefs = {
      frontendBadge: frontendBadgeRef.current,
      centralBadge: centralBadgeRef.current,
      moduleBadges: {
        routes: routesBadgeRef.current,
        methods: methodsBadgeRef.current,
        shapes: shapesBadgeRef.current,
      },
    };

    let width = container.clientWidth || 960;
    let height = container.clientHeight || 600;

    const updateSize = () => {
      if (!container) return;
      width = Math.max(container.clientWidth, 1);
      height = Math.max(container.clientHeight, 1);
      const aspect = width / height;

      const isMobileSmall = width <= 480;
      const isMobileMed = width <= 768;

      const feMargin = isMobileSmall ? 76 : isMobileMed ? 92 : 108;
      const badgeW = isMobileSmall ? 130 : isMobileMed ? 155 : 202;

      const safety = isMobileSmall ? 18 : isMobileMed ? 24 : 32;
      const pixelOverhead = feMargin + badgeW + safety * 2;
      const availableFraction = Math.max(
        0.2,
        (width - pixelOverhead) / width
      );
      const requiredFrustumW = Math.max(14.5, 8.25 / availableFraction);

      const effectiveFrustumH = Math.max(
        frustumHeight,
        requiredFrustumW / aspect
      );
      const actualFrustumW = effectiveFrustumH * aspect;

      const leftEdgeUnit =
        -3.04 - ((feMargin + safety) * actualFrustumW) / width;
      const rightEdgeUnit =
        5.12 + ((badgeW + safety) * actualFrustumW) / width;
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

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(container);

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

      stepSceneAnimation(
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
        className={`undrift-about-3d ${className}`.trim()}
        style={style}
        role="img"
        aria-label="UNDRIFT API Contract Analysis Architecture"
      />
    );
  }

  return (
    <div
      className={`undrift-about-3d ${className}`.trim()}
      style={style}
      role="img"
      aria-label="UNDRIFT API Contract Analysis Architecture connecting Frontend API Usage to Routes/Endpoints, HTTP Methods, and Request/Response Shapes"
    >
      <div ref={mountRef} className="undrift-about-3d__canvas-mount" />

      <div className="undrift-about-3d__overlay">
        <div
          ref={frontendBadgeRef}
          className="undrift-about-3d__badge--frontend"
        >
          <div className="undrift-about-3d__badge undrift-about-3d__badge--frontend-inner">
            <span className="undrift-about-3d__code-symbol">&lt;/&gt;</span>
            <span>Frontend API Usage</span>
          </div>
        </div>

        <div
          ref={centralBadgeRef}
          className="undrift-about-3d__badge undrift-about-3d__badge--central"
        >
          <span className="undrift-about-3d__central-title">UNDRIFT</span>
          <span className="undrift-about-3d__central-subtitle">
            API Contract Analysis
          </span>
        </div>

        <div
          ref={routesBadgeRef}
          className="undrift-about-3d__badge undrift-about-3d__badge--module"
        >
          <span className="undrift-about-3d__module-title">
            Routes / Endpoints
          </span>
          <span className="undrift-about-3d__module-sub">
            /api/users, /api/orders
          </span>
        </div>

        <div
          ref={methodsBadgeRef}
          className="undrift-about-3d__badge undrift-about-3d__badge--module"
        >
          <span className="undrift-about-3d__module-title">HTTP Methods</span>
          <span className="undrift-about-3d__module-sub">
            GET, POST, PUT, DELETE
          </span>
        </div>

        <div
          ref={shapesBadgeRef}
          className="undrift-about-3d__badge undrift-about-3d__badge--module"
        >
          <span className="undrift-about-3d__module-title">
            Request / Response Shapes
          </span>
          <span className="undrift-about-3d__module-sub">
            JSON, schemas, types
          </span>
        </div>
      </div>
    </div>
  );
};

export default AboutArchitecture3D;
