import * as THREE from "three";
import { YourCodeStackHandles } from "../geometry/yourCodeStack";
import { VSCodeEditorHandles } from "../geometry/vscodeEditor";
import { FindingsPanelHandles } from "../geometry/findingsPanel";
import { VSCodeConnectorsHandles } from "../geometry/connectors";

export interface VSCodeSceneTargets {
  sceneRoot: THREE.Group;
  yourCode: YourCodeStackHandles;
  editor: VSCodeEditorHandles;
  findings: FindingsPanelHandles;
  connectors: VSCodeConnectorsHandles;
}

export interface VSCodeLabelDOMRefs {
  yourCodeBadge: HTMLDivElement | null;
  topExtensionBadge: HTMLDivElement | null;
  findingsDetailBadge: HTMLDivElement | null;
  rightCapabilityBadge: HTMLDivElement | null;
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

export function stepVSCodeSceneAnimation(
  elapsedTime: number,
  targets: VSCodeSceneTargets,
  pointer: { x: number; y: number },
  currentParallax: { x: number; y: number },
  animate: boolean,
  interactive: boolean,
  camera: THREE.Camera,
  labelRefs: VSCodeLabelDOMRefs,
  width: number,
  height: number
): void {
  // 1. Constrained pointer parallax
  const targetRotY = interactive ? pointer.x * 0.04 : 0;
  const targetRotX = interactive ? -pointer.y * 0.026 : 0;
  currentParallax.x += (targetRotX - currentParallax.x) * 0.06;
  currentParallax.y += (targetRotY - currentParallax.y) * 0.06;

  targets.sceneRoot.rotation.x = currentParallax.x;
  targets.sceneRoot.rotation.y = currentParallax.y;

  const evidenceTubeGeo = targets.connectors.evidenceTubeMesh
    .geometry as THREE.BufferGeometry;
  const totalIndexCount = evidenceTubeGeo.index
    ? evidenceTubeGeo.index.count
    : 2304;

  if (animate) {
    // 2. Left "Your Code" stack gentle grouped floating + per-card breath
    targets.yourCode.root.position.y =
      -0.25 + Math.sin(elapsedTime * 1.1) * 0.035;
    targets.yourCode.cards.forEach((card, idx) => {
      card.position.y =
        -0.02 + idx * 0.06 + Math.sin(elapsedTime * 1.35 + idx * 0.5) * 0.01;
    });

    // 3. Main VS Code Editor gentle floating
    targets.editor.editorWindow.position.y =
      0.36 + Math.sin(elapsedTime * 1.05 + 0.6) * 0.032;

    // 4. Foreground UNDRIFT Findings panel subtle depth & vertical settling
    targets.findings.panelWindow.position.y =
      Math.sin(elapsedTime * 1.2 + 1.4) * 0.028;
    targets.findings.panelWindow.position.z =
      Math.sin(elapsedTime * 0.9) * 0.015;

    // 5. Left-to-Editor conduits traveling pulse nodes
    targets.connectors.leftPulses.forEach((pulse) => {
      const u = (elapsedTime * pulse.speed + pulse.offset) % 1.0;
      pulse.pulseMesh.position.copy(pulse.curve.getPointAt(u));
    });

    // 6. Deliberate 6-second cycle for Finding 01 -> Source Evidence Connector -> Editor Highlight
    const cycleDuration = 6.0;
    const phase = (elapsedTime % cycleDuration) / cycleDuration; // 0.0 -> 1.0

    // Phase breakdown:
    // 0.00 - 0.18: Finding 01 indicator illuminates
    // 0.18 - 0.55: Source evidence connector draws & node travels from Finding 01 to editor line
    // 0.55 - 0.82: Highlighted source location in editor illuminates softly
    // 0.82 - 1.00: Smoothly settles back to idle state
    const findingMat = targets.findings.activeFindingBar
      .material as THREE.MeshBasicMaterial;
    const editorCodeMat = targets.editor.highlightedCodeLine
      .material as THREE.MeshBasicMaterial;
    const evidenceMat = targets.connectors.evidenceTubeMesh
      .material as THREE.MeshBasicMaterial;

    if (phase < 0.18) {
      const p = phase / 0.18;
      findingMat.opacity = 0.72 + Math.sin(p * Math.PI * 0.5) * 0.28;
      evidenceTubeGeo.setDrawRange(0, Math.floor(totalIndexCount * 0.15));
      evidenceMat.opacity = 0.45;
      targets.connectors.evidencePulseNode.position.copy(
        targets.connectors.evidenceCurve.getPointAt(0)
      );
      editorCodeMat.opacity = 0.68;
    } else if (phase < 0.55) {
      const p = (phase - 0.18) / 0.37;
      const eased = p * p * (3 - 2 * p);
      findingMat.opacity = 1.0;
      // Align draw count to multiple of 3 for triangle indices
      const count = Math.floor((totalIndexCount * eased) / 3) * 3;
      evidenceTubeGeo.setDrawRange(0, Math.max(3, count));
      evidenceMat.opacity = 0.95;
      targets.connectors.evidencePulseNode.position.copy(
        targets.connectors.evidenceCurve.getPointAt(eased)
      );
      editorCodeMat.opacity = 0.68 + eased * 0.32;
    } else if (phase < 0.82) {
      const p = (phase - 0.55) / 0.27;
      findingMat.opacity = 0.95;
      evidenceTubeGeo.setDrawRange(0, totalIndexCount);
      evidenceMat.opacity = 0.92;
      targets.connectors.evidencePulseNode.position.copy(
        targets.connectors.evidenceCurve.getPointAt(1.0)
      );
      editorCodeMat.opacity = 0.88 + Math.sin(p * Math.PI) * 0.12;
    } else {
      const p = (phase - 0.82) / 0.18;
      findingMat.opacity = 0.95 - p * 0.23;
      evidenceTubeGeo.setDrawRange(0, totalIndexCount);
      evidenceMat.opacity = 0.92 - p * 0.47;
      targets.connectors.evidencePulseNode.position.copy(
        targets.connectors.evidenceCurve.getPointAt(1.0 - p)
      );
      editorCodeMat.opacity = 0.88 - p * 0.2;
    }
  } else {
    // Static pose for reduced motion or animationEnabled=false
    targets.yourCode.root.position.y = -0.25;
    targets.editor.editorWindow.position.y = 0.36;
    targets.findings.panelWindow.position.y = 0;
    targets.findings.panelWindow.position.z = 0;
    evidenceTubeGeo.setDrawRange(0, totalIndexCount);

    targets.connectors.leftPulses.forEach((pulse, idx) => {
      pulse.pulseMesh.position.copy(
        pulse.curve.getPointAt((0.4 + idx * 0.25) % 1.0)
      );
    });
    targets.connectors.evidencePulseNode.position.copy(
      targets.connectors.evidenceCurve.getPointAt(0.55)
    );
  }

  // 7. Project 3D anchors to 2D editable HTML overlay badges
  targets.sceneRoot.updateMatrixWorld();
  updateOverlayPosition(
    targets.yourCode.calloutAnchor,
    camera,
    labelRefs.yourCodeBadge,
    width,
    height
  );
  updateOverlayPosition(
    targets.editor.topCalloutAnchor,
    camera,
    labelRefs.topExtensionBadge,
    width,
    height
  );
  updateOverlayPosition(
    targets.findings.findingsOverlayAnchor,
    camera,
    labelRefs.findingsDetailBadge,
    width,
    height
  );
  updateOverlayPosition(
    targets.connectors.rightCalloutAnchor,
    camera,
    labelRefs.rightCapabilityBadge,
    width,
    height
  );
}
