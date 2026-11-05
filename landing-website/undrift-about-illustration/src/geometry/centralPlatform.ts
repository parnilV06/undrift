import * as THREE from "three";
import { SharedMaterials } from "./palette";
import { createRoundedPlatform, createVerticalLeader } from "./primitives";
import { UNDRIFT_LOGO_DATA_URI } from "../assets/undriftLogoDataUri";

export interface CentralPlatformHandles {
  root: THREE.Group;
  floatingCore: THREE.Group;
  logoMesh: THREE.Mesh;
  highlightSweep: THREE.Mesh;
  calloutAnchor: THREE.Object3D;
}

/**
 * Loads the official UNDRIFT.svg asset (embedded directly via UNDRIFT_LOGO_DATA_URI
 * or custom svgUrl) onto a high-resolution anisotropic CanvasTexture so its exact
 * silhouette, multi-groove U-turn arrow, and particle-dissolve tail are preserved verbatim.
 */
export function createOfficialUndriftLogoTexture(
  svgUrl?: string
): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  // Render immediate high-precision vector fallback on frame 0 before Image onload completes
  drawExactUndriftFallback(ctx, size);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    texture.needsUpdate = true;
  };
  img.src = svgUrl || UNDRIFT_LOGO_DATA_URI;

  return texture;
}

function drawExactUndriftFallback(
  ctx: CanvasRenderingContext2D,
  size: number
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  const scale = size / 390;
  ctx.scale(scale, scale);
  ctx.translate(0, 12);

  const cx = 232;
  const cy = 193;
  const radii = [108, 92, 76];
  const widths = [12, 11, 12];

  ctx.strokeStyle = "#F5F5F5";
  ctx.fillStyle = "#F5F5F5";
  ctx.lineCap = "round";

  radii.forEach((r, idx) => {
    ctx.lineWidth = widths[idx];
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(138, cy - r);
    ctx.lineTo(cx, cy - r);
    ctx.stroke();

    const startX = 148 + idx * 8;
    ctx.beginPath();
    ctx.moveTo(startX, cy + r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(54, 112);
  ctx.lineTo(144, 46);
  ctx.quadraticCurveTo(152, 48, 148, 60);
  ctx.lineTo(142, 166);
  ctx.quadraticCurveTo(146, 178, 134, 176);
  ctx.closePath();
  ctx.fill();

  const seedParticles = [
    [138, 268, 4.2], [131, 276, 3.8], [124, 285, 3.5], [142, 286, 4.5],
    [134, 294, 4.0], [126, 302, 3.2], [118, 272, 2.8], [112, 284, 3.1],
    [105, 295, 2.5], [146, 303, 4.2], [136, 308, 3.4], [122, 310, 2.6],
    [98, 279, 2.1],  [92, 291, 1.9],  [86, 268, 1.8],  [108, 263, 2.4],
    [115, 298, 2.9], [101, 306, 2.0], [78, 285, 1.5],  [84, 301, 1.6],
  ];
  seedParticles.forEach(([px, py, pr]) => {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

export function buildCentralPlatform(
  materials: SharedMaterials,
  svgUrl?: string
): CentralPlatformHandles {
  const root = new THREE.Group();
  root.position.set(0, 0, 0);

  // 1. Lower stationary base plate
  const basePlate = createRoundedPlatform(
    2.45,
    2.45,
    0.16,
    0.28,
    materials.secondarySurface,
    materials.primaryLine
  );
  basePlate.position.y = -0.68;
  root.add(basePlate);

  // Middle cushion plate
  const glowCushion = createRoundedPlatform(
    2.18,
    2.18,
    0.09,
    0.22,
    materials.highlightSurface,
    materials.primaryLine
  );
  glowCushion.position.y = -0.49;
  root.add(glowCushion);

  // 2. Upper floating analysis block
  const floatingCore = new THREE.Group();
  const mainBlock = createRoundedPlatform(
    2.12,
    2.12,
    0.46,
    0.24,
    materials.mainSurface,
    materials.primaryLine
  );
  mainBlock.position.y = -0.36;
  floatingCore.add(mainBlock);

  // 3. Official UNDRIFT logo embossed on the upper surface
  const logoTexture = createOfficialUndriftLogoTexture(svgUrl);
  const logoMat = new THREE.MeshBasicMaterial({
    map: logoTexture,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
  });

  const logoGeo = new THREE.PlaneGeometry(1.42, 1.42);
  logoGeo.rotateX(-Math.PI / 2);
  logoGeo.rotateY(Math.PI / 4);

  const logoMesh = new THREE.Mesh(logoGeo, logoMat);
  logoMesh.position.set(0, 0.122, 0);
  floatingCore.add(logoMesh);

  // Subtle lower relief shadow copy for embossed depth
  const reliefMat = new THREE.MeshBasicMaterial({
    map: logoTexture,
    color: 0x666666,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const reliefMesh = new THREE.Mesh(logoGeo, reliefMat);
  reliefMesh.position.set(0.015, 0.108, 0.015);
  floatingCore.add(reliefMesh);

  // 4. Subtle animated surface highlight sweep bar
  const sweepGeo = new THREE.PlaneGeometry(1.85, 0.18);
  sweepGeo.rotateX(-Math.PI / 2);
  const sweepMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const highlightSweep = new THREE.Mesh(sweepGeo, sweepMat);
  highlightSweep.position.set(0, 0.125, 0);
  floatingCore.add(highlightSweep);

  root.add(floatingCore);

  // 5. Vertical dashed leader line rising from the platform
  const leader = createVerticalLeader(1.12, materials);
  leader.position.set(0, 0.18, -0.55);
  root.add(leader);

  const calloutAnchor = new THREE.Object3D();
  calloutAnchor.position.set(0, 1.55, -0.55);
  root.add(calloutAnchor);

  return {
    root,
    floatingCore,
    logoMesh,
    highlightSweep,
    calloutAnchor,
  };
}
