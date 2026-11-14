// Selection rings under selected units and health bars over selected or hurt ones. Neutral gray; the game restyles through the materials the module hands out.
import * as THREE from 'three';
import { neutralMaterial } from '../../render/neutral.js';
import { InstancePool, putYaw } from './pool.js';
import { toFloat } from '@threedog/rts/fixed';

const _at = { x: 0, y: 0, z: 0, facing: 0 };
const BAR_H = 0.22;

/** An unlit-looking neutral material: black diffuse and a gray glow, so scene lights (or none) do not change it */
const glow = (what, gray, extra = {}) => neutralMaterial(what, { color: 0x000000, emissive: gray, ...extra });

export class Marks {
  /** @param {any} e engine @param {any} sim */
  constructor(e, sim) {
    this.e = e; this.sim = sim;
    /** The ring under a selected unit (plain material: swap its color, map or the whole material) @type {THREE.Material} */
    this.ringMaterial = glow('rts-ring', 0xd0d0d0, { side: THREE.DoubleSide, transparent: true, depthWrite: false });
    /** The filled part of a health bar @type {THREE.Material} */
    this.barMaterial = glow('rts-bar', 0xc8c8c8, { side: THREE.DoubleSide, depthWrite: false });
    /** The empty part behind it @type {THREE.Material} */
    this.barBackMaterial = glow('rts-bar-back', 0x303030, { side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2), quad = new THREE.PlaneGeometry(1, 1);
    this.rings = new InstancePool(e, 'rts:rings', ring, this.ringMaterial, { ownsGeometry: true });
    this.backs = new InstancePool(e, 'rts:bars-back', quad, this.barBackMaterial);
    this.fills = new InstancePool(e, 'rts:bars', quad, this.barMaterial);
    this.backs.mesh.renderOrder = 1; this.fills.mesh.renderOrder = 2;
    this.quad = quad;
  }

  /**
   * @param {import('./views.js').ViewPair} pair
   * @param {number} a interpolation
   * @param {Set<number>} selected entity ids
   * @param {Uint8Array} visible rows of pair.cur the local team sees
   * @param {THREE.Camera} cam bars face it
   */
  draw(pair, a, selected, visible, cam) {
    const cur = pair.cur, { content } = this.sim;
    this.rings.ensure(selected.size); this.backs.ensure(cur.n); this.fills.ensure(cur.n);
    let nr = 0, nb = 0;
    const e = cam.matrixWorld.elements;   // columns 0..2: the camera's right, up, back
    for (let i = 0; i < cur.n; i++) {
      if (!visible[i]) continue;
      const sel = selected.has(cur.id[i]), hurt = cur.hp[i] < 1000;
      if (!sel && !hurt) continue;
      const at = pair.at(i, a, _at), r = toFloat(content.kinds[cur.kind[i]].radius);
      if (sel) putYaw(this.rings.m, nr++, at.x, at.y + 0.12, at.z, 0, r * 1.3, 1, r * 1.3);
      const w = Math.max(1, r * 2), f = Math.max(0, Math.min(1, cur.hp[i] / 1000)), fw = Math.max(0.001, w * f);
      const cy = at.y + r * 2 + 0.6;
      bar(this.backs.m, nb, e, at.x, cy, at.z, w, BAR_H);
      bar(this.fills.m, nb, e, at.x - (w - fw) / 2 * e[0], cy - (w - fw) / 2 * e[1], at.z - (w - fw) / 2 * e[2], fw, BAR_H * 0.7);
      nb++;
    }
    this.rings.finish(nr); this.backs.finish(nb); this.fills.finish(nb);
  }

  dispose() {
    this.rings.dispose(); this.backs.dispose(); this.fills.dispose(); this.quad.dispose();
    this.ringMaterial.dispose(); this.barMaterial.dispose(); this.barBackMaterial.dispose();
  }
}

/** A quad facing the camera: its x axis is the camera's right, its y axis the camera's up */
function bar(m, r, e, x, y, z, w, h) {
  const o = r * 16;
  m[o] = e[0] * w; m[o + 1] = e[1] * w; m[o + 2] = e[2] * w; m[o + 3] = 0;
  m[o + 4] = e[4] * h; m[o + 5] = e[5] * h; m[o + 6] = e[6] * h; m[o + 7] = 0;
  m[o + 8] = e[8]; m[o + 9] = e[9]; m[o + 10] = e[10]; m[o + 11] = 0;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}
