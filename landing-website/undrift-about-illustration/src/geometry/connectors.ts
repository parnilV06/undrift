import * as THREE from "three";
import { SharedMaterials } from "./palette";

export interface AnimatedPulseConduit {
  curve: THREE.CurvePath<THREE.Vector3>;
  pulseMesh: THREE.Mesh;
  speed: number;
  offset: number;
}

export interface ConnectorSystemHandles {
  root: THREE.Group;
  pulses: AnimatedPulseConduit[];
}

function createRoundedPath(
  waypoints: THREE.Vector3[],
  cornerRadius = 0.22
): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  if (waypoints.length < 2) return path;

  if (waypoints.length === 2) {
    path.add(new THREE.LineCurve3(waypoints[0], waypoints[1]));
    return path;
  }

  let currentStart = waypoints[0].clone();

  for (let i = 1; i < waypoints.length - 1; i++) {
    const pPrev = waypoints[i - 1];
    const pCurr = waypoints[i];
    const pNext = waypoints[i + 1];

    const vIn = new THREE.Vector3().subVectors(pCurr, pPrev);
    const vOut = new THREE.Vector3().subVectors(pNext, pCurr);
    const lenIn = vIn.length();
    const lenOut = vOut.length();
    const r = Math.min(cornerRadius, lenIn * 0.45, lenOut * 0.45);

    const cornerEntry = pCurr
      .clone()
      .sub(vIn.normalize().multiplyScalar(r));
    const cornerExit = pCurr
      .clone()
      .add(vOut.normalize().multiplyScalar(r));

    path.add(new THREE.LineCurve3(currentStart, cornerEntry));
    path.add(new THREE.QuadraticBezierCurve3(cornerEntry, pCurr, cornerExit));
    currentStart = cornerExit;
  }

  path.add(
    new THREE.LineCurve3(currentStart, waypoints[waypoints.length - 1])
  );
  return path;
}

export function buildConnectorSystem(
  materials: SharedMaterials
): ConnectorSystemHandles {
  const root = new THREE.Group();
  const pulses: AnimatedPulseConduit[] = [];
  const pulseGeo = new THREE.SphereGeometry(0.044, 12, 12);
  const junctionGeo = new THREE.SphereGeometry(0.052, 12, 12);

  // A. Left-to-Center: 6 parallel horizontal lines linking Frontend stack to UNDRIFT platform
  const numLeftLines = 6;
  for (let i = 0; i < numLeftLines; i++) {
    const t = (i / (numLeftLines - 1) - 0.5) * 0.68;
    const y = -0.38 - i * 0.035;
    const start = new THREE.Vector3(-2.55, y, 0.25 + t);
    const end = new THREE.Vector3(-1.05, y, t * 0.75);

    const curve = createRoundedPath([start, end], 0.12);
    const tubeGeo = new THREE.TubeGeometry(curve, 16, 0.014, 6, false);
    root.add(new THREE.Mesh(tubeGeo, materials.conduitTube));

    if (i % 2 === 0) {
      const pulseMesh = new THREE.Mesh(pulseGeo, materials.pulseNode);
      root.add(pulseMesh);
      pulses.push({
        curve,
        pulseMesh,
        speed: 0.22 + i * 0.02,
        offset: i * 0.28,
      });
    }
  }

  // B. Center-to-Right: Three dual-line branching conduits to Top, Middle, and Bottom modules
  const branchConfigs = [
    {
      pairOffsets: [-0.05, 0.05],
      waypoints: (d: number) => [
        new THREE.Vector3(1.02, -0.25, -0.35 + d),
        new THREE.Vector3(1.88 + d, -0.25, -0.35 + d),
        new THREE.Vector3(1.88 + d, 0.62, -1.85 + d),
        new THREE.Vector3(2.68, 0.62, -1.85 + d),
      ],
      junctionAt: new THREE.Vector3(2.58, 0.62, -1.85),
    },
    {
      pairOffsets: [-0.05, 0.05],
      waypoints: (d: number) => [
        new THREE.Vector3(1.05, -0.34, d),
        new THREE.Vector3(2.68, -0.28, d),
      ],
      junctionAt: new THREE.Vector3(2.58, -0.28, 0),
    },
    {
      pairOffsets: [-0.05, 0.05],
      waypoints: (d: number) => [
        new THREE.Vector3(1.02, -0.44, 0.35 + d),
        new THREE.Vector3(1.88 - d, -0.44, 0.35 + d),
        new THREE.Vector3(1.88 - d, -1.18, 1.85 + d),
        new THREE.Vector3(2.68, -1.18, 1.85 + d),
      ],
      junctionAt: new THREE.Vector3(2.58, -1.18, 1.85),
    },
  ];

  branchConfigs.forEach((branch, bIdx) => {
    branch.pairOffsets.forEach((offset, lineIdx) => {
      const pts = branch.waypoints(offset);
      const curve = createRoundedPath(pts, 0.26);
      const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.015, 8, false);
      root.add(new THREE.Mesh(tubeGeo, materials.conduitTube));

      const junction = new THREE.Mesh(junctionGeo, materials.pulseNode);
      junction.position.set(
        branch.junctionAt.x,
        branch.junctionAt.y,
        branch.junctionAt.z + offset
      );
      root.add(junction);

      if (lineIdx === 0) {
        const pulseMesh = new THREE.Mesh(pulseGeo, materials.pulseNode);
        root.add(pulseMesh);
        pulses.push({
          curve,
          pulseMesh,
          speed: 0.19,
          offset: bIdx * 0.33,
        });
      }
    });
  });

  return { root, pulses };
}
