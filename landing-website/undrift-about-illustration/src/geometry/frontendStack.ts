import * as THREE from "three";
import { SharedMaterials } from "./palette";
import {
  createRoundedPlatform,
  createRoundedRectShape,
  createVerticalLeader,
} from "./primitives";

export interface FrontendStackHandles {
  root: THREE.Group;
  panels: THREE.Group[];
  calloutAnchor: THREE.Object3D;
}

/**
 * Creates an upright rounded browser/editor card oriented along the isometric Z-plane.
 */
function createBrowserWindowCard(
  width: number,
  height: number,
  thickness: number,
  isFrontMost: boolean,
  materials: SharedMaterials
): THREE.Group {
  const card = new THREE.Group();
  const r = 0.12;
  const shape = createRoundedRectShape(width, height, r);

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 12,
  });

  const mesh = new THREE.Mesh(
    extrudeGeo,
    isFrontMost ? materials.mainSurface : materials.secondarySurface
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  card.add(mesh);

  // Outer perimeter outline on front and back faces
  const pts = shape.getPoints(32);
  const frontPts = pts.map((p) => new THREE.Vector3(p.x, p.y, thickness + 0.004));
  const backPts = pts.map((p) => new THREE.Vector3(p.x, p.y, -0.004));

  card.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(frontPts),
      isFrontMost ? materials.primaryLine : materials.secondaryLine
    )
  );
  card.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(backPts),
      materials.mutedLine
    )
  );

  // Header divider line
  const headerY = height / 2 - 0.28;
  const headerGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-width / 2 + 0.03, headerY, thickness + 0.006),
    new THREE.Vector3(width / 2 - 0.03, headerY, thickness + 0.006),
  ]);
  card.add(
    new THREE.Line(
      headerGeo,
      isFrontMost ? materials.primaryLine : materials.secondaryLine
    )
  );

  // Three window control indicator dots on top-left
  const dotGeo = new THREE.CircleGeometry(0.038, 12);
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(
      dotGeo,
      isFrontMost ? materials.rimHighlight : materials.highlightSurface
    );
    dot.position.set(
      -width / 2 + 0.18 + i * 0.12,
      height / 2 - 0.14,
      thickness + 0.007
    );
    card.add(dot);
  }

  // Front-most card interior: Left code box (</>) + horizontal lines + Right API method/endpoint rows
  if (isFrontMost) {
    const zFront = thickness + 0.008;

    // Left sub-panel frame (code view box)
    const codeBoxW = width * 0.44;
    const codeBoxH = height * 0.36;
    const codeBoxX = -width * 0.21;
    const codeBoxY = 0.08;

    const boxPts = [
      new THREE.Vector3(codeBoxX - codeBoxW / 2, codeBoxY - codeBoxH / 2, zFront),
      new THREE.Vector3(codeBoxX + codeBoxW / 2, codeBoxY - codeBoxH / 2, zFront),
      new THREE.Vector3(codeBoxX + codeBoxW / 2, codeBoxY + codeBoxH / 2, zFront),
      new THREE.Vector3(codeBoxX - codeBoxW / 2, codeBoxY + codeBoxH / 2, zFront),
    ];
    card.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(boxPts),
        materials.secondaryLine
      )
    );

    // Vector '</>' symbol inside the code box
    const chevronVerts = [
      // '<'
      codeBoxX - 0.14, codeBoxY + 0.09, zFront + 0.004,
      codeBoxX - 0.24, codeBoxY,        zFront + 0.004,
      codeBoxX - 0.24, codeBoxY,        zFront + 0.004,
      codeBoxX - 0.14, codeBoxY - 0.09, zFront + 0.004,
      // '/'
      codeBoxX - 0.05, codeBoxY - 0.12, zFront + 0.004,
      codeBoxX + 0.05, codeBoxY + 0.12, zFront + 0.004,
      // '>'
      codeBoxX + 0.14, codeBoxY + 0.09, zFront + 0.004,
      codeBoxX + 0.24, codeBoxY,        zFront + 0.004,
      codeBoxX + 0.24, codeBoxY,        zFront + 0.004,
      codeBoxX + 0.14, codeBoxY - 0.09, zFront + 0.004,
    ];
    const chevronGeo = new THREE.BufferGeometry();
    chevronGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(chevronVerts, 3)
    );
    card.add(new THREE.LineSegments(chevronGeo, materials.primaryLine));

    // Four horizontal abstract code lines below the code box
    const lineLengths = [0.82, 0.82, 0.65, 0.52];
    lineLengths.forEach((len, idx) => {
      const barGeo = new THREE.PlaneGeometry(len, 0.048);
      const bar = new THREE.Mesh(barGeo, materials.highlightSurface);
      bar.position.set(
        -width / 2 + 0.18 + len / 2,
        -0.36 - idx * 0.12,
        zFront
      );
      card.add(bar);
    });

    // Right side API Endpoint entries (HTTP method pills + endpoint path bars)
    const rightX = 0.12;
    for (let rIdx = 0; rIdx < 3; rIdx++) {
      const rowY = -0.15 - rIdx * 0.24;

      // Small top path bar above each badge
      const labelBar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.45 - rIdx * 0.06, 0.042),
        materials.highlightSurface
      );
      labelBar.position.set(rightX + 0.24, rowY + 0.36, zFront);
      card.add(labelBar);

      // Method + Endpoint pill box with crisp border
      const pillW = 0.68;
      const pillH = 0.13;
      const pillFill = new THREE.Mesh(
        new THREE.PlaneGeometry(pillW, pillH),
        materials.highlightSurface
      );
      pillFill.position.set(rightX + pillW / 2, rowY, zFront);
      card.add(pillFill);

      const pillBorderPts = [
        new THREE.Vector3(rightX, rowY - pillH / 2, zFront + 0.002),
        new THREE.Vector3(rightX + pillW, rowY - pillH / 2, zFront + 0.002),
        new THREE.Vector3(rightX + pillW, rowY + pillH / 2, zFront + 0.002),
        new THREE.Vector3(rightX, rowY + pillH / 2, zFront + 0.002),
      ];
      card.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pillBorderPts),
          materials.secondaryLine
        )
      );
    }
  } else {
    // Subtle inner wireframe grid for background stacked cards
    const innerPts = [
      new THREE.Vector3(-width * 0.38, -height * 0.32, thickness + 0.004),
      new THREE.Vector3(width * 0.38, -height * 0.32, thickness + 0.004),
      new THREE.Vector3(width * 0.38, height * 0.22, thickness + 0.004),
      new THREE.Vector3(-width * 0.38, height * 0.22, thickness + 0.004),
    ];
    card.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(innerPts),
        materials.mutedLine
      )
    );
  }

  return card;
}

export function buildFrontendStack(
  materials: SharedMaterials
): FrontendStackHandles {
  const root = new THREE.Group();
  root.position.set(-3.75, 0, 0.35);

  // 1. Base pedestal (two-tier rounded platform)
  const lowerBase = createRoundedPlatform(
    2.65,
    2.65,
    0.16,
    0.26,
    materials.secondarySurface,
    materials.primaryLine
  );
  lowerBase.position.y = -0.92;
  root.add(lowerBase);

  const upperBase = createRoundedPlatform(
    2.38,
    2.38,
    0.22,
    0.22,
    materials.mainSurface,
    materials.primaryLine
  );
  upperBase.position.y = -0.74;
  root.add(upperBase);

  // 2. Layered overlapping browser/editor interfaces
  const panels: THREE.Group[] = [];
  const totalPanels = 4;
  const cardWidth = 1.95;
  const cardHeight = 1.72;
  const cardThickness = 0.055;

  for (let i = 0; i < totalPanels; i++) {
    const isFrontMost = i === 0;
    const panel = createBrowserWindowCard(
      cardWidth,
      cardHeight,
      cardThickness,
      isFrontMost,
      materials
    );

    panel.position.set(
      i * 0.12 - 0.18,
      0.38 + i * 0.08,
      0.56 - i * 0.38
    );
    root.add(panel);
    panels.push(panel);
  }

  // 3. Vertical dashed leader line rising above the stack to the "Frontend API Usage" badge
  const leader = createVerticalLeader(1.15, materials);
  leader.position.set(-0.05, 1.38, 0.15);
  root.add(leader);

  const calloutAnchor = new THREE.Object3D();
  calloutAnchor.position.set(-0.05, 2.68, 0.15);
  root.add(calloutAnchor);

  return { root, panels, calloutAnchor };
}
