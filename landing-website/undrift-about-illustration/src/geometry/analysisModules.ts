import * as THREE from "three";
import { SharedMaterials, UNDRIFT_PALETTE } from "./palette";
import { createRoundedPlatform } from "./primitives";

export interface ModuleItemHandle {
  id: "routes" | "methods" | "shapes";
  title: string;
  subtitle: string;
  group: THREE.Group;
  floatingTop: THREE.Group;
  labelAnchor: THREE.Object3D;
}

function createRoutesIcon(materials: SharedMaterials): THREE.Group {
  const icon = new THREE.Group();
  const nodeGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.04, 20);

  const pApex = new THREE.Vector3(-0.08, 0.02, -0.14);
  const pLeft = new THREE.Vector3(-0.22, 0.02, 0.14);
  const pRight = new THREE.Vector3(0.2, 0.02, 0.1);

  [pApex, pLeft, pRight].forEach((pos) => {
    const node = new THREE.Mesh(nodeGeo, materials.rimHighlight);
    node.position.copy(pos);
    icon.add(node);
  });

  const branch1 = new THREE.LineCurve3(pApex, pLeft);
  const branch2 = new THREE.LineCurve3(pApex, pRight);
  [branch1, branch2].forEach((curve) => {
    const tube = new THREE.TubeGeometry(curve, 8, 0.024, 8, false);
    icon.add(new THREE.Mesh(tube, materials.rimHighlight));
  });

  return icon;
}

function createHttpMethodsIcon(materials: SharedMaterials): THREE.Group {
  const icon = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0.06, 0.28);
  shape.lineTo(-0.2, 0.02);
  shape.lineTo(-0.02, 0.02);
  shape.lineTo(-0.08, -0.28);
  shape.lineTo(0.2, -0.02);
  shape.lineTo(0.02, -0.02);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 4);

  const mesh = new THREE.Mesh(geo, materials.rimHighlight);
  mesh.position.y = 0.01;
  icon.add(mesh);
  return icon;
}

function createShapesIcon(materials: SharedMaterials): THREE.Group {
  const icon = new THREE.Group();
  const s = 0.22;

  for (let i = 0; i < 3; i++) {
    const y = 0.02 + i * 0.055;
    const pts = [
      new THREE.Vector3(0, y, -s),
      new THREE.Vector3(s, y, 0),
      new THREE.Vector3(0, y, s),
      new THREE.Vector3(-s, y, 0),
    ];

    if (i === 2) {
      const topShape = new THREE.Shape();
      topShape.moveTo(0, -s);
      topShape.lineTo(s, 0);
      topShape.lineTo(0, s);
      topShape.lineTo(-s, 0);
      topShape.closePath();

      const hole = new THREE.Path();
      const hs = s * 0.52;
      hole.moveTo(0, -hs);
      hole.lineTo(hs, 0);
      hole.lineTo(0, hs);
      hole.lineTo(-hs, 0);
      hole.closePath();
      topShape.holes.push(hole);

      const ext = new THREE.ExtrudeGeometry(topShape, {
        depth: 0.025,
        bevelEnabled: false,
      });
      ext.rotateX(-Math.PI / 2);
      const topMesh = new THREE.Mesh(ext, materials.rimHighlight);
      topMesh.position.y = y;
      icon.add(topMesh);
    } else {
      const loopGeo = new THREE.BufferGeometry().setFromPoints(pts);
      icon.add(new THREE.LineLoop(loopGeo, materials.primaryLine));
    }
  }

  return icon;
}

export function buildAnalysisModules(
  materials: SharedMaterials
): ModuleItemHandle[] {
  const specs: Array<{
    id: "routes" | "methods" | "shapes";
    title: string;
    subtitle: string;
    position: THREE.Vector3;
    iconBuilder: (m: SharedMaterials) => THREE.Group;
  }> = [
    {
      id: "routes",
      title: "Routes / Endpoints",
      subtitle: "/api/users, /api/orders",
      position: new THREE.Vector3(3.45, 0.85, -1.85),
      iconBuilder: createRoutesIcon,
    },
    {
      id: "methods",
      title: "HTTP Methods",
      subtitle: "GET, POST, PUT, DELETE",
      position: new THREE.Vector3(3.45, -0.05, 0.0),
      iconBuilder: createHttpMethodsIcon,
    },
    {
      id: "shapes",
      title: "Request / Response Shapes",
      subtitle: "JSON, schemas, types",
      position: new THREE.Vector3(3.45, -0.95, 1.85),
      iconBuilder: createShapesIcon,
    },
  ];

  return specs.map((spec) => {
    const group = new THREE.Group();
    group.position.copy(spec.position);

    const lowerPlate = createRoundedPlatform(
      1.48,
      1.48,
      0.11,
      0.18,
      materials.secondarySurface,
      materials.primaryLine
    );
    lowerPlate.position.y = -0.32;
    group.add(lowerPlate);

    const floatingTop = new THREE.Group();
    const upperBlock = createRoundedPlatform(
      1.18,
      1.18,
      0.32,
      0.16,
      materials.mainSurface,
      materials.primaryLine
    );
    upperBlock.position.y = -0.18;
    floatingTop.add(upperBlock);

    const icon = spec.iconBuilder(materials);
    icon.position.y = 0.16;
    floatingTop.add(icon);

    group.add(floatingTop);

    const leaderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.75, 0.05, -0.25),
      new THREE.Vector3(1.22, 0.05, -0.55),
    ]);
    const dashedMat = new THREE.LineDashedMaterial({
      color: UNDRIFT_PALETTE.primaryOutline,
      dashSize: 0.06,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.75,
    });
    const leaderLine = new THREE.Line(leaderGeo, dashedMat);
    leaderLine.computeLineDistances();
    group.add(leaderLine);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 10, 10),
      materials.pulseNode
    );
    dot.position.set(1.12, 0.05, -0.48);
    group.add(dot);

    const labelAnchor = new THREE.Object3D();
    labelAnchor.position.set(1.32, 0.05, -0.62);
    group.add(labelAnchor);

    return {
      id: spec.id,
      title: spec.title,
      subtitle: spec.subtitle,
      group,
      floatingTop,
      labelAnchor,
    };
  });
}
