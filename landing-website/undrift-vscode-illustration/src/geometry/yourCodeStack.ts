import * as THREE from "three";
import { SharedMaterials } from "./palette";
import {
  createRoundedPlatform,
  createUprightWindowSlab,
  createVerticalLeader,
} from "./primitives";

export interface YourCodeStackHandles {
  root: THREE.Group;
  cards: THREE.Group[];
  calloutAnchor: THREE.Object3D;
}

function createSourceCodePanelCard(
  width: number,
  height: number,
  thickness: number,
  isFrontMost: boolean,
  materials: SharedMaterials
): THREE.Group {
  const card = createUprightWindowSlab(
    width,
    height,
    thickness,
    0.1,
    isFrontMost ? materials.mainSurface : materials.secondarySurface,
    isFrontMost ? materials.primaryLine : materials.secondaryLine,
    materials.mutedLine
  );

  const zFront = thickness + 0.012;

  // Window header divider line
  const headerY = height / 2 - 0.22;
  card.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2 + 0.04, headerY, zFront),
        new THREE.Vector3(width / 2 - 0.04, headerY, zFront),
      ]),
      isFrontMost ? materials.secondaryLine : materials.mutedLine
    )
  );

  // Three window control indicator dots on top-left
  const dotGeo = new THREE.CircleGeometry(0.026, 10);
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(
      dotGeo,
      isFrontMost ? materials.rimHighlight : materials.highlightSurface
    );
    dot.position.set(-width / 2 + 0.14 + i * 0.085, height / 2 - 0.11, zFront);
    card.add(dot);
  }

  if (isFrontMost) {
    // Crisp '</>' code emblem centered on the front-most panel
    const cy = -0.06;
    const chevronVerts = [
      // '<'
      -0.16, cy + 0.11, zFront + 0.002,
      -0.29, cy,        zFront + 0.002,
      -0.29, cy,        zFront + 0.002,
      -0.16, cy - 0.11, zFront + 0.002,
      // '/'
      -0.06, cy - 0.15, zFront + 0.002,
       0.06, cy + 0.15, zFront + 0.002,
      // '>'
       0.16, cy + 0.11, zFront + 0.002,
       0.29, cy,        zFront + 0.002,
       0.29, cy,        zFront + 0.002,
       0.16, cy - 0.11, zFront + 0.002,
    ];
    const chevronGeo = new THREE.BufferGeometry();
    chevronGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(chevronVerts, 3)
    );
    card.add(new THREE.LineSegments(chevronGeo, materials.primaryLine));

    // Subtle abstract file/route bars below header and at bottom
    const topBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.036),
      materials.highlightSurface
    );
    topBar.position.set(-width / 2 + 0.34, headerY - 0.12, zFront);
    card.add(topBar);

    const botBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.036),
      materials.highlightSurface
    );
    botBar.position.set(0, -height / 2 + 0.18, zFront);
    card.add(botBar);
  }

  return card;
}

export function buildYourCodeStack(
  materials: SharedMaterials
): YourCodeStackHandles {
  const root = new THREE.Group();
  root.position.set(-3.75, -0.25, 1.35);

  // 1. Rounded isometric pedestal under the 3 source panels
  const basePlate = createRoundedPlatform(
    1.88,
    1.76,
    0.15,
    0.22,
    materials.secondarySurface,
    materials.primaryLine
  );
  basePlate.position.y = -0.82;
  root.add(basePlate);

  // 2. Three layered upright source-code panels stepped along -Z
  const cards: THREE.Group[] = [];
  const cardW = 1.12;
  const cardH = 1.24;
  const cardT = 0.05;

  for (let i = 0; i < 3; i++) {
    const isFrontMost = i === 0;
    const card = createSourceCodePanelCard(
      cardW,
      cardH,
      cardT,
      isFrontMost,
      materials
    );
    card.position.set(
      i * 0.06 - 0.06,
      -0.02 + i * 0.06,
      0.28 - i * 0.28
    );
    root.add(card);
    cards.push(card);
  }

  // 3. Vertical dashed leader line rising above the stack to "Your Code" callout
  const leader = createVerticalLeader(0.95, materials);
  leader.position.set(0.0, 0.72, 0.0);
  root.add(leader);

  const calloutAnchor = new THREE.Object3D();
  calloutAnchor.position.set(-0.1, 1.82, 0.0);
  root.add(calloutAnchor);

  return { root, cards, calloutAnchor };
}
