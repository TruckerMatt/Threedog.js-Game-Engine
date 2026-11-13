// Spatial buckets: which entities stand near a point. Rebuilt once per tick (after commands, before movement), in id order, so a query
// visits entities in the same order on every machine. Bucket size is 8 cells.
//   sim.spatial.near(x, z, r, e => { ... })     every alive entity whose center is within r (fixed) of (x, z), in a fixed order
import { len2 } from './fixed.js';

const BUCKET_CELLS = 8;

export function spatialSystem() {
  return {
    name: 'spatial',
    init(sim) {
      const m = sim.map, bc = Math.ceil(m.cols / BUCKET_CELLS), br = Math.ceil(m.rows / BUCKET_CELLS);
      const S = sim.spatial = { bc, br, size: m.cell * BUCKET_CELLS, head: new Int32Array(bc * br), next: new Int32Array(0), list: [] };
      S.rebuild = () => {
        const list = S.list = sim.entities;
        if (S.next.length < list.length) S.next = new Int32Array(Math.max(64, list.length * 2));
        S.head.fill(-1);
        // walk backwards so each bucket's chain is in ascending id order
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (e.dead) continue;
          const b = S.bucketOf(e.x, e.z);
          S.next[i] = S.head[b]; S.head[b] = i;
        }
      };
      S.bucketOf = (x, z) => Math.floor(m.cellZ(z) / BUCKET_CELLS) * bc + Math.floor(m.cellX(x) / BUCKET_CELLS);
      /** Call fn(e) for every alive entity within r of (x, z), ascending id within each bucket, buckets row by row */
      S.near = (x, z, r, fn) => {
        const x0 = Math.floor(m.cellX(x - r) / BUCKET_CELLS), x1 = Math.floor(m.cellX(x + r) / BUCKET_CELLS);
        const z0 = Math.floor(m.cellZ(z - r) / BUCKET_CELLS), z1 = Math.floor(m.cellZ(z + r) / BUCKET_CELLS);
        const r2 = len2(r, 0);
        for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
          for (let i = S.head[bz * bc + bx]; i !== -1; i = S.next[i]) {
            const e = S.list[i];
            if (!e.dead && len2(e.x - x, e.z - z) <= r2) fn(e);
          }
        }
      };
      S.rebuild();
    },
    step(sim) { sim.spatial.rebuild(); },
  };
}
