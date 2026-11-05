import * as THREE from "three";
import { SharedMaterials } from "./palette";
import { createUprightWindowSlab } from "./primitives";
import { UNDRIFT_LOGO_DATA_URI } from "../assets/undriftLogoDataUri";

export interface FindingsPanelHandles {
  root: THREE.Group;
  panelWindow: THREE.Group;
  activeFindingBar: THREE.Mesh;
  findingEvidenceOrigin: THREE.Object3D;
  findingsOverlayAnchor: THREE.Object3D;
}

function createWarningTriangleIcon(materials: SharedMaterials): THREE.Group {
  const g = new THREE.Group();
  const s = 0.095;
  const pts = [
    new THREE.Vector3(0, s, 0),
    new THREE.Vector3(-s, -s * 0.85, 0),
    new THREE.Vector3(s, -s * 0.85, 0),
  ];
  g.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      materials.primaryLine
    )
  );
  // Exclamation stem
  const stem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.018, 0.065),
    materials.rimHighlight
  );
  stem.position.set(0, -0.01, 0);
  g.add(stem);
  return g;
}

function createInfoCircleIcon(materials: SharedMaterials): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.072, 0.088, 20),
    materials.secondaryLine
  );
  g.add(ring);
  const stem = new THREE.Mesh(
    new THREE.PlaneGeometry(0.018, 0.065),
    materials.rimHighlight
  );
  g.add(stem);
  return g;
}

function createCheckCircleIcon(materials: SharedMaterials): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.072, 0.088, 20),
    materials.secondaryLine
  );
  g.add(ring);
  const checkPts = [
    new THREE.Vector3(-0.038, -0.005, 0.002),
    new THREE.Vector3(-0.01, -0.035, 0.002),
    new THREE.Vector3(0.042, 0.032, 0.002),
  ];
  g.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(checkPts),
      materials.primaryLine
    )
  );
  return g;
}

function createOfficialUndriftBadgeMesh(svgUrl?: string): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    tex.needsUpdate = true;
  };
  img.src = svgUrl || UNDRIFT_LOGO_DATA_URI;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  return new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), mat);
}

export function buildFindingsPanel(
  materials: SharedMaterials,
  logoSvgUrl?: string
): FindingsPanelHandles {
  const root = new THREE.Group();
  // Positioned in front (+Z) and slightly lower-right (+X) of the main VS Code editor
  root.position.set(0.46, -0.26, 0.85);

  const panelW = 2.42;
  const panelH = 1.54;
  const panelT = 0.095;

  const panelWindow = createUprightWindowSlab(
    panelW,
    panelH,
    panelT,
    0.11,
    materials.mainSurface,
    materials.primaryLine,
    materials.secondaryLine
  );

  const zFront = panelT + 0.014;
  const halfW = panelW / 2;
  const halfH = panelH / 2;

  // 1. Slim Window Header
  const headerBottomY = halfH - 0.24;
  panelWindow.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-halfW + 0.04, headerBottomY, zFront),
        new THREE.Vector3(halfW - 0.04, headerBottomY, zFront),
      ]),
      materials.primaryLine
    )
  );

  // 3 window dots on top-left
  const dotGeo = new THREE.CircleGeometry(0.028, 10);
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(dotGeo, materials.rimHighlight);
    dot.position.set(-halfW + 0.16 + i * 0.095, halfH - 0.12, zFront);
    panelWindow.add(dot);
  }

  //Header bar + Official UNDRIFT logo mark on right side of header
  const headerTitleBar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.036),
    materials.rimHighlight
  );
  headerTitleBar.position.set(-halfW + 0.68, halfH - 0.12, zFront);
  panelWindow.add(headerTitleBar);

  const undriftBadge = createOfficialUndriftBadgeMesh(logoSvgUrl);
  undriftBadge.position.set(halfW - 0.22, halfH - 0.12, zFront + 0.002);
  panelWindow.add(undriftBadge);

  // 2. Three Minimal Finding Rows with Status Icons & Dividers
  const rowYPositions = [0.22, -0.14, -0.48];
  const icons = [
    createWarningTriangleIcon(materials),
    createInfoCircleIcon(materials),
    createCheckCircleIcon(materials),
  ];

  let activeFindingBar!: THREE.Mesh;
  const findingEvidenceOrigin = new THREE.Object3D();

  rowYPositions.forEach((rowY, idx) => {
    const isSelectedFinding = idx === 0;

    // Status icon on left
    const icon = icons[idx];
    icon.position.set(-halfW + 0.26, rowY, zFront + 0.002);
    panelWindow.add(icon);

    // Primary finding title bar
    const primaryW = isSelectedFinding ? 1.15 : 0.92;
    const primaryBar = new THREE.Mesh(
      new THREE.PlaneGeometry(primaryW, isSelectedFinding ? 0.072 : 0.048),
      isSelectedFinding ? materials.activeCodeSurface : materials.highlightSurface
    );
    primaryBar.position.set(
      -halfW + 0.48 + primaryW / 2,
      rowY + 0.045,
      zFront + (isSelectedFinding ? 0.004 : 0)
    );
    panelWindow.add(primaryBar);

    if (isSelectedFinding) {
      activeFindingBar = primaryBar;

      // Origin node for the Source Evidence Connector (links to highlighted editor line)
      const originDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.044, 12, 12),
        materials.pulseNode
      );
      originDot.position.set(-halfW + 0.56, rowY + 0.12, zFront + 0.012);
      panelWindow.add(originDot);

      findingEvidenceOrigin.position.copy(originDot.position);
      panelWindow.add(findingEvidenceOrigin);
    }

    // Secondary detail bar below primary bar
    const secondaryW = isSelectedFinding ? 1.38 : 1.12;
    const secondaryBar = new THREE.Mesh(
      new THREE.PlaneGeometry(secondaryW, 0.038),
      materials.highlightSurface
    );
    secondaryBar.position.set(
      -halfW + 0.48 + secondaryW / 2,
      rowY - 0.055,
      zFront
    );
    panelWindow.add(secondaryBar);

    // Subtle row divider below rows 0 and 1
    if (idx < 2) {
      const divY = rowY - 0.18;
      panelWindow.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-halfW + 0.14, divY, zFront),
            new THREE.Vector3(halfW - 0.14, divY, zFront),
          ]),
          materials.mutedLine
        )
      );
    }
  });

  root.add(panelWindow);

  // Anchor for editable HTML findings overlay card
  const findingsOverlayAnchor = new THREE.Object3D();
  findingsOverlayAnchor.position.set(0.0, -0.92, 0.25);
  root.add(findingsOverlayAnchor);

  return {
    root,
    panelWindow,
    activeFindingBar,
    findingEvidenceOrigin,
    findingsOverlayAnchor,
  };
}
