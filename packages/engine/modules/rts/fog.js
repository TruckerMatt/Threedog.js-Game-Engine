// Fog of war for the local team: a ground-hugging overlay with a per-vertex alpha, and the raw fog as a DataTexture games can shade terrain with.
// Both follow sim.vision.teams[team].sum: nothing is rebuilt while the team sees the same cells.
import * as THREE from 'three';
import { neutralMaterial } from '../../render/neutral.js';
import { engineOwned } from '../../core/scene/things.js';
import { toFloat } from '@threedog/rts/fixed';

const LIFT = 0.3;            // meters above the highest ground under a vertex: a ridge between two vertices must not poke through
const ALPHA = { unseen: 0.85, explored: 0.5, visible: 0 };

export class Fog {
  /**
   * @param {any} e engine
   * @param {any} sim a sim with the vision system
   * @param {number} team the local team
   * @param {{ overlay: boolean }} o
   */
  constructor(e, sim, team, o) {
    this.e = e; this.sim = sim; this.team = team;
    const V = sim.vision, g = V.grid(team);
    this.grid = g;
    this.sum = null;
    const { cols, rows } = g;
    /** { value } holders for a game's own terrain shader: uRtsFog is cols x rows, r = visible now, g = explored (0 or 255); uRtsFogBounds is (originX, originZ, width, depth) in meters */
    this.uniforms = {
      uRtsFog: { value: null },
      uRtsFogBounds: { value: new THREE.Vector4(g.originX, g.originZ, cols * g.cell, rows * g.cell) },
    };
    this.data = new Uint8Array(cols * rows * 2);
    const tex = new THREE.DataTexture(this.data, cols, rows, THREE.RGFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
    this.uniforms.uRtsFog.value = tex;
    this.mesh = null;
    /** The overlay's material (neutral dark; plain three.js, restyle it or replace the mesh's material) @type {THREE.Material | null} */
    this.material = null;
    if (o.overlay) this._build();
    this.update();
  }

  _build() {
    const { cols, rows, cell, originX, originZ } = this.grid, V = this.sim.vision, nx = cols + 1, nz = rows + 1;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 4);
    // a corner takes the highest ground of the (up to four) vision cells that touch it
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let h = -Infinity;
      for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
        const cx = x + dx, cz = z + dz;
        if (cx >= 0 && cz >= 0 && cx < cols && cz < rows) h = Math.max(h, toFloat(V.height[cz * cols + cx]));
      }
      const i = (z * nx + x) * 3;
      pos[i] = originX + x * cell; pos[i + 1] = h + LIFT; pos[i + 2] = originZ + z * cell;
    }
    const idx = new Uint32Array(cols * rows * 6);
    for (let z = 0, k = 0; z < rows; z++) for (let x = 0; x < cols; x++, k += 6) {
      const a = z * nx + x, b = a + 1, c = a + nx, d = c + 1;
      idx.set([a, c, b, b, c, d], k);   // counter-clockwise seen from above (+y)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    // black diffuse and a gray glow: the overlay is the same dark gray under any light; the vertex alpha does the fading
    this.material = neutralMaterial('rts-fog', { vertexColors: true, color: 0x000000, emissive: 0x181818, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'rts:fog';
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.e.scene.add(engineOwned('rts', this.mesh));
  }

  /** Copy the team's grid into the texture and the vertex alphas when the team sees other cells than last time */
  update() {
    const g = this.grid, sum = this.sim.vision.teams[this.team].sum;
    if (sum === this.sum) return false;
    this.sum = sum;
    const { cols, rows } = g, vis = g.visible, exp = g.explored, d = this.data;
    for (let i = 0; i < cols * rows; i++) { d[i * 2] = vis[i] ? 255 : 0; d[i * 2 + 1] = exp[i] ? 255 : 0; }
    this.texture.needsUpdate = true;
    if (this.mesh) {
      const nx = cols + 1, nz = rows + 1, a = this.mesh.geometry.attributes.color.array;
      const alphaOf = (x, z) => {
        if (x < 0 || z < 0 || x >= cols || z >= rows) return 1;
        const i = z * cols + x;
        return vis[i] ? ALPHA.visible : exp[i] ? ALPHA.explored : ALPHA.unseen;
      };
      // a corner takes the clearest of the cells around it: a cell the team sees is clear all over, and the fade lies in the cells next to it
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        a[(z * nx + x) * 4 + 3] = Math.min(alphaOf(x - 1, z - 1), alphaOf(x, z - 1), alphaOf(x - 1, z), alphaOf(x, z));
      }
      this.mesh.geometry.attributes.color.needsUpdate = true;
    }
    return true;
  }

  dispose() {
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
    this.texture.dispose();
  }
}
