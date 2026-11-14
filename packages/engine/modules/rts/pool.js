// One plain THREE.InstancedMesh that grows when it runs out of rows. Callers write `pool.m` (16 floats per row) and, with tint, `pool.c` (3 floats), then call finish(count).
import * as THREE from 'three';
import { engineOwned } from '../../core/scene/things.js';

export class InstancePool {
  /**
   * @param {any} e engine
   * @param {string} name mesh name in the scene
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {{ tint?: boolean, ownsGeometry?: boolean, ownsMaterial?: boolean }} [o] tint: per-row color; owns*: this pool disposes it (the game's own stay the game's)
   */
  constructor(e, name, geometry, material, o = {}) {
    Object.assign(this, { e, name, geometry, material, tint: !!o.tint, ownsGeometry: !!o.ownsGeometry, ownsMaterial: !!o.ownsMaterial });
    this.capacity = 0;
    this.mesh = null;
    this.ensure(32);
  }

  /** Room for n rows; a bigger mesh replaces the old one (same name, same place in the scene) */
  ensure(n) {
    if (n <= this.capacity) return;
    let cap = Math.max(32, this.capacity);
    while (cap < n) cap *= 2;
    const old = this.mesh, mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    mesh.name = this.name;
    mesh.count = 0;
    mesh.frustumCulled = false;   // rows move every frame; the bounds three computes once would hide units that walk off them
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    if (old) { mesh.castShadow = old.castShadow; mesh.receiveShadow = old.receiveShadow; mesh.renderOrder = old.renderOrder; mesh.layers.mask = old.layers.mask; mesh.visible = old.visible; old.removeFromParent(); old.dispose(); }
    this.e.scene.add(engineOwned('rts', mesh));
    this.mesh = mesh;
    this.capacity = cap;
    this.m = mesh.instanceMatrix.array;
    this.c = mesh.instanceColor?.array ?? null;
  }

  /** The first count rows are drawn, and uploaded */
  finish(count) {
    const mesh = this.mesh;
    mesh.count = count;
    if (!count) return;
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, count * 16); mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, count * 3); mesh.instanceColor.needsUpdate = true; }
  }

  /** Out of the scene; geometry and material only when this pool made them */
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    if (this.ownsGeometry) this.geometry.dispose();
    if (this.ownsMaterial) this.material.dispose();
  }
}

/** Write a matrix at row r of a Float32Array: yaw about Y (radians, three's rotation.y), scale sx sy sz, position */
export function putYaw(m, r, x, y, z, yaw, sx, sy, sz) {
  const o = r * 16, c = Math.cos(yaw), s = Math.sin(yaw);
  m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = s * sz; m[o + 9] = 0; m[o + 10] = c * sz; m[o + 11] = 0;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}
