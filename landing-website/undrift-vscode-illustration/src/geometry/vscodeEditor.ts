import * as THREE from "three";
import { SharedMaterials } from "./palette";
import {
  createRoundedPlatform,
  createRoundedRectShape,
  createUprightWindowSlab,
  createVerticalLeader,
} from "./primitives";

export interface VSCodeEditorHandles {
  root: THREE.Group;
  editorWindow: THREE.Group;
  highlightedCodeLine: THREE.Mesh;
  highlightedCodeFrame: THREE.LineLoop;
  sourceEvidenceAnchor: THREE.Object3D;
  topCalloutAnchor: THREE.Object3D;
}

/**
 * Procedurally constructs the 3D isometric Visual Studio Code folded ribbon emblem
 * displayed inside the right area of the editor canvas in the reference illustration.
 */
function create3DVSCodeRibbonMark(materials: SharedMaterials): THREE.Group {
  const emblem = new THREE.Group();

  // Right vertical wing + folded ribbon cross-arms
  const ribbonShape = new THREE.Shape();
  ribbonShape.moveTo(0.18, 0.34);
  ribbonShape.lineTo(0.34, 0.26);
  ribbonShape.lineTo(0.34, -0.26);
  ribbonShape.lineTo(0.18, -0.34);
  ribbonShape.lineTo(-0.14, -0.06);
  ribbonShape.lineTo(-0.28, -0.18);
  ribbonShape.lineTo(-0.35, -0.13);
  ribbonShape.lineTo(-0.35, 0.13);
  ribbonShape.lineTo(-0.28, 0.18);
  ribbonShape.lineTo(-0.14, 0.06);
  ribbonShape.closePath();

  // Inner triangular cutout
  const rightHole = new THREE.Path();
  rightHole.moveTo(0.18, 0.17);
  rightHole.lineTo(-0.02, 0.0);
  rightHole.lineTo(0.18, -0.17);
  rightHole.closePath();
  ribbonShape.holes.push(rightHole);

  const extrudeGeo = new THREE.ExtrudeGeometry(ribbonShape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
  });

  const mesh = new THREE.Mesh(extrudeGeo, materials.rimHighlight);
  emblem.add(mesh);

  const pts = ribbonShape.getPoints(24).map(
    (p) => new THREE.Vector3(p.x, p.y, 0.052)
  );
  emblem.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      materials.primaryLine
    )
  );

  return emblem;
}

export function buildVSCodeEditor(
  materials: SharedMaterials
): VSCodeEditorHandles {
  const root = new THREE.Group();
  root.position.set(0.15, 0.0, -0.15);

  // 1. Main Rear Base Plate (supporting the VS Code editor)
  const mainBase = createRoundedPlatform(
    4.75,
    2.65,
    0.15,
    0.26,
    materials.secondarySurface,
    materials.primaryLine
  );
  mainBase.position.set(0.0, -1.08, -0.15);
  root.add(mainBase);

  // 2. Stepped Foreground Base Plate (supporting the integrated UNDRIFT Findings panel)
  const frontBase = createRoundedPlatform(
    3.05,
    1.85,
    0.15,
    0.24,
    materials.mainSurface,
    materials.primaryLine
  );
  frontBase.position.set(0.32, -1.06, 0.92);
  root.add(frontBase);

  // 3. Prominent Visual Studio Code Editor Window
  const editorW = 4.15;
  const editorH = 2.76;
  const editorT = 0.13;

  const editorWindow = createUprightWindowSlab(
    editorW,
    editorH,
    editorT,
    0.14,
    materials.mainSurface,
    materials.primaryLine,
    materials.secondaryLine
  );
  editorWindow.position.set(0.0, 0.36, -0.25);

  const zFront = editorT + 0.014;
  const halfW = editorW / 2;
  const halfH = editorH / 2;

  // A. Title Bar Divider & Controls
  const titleBarBottomY = halfH - 0.32;
  editorWindow.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfW + 0.04, titleBarBottomY, zFront),
        new THREE.Vector3(halfW - 0.04, titleBarBottomY, zFront),
      ]),
      materials.primaryLine
    )
  );

  // 4 window indicator dots on top-left (matching reference image)
  const dotGeo = new THREE.CircleGeometry(0.036, 12);
  for (let i = 0; i < 4; i++) {
    const dot = new THREE.Mesh(
      dotGeo,
      i < 3 ? materials.rimHighlight : materials.highlightSurface
    );
    dot.position.set(-halfW + 0.22 + i * 0.14, halfH - 0.16, zFront);
    editorWindow.add(dot);
  }

  // Centered command/search pill box in the title bar
  const searchShape = createRoundedRectShape(1.38, 0.12, 0.05);
  const searchPts = searchShape
    .getPoints(20)
    .map((p) => new THREE.Vector3(p.x - 0.05, p.y + (halfH - 0.16), zFront));
  editorWindow.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(searchPts),
      materials.primaryLine
    )
  );

  // B. Slim Vertical Activity Bar (far left)
  const activityBarRightX = -halfW + 0.38;
  editorWindow.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(activityBarRightX, titleBarBottomY, zFront),
        new THREE.Vector3(activityBarRightX, -halfH + 0.04, zFront),
      ]),
      materials.secondaryLine
    )
  );

  // 4 circular activity icons (3 rings + 1 active solid white circle at index 2)
  const ringGeo = new THREE.RingGeometry(0.048, 0.068, 18);
  const activeCircleGeo = new THREE.CircleGeometry(0.068, 18);
  for (let i = 0; i < 4; i++) {
    const iconY = titleBarBottomY - 0.26 - i * 0.34;
    const iconMesh =
      i === 2
        ? new THREE.Mesh(activeCircleGeo, materials.rimHighlight)
        : new THREE.Mesh(ringGeo, materials.secondaryLine);
    iconMesh.position.set(-halfW + 0.19, iconY, zFront);
    editorWindow.add(iconMesh);
  }

  // C. Minimal File Explorer Sidebar
  const explorerRightX = activityBarRightX + 0.78;
  editorWindow.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(explorerRightX, titleBarBottomY, zFront),
        new THREE.Vector3(explorerRightX, -halfH + 0.04, zFront),
      ]),
      materials.secondaryLine
    )
  );

  const explorerItemLengths = [0.46, 0.52, 0.42, 0.50, 0.38, 0.48, 0.44];
  const smallDotGeo = new THREE.CircleGeometry(0.022, 8);
  explorerItemLengths.forEach((len, idx) => {
    const rowY = titleBarBottomY - 0.24 - idx * 0.24;
    const itemDot = new THREE.Mesh(smallDotGeo, materials.highlightSurface);
    itemDot.position.set(activityBarRightX + 0.12, rowY, zFront);
    editorWindow.add(itemDot);

    const itemBar = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 0.044),
      idx === 2 ? materials.rimHighlight : materials.highlightSurface
    );
    itemBar.position.set(activityBarRightX + 0.20 + len / 2, rowY, zFront);
    editorWindow.add(itemBar);
  });

  // D. Central Editor Code Area + Line Numbers + Highlighted Source-Code Location
  const codeStartX = explorerRightX + 0.16;
  const codeLines: Array<{ indent: number; width: number; isHighlighted?: boolean }> = [
    { indent: 0.0, width: 0.65 },
    { indent: 0.0, width: 1.05 },
    { indent: 0.14, width: 1.22, isHighlighted: true }, // Highlighted source evidence line!
    { indent: 0.14, width: 0.88 },
    { indent: 0.24, width: 0.74 },
    { indent: 0.14, width: 0.96 },
    { indent: 0.0, width: 0.52 },
  ];

  let highlightedCodeLine!: THREE.Mesh;
  let highlightedCodeFrame!: THREE.LineLoop;
  const sourceEvidenceAnchor = new THREE.Object3D();

  codeLines.forEach((line, idx) => {
    const rowY = titleBarBottomY - 0.26 - idx * 0.21;

    // Subtle line number gutter tick
    const gutterTick = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.032),
      line.isHighlighted ? materials.rimHighlight : materials.highlightSurface
    );
    gutterTick.position.set(codeStartX, rowY, zFront);
    editorWindow.add(gutterTick);

    const barX = codeStartX + 0.14 + line.indent + line.width / 2;
    const barGeo = new THREE.PlaneGeometry(line.width, line.isHighlighted ? 0.068 : 0.046);
    const barMat = line.isHighlighted
      ? materials.activeCodeSurface
      : materials.highlightSurface;
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.position.set(barX, rowY, zFront + (line.isHighlighted ? 0.004 : 0));
    editorWindow.add(barMesh);

    if (line.isHighlighted) {
      highlightedCodeLine = barMesh;

      // Crisp highlight frame surrounding the source-code evidence location
      const frameW = line.width + 0.14;
      const frameH = 0.14;
      const framePts = [
        new THREE.Vector3(barX - frameW / 2, rowY - frameH / 2, zFront + 0.006),
        new THREE.Vector3(barX + frameW / 2, rowY - frameH / 2, zFront + 0.006),
        new THREE.Vector3(barX + frameW / 2, rowY + frameH / 2, zFront + 0.006),
        new THREE.Vector3(barX - frameW / 2, rowY + frameH / 2, zFront + 0.006),
      ];
      highlightedCodeFrame = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(framePts),
        materials.primaryLine
      );
      editorWindow.add(highlightedCodeFrame);

      // Anchor point where the Source Evidence Connector from the Findings Panel attaches
      const anchorDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 12),
        materials.pulseNode
      );
      anchorDot.position.set(barX - 0.12, rowY - 0.04, zFront + 0.012);
      editorWindow.add(anchorDot);

      sourceEvidenceAnchor.position.copy(anchorDot.position);
      editorWindow.add(sourceEvidenceAnchor);
    }
  });

  // E. 3D Visual Studio Code Ribbon Emblem on the right of the editor canvas
  const vscodeEmblem = create3DVSCodeRibbonMark(materials);
  vscodeEmblem.position.set(halfW - 0.68, 0.02, zFront + 0.005);
  editorWindow.add(vscodeEmblem);

  root.add(editorWindow);

  // 4. Top Brand Callout Leader ("VS Code Extension / Analyze APIs in your workflow")
  const topLeader = createVerticalLeader(0.88, materials);
  topLeader.position.set(0.45, 1.75, -0.25);
  root.add(topLeader);

  const topCalloutAnchor = new THREE.Object3D();
  topCalloutAnchor.position.set(0.45, 2.78, -0.25);
  root.add(topCalloutAnchor);

  return {
    root,
    editorWindow,
    highlightedCodeLine,
    highlightedCodeFrame,
    sourceEvidenceAnchor,
    topCalloutAnchor,
  };
}
