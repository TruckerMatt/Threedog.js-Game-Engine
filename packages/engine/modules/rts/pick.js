// Screen-space picking for the rts module: units are projected with the camera and compared in pixels. No raycast, no per-unit objects.
import * as THREE from 'three';
import { toFloat } from '@threedog/rts/fixed';

const _v = new THREE.Vector3(), _at = { x: 0, y: 0, z: 0, facing: 0 };

export class Picker {
  /** @param {any} e engine @param {import('./views.js').ViewPair} pair @param {any} sim */
  constructor(e, pair, sim) {
    this.e = e; this.pair = pair; this.kinds = sim.content.kinds;
    /** NDC of every row of pair.cur (x, y, then 1 when in front of the camera); rebuilt by project() */
    this.ndc = new Float32Array(0);
    this.w = 1; this.h = 1;
  }

  /** Project the center of every unit in the current view (interpolated like the drawing); call once per frame before picking */
  project(a) {
    const { pair, e } = this, cur = pair.cur, cam = e.camera, c = e.renderer.domElement, kinds = this.kinds;
    this.w = c.clientWidth || 1; this.h = c.clientHeight || 1;
    if (this.ndc.length < cur.n * 3) this.ndc = new Float32Array(Math.max(192, cur.n * 6));
    cam.updateMatrixWorld();
    for (let i = 0; i < cur.n; i++) {
      const at = pair.at(i, a, _at);
      _v.set(at.x, at.y + toFloat(kinds[cur.kind[i]].radius) * 0.8, at.z).applyMatrix4(cam.matrixWorldInverse);
      const front = _v.z < 0;
      _v.applyMatrix4(cam.projectionMatrix);
      this.ndc[i * 3] = _v.x; this.ndc[i * 3 + 1] = _v.y; this.ndc[i * 3 + 2] = front ? 1 : 0;
    }
  }

  /** Row of the unit nearest to the pointer within px pixels among the rows `want(i)` accepts, or -1 */
  nearest(ndcX, ndcY, px, want) {
    let best = -1, bd = px * px;
    for (let i = 0; i < this.pair.cur.n; i++) {
      if (!this.ndc[i * 3 + 2] || !want(i)) continue;
      const dx = (this.ndc[i * 3] - ndcX) * 0.5 * this.w, dy = (this.ndc[i * 3 + 1] - ndcY) * 0.5 * this.h, d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Rows whose projected center lies in the NDC rectangle and that `want(i)` accepts */
  inside(x0, y0, x1, y1, want) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1), bot = Math.min(y0, y1), top = Math.max(y0, y1), out = [];
    for (let i = 0; i < this.pair.cur.n; i++) {
      if (!this.ndc[i * 3 + 2] || !want(i)) continue;
      const x = this.ndc[i * 3], y = this.ndc[i * 3 + 1];
      if (x >= lo && x <= hi && y >= bot && y <= top) out.push(i);
    }
    return out;
  }
}
