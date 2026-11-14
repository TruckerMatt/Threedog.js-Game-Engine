// The two sim views the rts module draws between: `prev` (before the last tick that ran) and `cur` (after it). sim.view() builds fresh typed arrays
// each call, so keeping the old one is free; units are matched by id (both views are sorted by id), and `link[i]` is the row of cur's unit i in prev (-1 = new).

/** Row of an entity id in a view (ids ascend), or -1 */
export function rowOf(view, id) {
  const ids = view.id;
  let lo = 0, hi = view.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, v = ids[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

export class ViewPair {
  /** @param {any} sim */
  constructor(sim) {
    this.sim = sim;
    this.cur = sim.view();
    this.prev = this.cur;
    this.link = this._link();
  }

  /** Take the sim's state as the new current view; the old one becomes prev */
  advance() {
    this.prev = this.cur;
    this.cur = this.sim.view();
    this.link = this._link();
  }

  /** @private merge walk over two id-sorted lists */
  _link() {
    const { prev, cur } = this, link = new Int32Array(cur.n);
    for (let i = 0, j = 0; i < cur.n; i++) {
      const id = cur.id[i];
      while (j < prev.n && prev.id[j] < id) j++;
      link[i] = j < prev.n && prev.id[j] === id ? j : -1;
    }
    return link;
  }

  /** Interpolated x, z, y (meters) and facing (0..65535, shortest way round) of cur row i, a of the way from prev: written into out */
  at(i, a, out) {
    const { prev, cur } = this, j = this.link[i];
    if (j < 0) { out.x = cur.x[i]; out.y = cur.y[i]; out.z = cur.z[i]; out.facing = cur.facing[i]; return out; }
    out.x = prev.x[j] + (cur.x[i] - prev.x[j]) * a;
    out.y = prev.y[j] + (cur.y[i] - prev.y[j]) * a;
    out.z = prev.z[j] + (cur.z[i] - prev.z[j]) * a;
    const f0 = prev.facing[j], d = ((cur.facing[i] - f0 + 32768) & 65535) - 32768;
    out.facing = f0 + d * a;
    return out;
  }
}
