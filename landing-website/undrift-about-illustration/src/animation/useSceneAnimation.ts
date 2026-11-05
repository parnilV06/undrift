import * as THREE from "three";
import { FrontendStackHandles } from "../geometry/frontendStack";
import { CentralPlatformHandles } from "../geometry/centralPlatform";
import { ModuleItemHandle } from "../geometry/analysisModules";
import { ConnectorSystemHandles } from "../geometry/connectors";

export interface SceneTargets {
  sceneRoot: THREE.Group;
  frontend: FrontendStackHandles;
  central: CentralPlatformHandles;
  modules: ModuleItemHandle[];
  connectors: ConnectorSystemHandles;
}

export interface LabelDOMRefs {
  frontendBadge: HTMLDivElement | null;
  centralBadge: HTMLDivElement | null;
  moduleBadges: Record<"routes" | "methods" | "shapes", HTMLDivElement | null>;
}

function updateOverlayPosition(
  anchor: THREE.Object3D,
  camera: THREE.Camera,
  el: HTMLDivElement | null,
  width: number,
  height: number
): void {
  if (!el) return;
  const worldPos = new THREE.Vector3();
  anchor.getWorldPosition(worldPos);
  worldPos.project(camera);

  const x = (worldPos.x * 0.5 + 0.5) * width;
  const y = (-(worldPos.y * 0.5) + 0.5) * height;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

export function stepSceneAnimation(
  elapsedTime: number,
  targets: SceneTargets,
  pointer: { x: number; y: number },
  currentParallax: { x: number; y: number },
  animate: boolean,
  interactive: boolean,
  camera: THREE.Camera,
  labelRefs: LabelDOMRefs,
  width: number,
  height: number
): void {
  const targetRotY = interactive ? pointer.x * 0.045 : 0;
  const targetRotX = interactive ? -pointer.y * 0.03 : 0;
  currentParallax.x += (targetRotX - currentParallax.x) * 0.06;
  currentParallax.y += (targetRotY - currentParallax.y) * 0.06;

  targets.sceneRoot.rotation.x = currentParallax.x;
  targets.sceneRoot.rotation.y = currentParallax.y;

  if (animate) {
    const stackFloat = Math.sin(elapsedTime * 1.15) * 0.045;
    targets.frontend.root.position.y = stackFloat;
    targets.frontend.panels.forEach((panel, idx) => {
      panel.position.y =
        0.38 + idx * 0.08 + Math.sin(elapsedTime * 1.4 + idx * 0.45) * 0.012;
    });

    targets.central.floatingCore.position.y =
      Math.sin(elapsedTime * 1.35 + 1.0) * 0.038;

    const sweepCycle = (elapsedTime * 0.35) % 4.0;
    const sweepMat = targets.central.highlightSweep
      .material as THREE.MeshBasicMaterial;
    if (sweepCycle < 1.0) {
      const p = sweepCycle;
      targets.central.highlightSweep.position.z = -0.75 + p * 1.5;
      sweepMat.opacity = Math.sin(p * Math.PI) * 0.09;
    } else {
      sweepMat.opacity = 0;
    }

    targets.modules.forEach((mod, idx) => {
      mod.floatingTop.position.y =
        Math.sin(elapsedTime * 1.25 + idx * 1.2) * 0.032;
    });

    targets.connectors.pulses.forEach((pulse) => {
      const u = (elapsedTime * pulse.speed + pulse.offset) % 1.0;
      const pos = pulse.curve.getPointAt(u);
      pulse.pulseMesh.position.copy(pos);
    });
  } else {
    targets.frontend.root.position.y = 0;
    targets.central.floatingCore.position.y = 0;
    targets.modules.forEach((mod) => {
      mod.floatingTop.position.y = 0;
    });
    targets.connectors.pulses.forEach((pulse, idx) => {
      const pos = pulse.curve.getPointAt((0.35 + idx * 0.18) % 1.0);
      pulse.pulseMesh.position.copy(pos);
    });
  }

  targets.sceneRoot.updateMatrixWorld();
  updateOverlayPosition(
    targets.frontend.calloutAnchor,
    camera,
    labelRefs.frontendBadge,
    width,
    height
  );
  updateOverlayPosition(
    targets.central.calloutAnchor,
    camera,
    labelRefs.centralBadge,
    width,
    height
  );
  targets.modules.forEach((mod) => {
    updateOverlayPosition(
      mod.labelAnchor,
      camera,
      labelRefs.moduleBadges[mod.id],
      width,
      height
    );
  });
}
