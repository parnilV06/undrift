import * as THREE from "three";
import { SharedMaterials, UNDRIFT_PALETTE } from "./palette";

export interface AnimatedPulseConduit {
  curve: THREE.CurvePath<THREE.Vector3>;
  pulseMesh: THREE.Mesh;
  speed: number;
  offset: number;
}

export interface VSCodeConnectorsHandles {
  root: THREE.Group;
  leftPulses: AnimatedPulseConduit[];
  evidenceCurve: THREE.CurvePath<THREE.Vector3>;
  evidenceTubeMesh: THREE.Mesh;
  evidencePulseNode: THREE.Mesh;
  rightCalloutAnchor: THREE.Object3D;
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

    const cornerEntry = pCurr.clone().sub(vIn.normalize().multiplyScalar(r));
    const cornerExit = pCurr.clone().add(vOut.normalize().multiplyScalar(r));

    path.add(new THREE.LineCurve3(currentStart, cornerEntry));
    path.add(new THREE.QuadraticBezierCurve3(cornerEntry, pCurr, cornerExit));
    currentStart = cornerExit;
  }

  path.add(new THREE.LineCurve3(currentStart, waypoints[waypoints.length - 1]));
  return path;
}

export function buildVSCodeConnectors(
  materials: SharedMaterials
): VSCodeConnectorsHandles {
  const root = new THREE.Group();
  const leftPulses: AnimatedPulseConduit[] = [];
  const pulseGeo = new THREE.SphereGeometry(0.044, 12, 12);
  const junctionGeo = new THREE.SphereGeometry(0.048, 12, 12);

  // 1. Left-to-Editor Conduits: Twin curved white paths linking "Your Code" stack to the VS Code editor
  const pairOffsets = [-0.07, 0.07];
  pairOffsets.forEach((d, idx) => {
    const waypoints = [
      new THREE.Vector3(-2.95, -0.96, 1.32 + d),
      new THREE.Vector3(-2.15, -0.96, 1.32 + d),
      new THREE.Vector3(-1.75 + d, -0.96, 0.55 + d),
      new THREE.Vector3(-1.25, -0.96, 0.55 + d),
    ];
    const curve = createRoundedPath(waypoints, 0.24);
    const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.015, 8, false);
    root.add(new THREE.Mesh(tubeGeo, materials.conduitTube));

    // Mid-path junction node matching the reference illustration
    const midNode = new THREE.Mesh(junctionGeo, materials.pulseNode);
    midNode.position.copy(curve.getPointAt(0.35 + idx * 0.12));
    root.add(midNode);

    const pulseMesh = new THREE.Mesh(pulseGeo, materials.pulseNode);
    root.add(pulseMesh);
    leftPulses.push({
      curve,
      pulseMesh,
      speed: 0.22,
      offset: idx * 0.45,
    });
  });

  // 2. Source Evidence Connector: Links Finding 01 on the UNDRIFT Findings Panel
  // directly to the highlighted source-code location inside the VS Code Editor!
  const evidenceWaypoints = [
    new THREE.Vector3(-0.18, 0.08, 0.96),  // Origin at Finding 01 row
    new THREE.Vector3(-0.18, 0.58, 0.96),  // Rise above findings header
    new THREE.Vector3(-0.18, 0.92, 0.25),  // Bridge toward editor code plane
    new THREE.Vector3(-0.12, 0.92, -0.24), // Terminate at highlighted source-code line
  ];
  const evidenceCurve = createRoundedPath(evidenceWaypoints, 0.18);
  const evidenceTubeGeo = new THREE.TubeGeometry(
    evidenceCurve,
    48,
    0.017,
    8,
    false
  );
  const evidenceTubeMesh = new THREE.Mesh(
    evidenceTubeGeo,
    materials.evidenceTube
  );
  root.add(evidenceTubeMesh);

  // Subtle dashed guide shadow along the same evidence path so the connection remains visible at all times
  const guidePts = evidenceCurve.getPoints(40);
  const guideLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(guidePts),
    new THREE.LineDashedMaterial({
      color: UNDRIFT_PALETTE.secondaryOutline,
      dashSize: 0.06,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.65,
    })
  );
  guideLine.computeLineDistances();
  root.add(guideLine);

  const evidencePulseNode = new THREE.Mesh(
    new THREE.SphereGeometry(0.052, 14, 14),
    materials.pulseNode
  );
  root.add(evidencePulseNode);

  // 3. Right Capability Callout Stepped Dashed Leader (matching right side of reference)
  const rightLeaderPts = [
    new THREE.Vector3(2.22, -0.25, -0.35),
    new THREE.Vector3(2.75, -0.25, -0.35),
    new THREE.Vector3(2.75, 0.36, -0.35),
    new THREE.Vector3(3.25, 0.36, -0.35),
  ];
  const rightLeaderGeo = new THREE.BufferGeometry().setFromPoints(
    rightLeaderPts
  );
  const rightLeaderMat = new THREE.LineDashedMaterial({
    color: UNDRIFT_PALETTE.primaryOutline,
    dashSize: 0.07,
    gapSize: 0.05,
    transparent: true,
    opacity: 0.8,
  });
  const rightLeaderLine = new THREE.Line(rightLeaderGeo, rightLeaderMat);
  rightLeaderLine.computeLineDistances();
  root.add(rightLeaderLine);

  const rightDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 12),
    materials.pulseNode
  );
  rightDot.position.set(3.22, 0.36, -0.35);
  root.add(rightDot);

  const rightCalloutAnchor = new THREE.Object3D();
  rightCalloutAnchor.position.set(3.32, 0.36, -0.35);
  root.add(rightCalloutAnchor);

  return {
    root,
    leftPulses,
    evidenceCurve,
    evidenceTubeMesh,
    evidencePulseNode,
    rightCalloutAnchor,
  };
}
