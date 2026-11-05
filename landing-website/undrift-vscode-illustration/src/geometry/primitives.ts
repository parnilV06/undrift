import * as THREE from "three";
import { SharedMaterials, UNDRIFT_PALETTE } from "./palette";

/**
 * Creates a rounded 2D THREE.Shape centered at (0, 0).
 */
export function createRoundedRectShape(
  width: number,
  height: number,
  radius: number
): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  return shape;
}

/**
 * Builds an extruded horizontal slab (lying in the XZ plane) with crisp top & bottom outlines.
 */
export function createRoundedPlatform(
  width: number,
  depth: number,
  height: number,
  radius: number,
  surfaceMat: THREE.Material,
  outlineMat: THREE.LineBasicMaterial,
  curveSegments = 16
): THREE.Group {
  const group = new THREE.Group();
  const shape = createRoundedRectShape(width, depth, radius);

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
    curveSegments,
  });

  extrudeGeo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(extrudeGeo, surfaceMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const pts2D = shape.getPoints(curveSegments * 2);
  const topPts = pts2D.map((p) => new THREE.Vector3(p.x, height + 0.016, -p.y));
  const botPts = pts2D.map((p) => new THREE.Vector3(p.x, -0.016, -p.y));

  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(topPts),
      outlineMat
    )
  );
  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(botPts),
      outlineMat
    )
  );

  return group;
}

/**
 * Builds an upright rounded window slab lying in the XY plane (extruded along +Z)
 * with crisp front and back architectural perimeter outlines.
 */
export function createUprightWindowSlab(
  width: number,
  height: number,
  thickness: number,
  radius: number,
  surfaceMat: THREE.Material,
  frontOutlineMat: THREE.LineBasicMaterial,
  backOutlineMat: THREE.LineBasicMaterial,
  curveSegments = 14
): THREE.Group {
  const group = new THREE.Group();
  const shape = createRoundedRectShape(width, height, radius);

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments,
  });

  const mesh = new THREE.Mesh(extrudeGeo, surfaceMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const pts2D = shape.getPoints(curveSegments * 2);
  const frontPts = pts2D.map(
    (p) => new THREE.Vector3(p.x, p.y, thickness + 0.01)
  );
  const backPts = pts2D.map((p) => new THREE.Vector3(p.x, p.y, -0.01));

  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(frontPts),
      frontOutlineMat
    )
  );
  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(backPts),
      backOutlineMat
    )
  );

  return group;
}

/**
 * Builds the faint isometric construction grid on the ground plane (Y = -1.22).
 */
export function createIsometricFloorGrid(
  size = 20,
  divisions = 20
): THREE.Group {
  const gridGroup = new THREE.Group();
  const half = size / 2;
  const step = size / divisions;
  const vertices: number[] = [];

  for (let i = 0; i <= divisions; i++) {
    const pos = -half + i * step;
    vertices.push(-half, 0, pos, half, 0, pos);
    vertices.push(pos, 0, -half, pos, 0, half);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));

  const mat = new THREE.LineBasicMaterial({
    color: UNDRIFT_PALETTE.gridLine,
    transparent: true,
    opacity: 0.36,
  });

  gridGroup.add(new THREE.LineSegments(geo, mat));
  gridGroup.position.set(0, -1.22, 0);
  return gridGroup;
}

/**
 * Builds a vertical dashed leader line with a glowing anchor sphere.
 */
export function createVerticalLeader(
  height: number,
  materials: SharedMaterials
): THREE.Group {
  const group = new THREE.Group();

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, height, 0),
  ]);

  const dashedMat = new THREE.LineDashedMaterial({
    color: UNDRIFT_PALETTE.primaryOutline,
    dashSize: 0.08,
    gapSize: 0.06,
    transparent: true,
    opacity: 0.78,
  });

  const line = new THREE.Line(lineGeo, dashedMat);
  line.computeLineDistances();
  group.add(line);

  const dotGeo = new THREE.SphereGeometry(0.055, 12, 12);
  const dot = new THREE.Mesh(dotGeo, materials.pulseNode);
  dot.position.set(0, height - 0.12, 0);
  group.add(dot);

  return group;
}
