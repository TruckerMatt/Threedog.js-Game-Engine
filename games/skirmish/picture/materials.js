// @ts-check
// skirmish materials by name: other code asks for picture.materials.<name> and never builds its own, so a surface changes in this one place.
// Node materials take the same options as the plain ones. A shader here is TSL on a material's fields (colorNode, positionNode, emissiveNode...), recipe 56:
// import { color, positionWorld, sin } from 'three/tsl'; material.colorNode = color(0x88aa66).mul(sin(positionWorld.y).mul(0.1).add(0.9));
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { palette } from './palette.js';

export function createMaterials() {
  return { default: new MeshStandardNodeMaterial(palette.material) };
}
