import * as THREE from "three";

export const UNDRIFT_PALETTE = {
  primaryOutline: 0xe5e5e5,
  secondaryOutline: 0x888888,
  mutedOutline: 0x555555,
  mainSurface: 0x0b0b0b,
  secondarySurface: 0x151515,
  surfaceHighlight: 0x252525,
  glowWhite: 0xffffff,
  gridLine: 0x1e1e1e,
  shadowColor: 0x000000,
  textHex: "#F0F0F0",
  subTextHex: "#9A9A9A",
} as const;

export interface SharedMaterials {
  mainSurface: THREE.MeshStandardMaterial;
  secondarySurface: THREE.MeshStandardMaterial;
  highlightSurface: THREE.MeshStandardMaterial;
  activeCodeSurface: THREE.MeshBasicMaterial;
  rimHighlight: THREE.MeshBasicMaterial;
  primaryLine: THREE.LineBasicMaterial;
  secondaryLine: THREE.LineBasicMaterial;
  mutedLine: THREE.LineBasicMaterial;
  conduitTube: THREE.MeshStandardMaterial;
  evidenceTube: THREE.MeshBasicMaterial;
  pulseNode: THREE.MeshBasicMaterial;
}

export function createSharedMaterials(): SharedMaterials {
  return {
    mainSurface: new THREE.MeshStandardMaterial({
      color: UNDRIFT_PALETTE.mainSurface,
      roughness: 0.75,
      metalness: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    secondarySurface: new THREE.MeshStandardMaterial({
      color: UNDRIFT_PALETTE.secondarySurface,
      roughness: 0.65,
      metalness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    highlightSurface: new THREE.MeshStandardMaterial({
      color: UNDRIFT_PALETTE.surfaceHighlight,
      roughness: 0.5,
      metalness: 0.25,
    }),
    activeCodeSurface: new THREE.MeshBasicMaterial({
      color: UNDRIFT_PALETTE.glowWhite,
      transparent: true,
      opacity: 0.92,
    }),
    rimHighlight: new THREE.MeshBasicMaterial({
      color: UNDRIFT_PALETTE.primaryOutline,
    }),
    primaryLine: new THREE.LineBasicMaterial({
      color: UNDRIFT_PALETTE.primaryOutline,
      transparent: true,
      opacity: 0.92,
    }),
    secondaryLine: new THREE.LineBasicMaterial({
      color: UNDRIFT_PALETTE.secondaryOutline,
      transparent: true,
      opacity: 0.72,
    }),
    mutedLine: new THREE.LineBasicMaterial({
      color: UNDRIFT_PALETTE.mutedOutline,
      transparent: true,
      opacity: 0.48,
    }),
    conduitTube: new THREE.MeshStandardMaterial({
      color: UNDRIFT_PALETTE.primaryOutline,
      roughness: 0.35,
      metalness: 0.1,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
    }),
    evidenceTube: new THREE.MeshBasicMaterial({
      color: UNDRIFT_PALETTE.glowWhite,
      transparent: true,
      opacity: 0.95,
    }),
    pulseNode: new THREE.MeshBasicMaterial({
      color: UNDRIFT_PALETTE.glowWhite,
    }),
  };
}
