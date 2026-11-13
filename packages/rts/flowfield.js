// Flow fields: one search from a goal cell gives every cell the direction toward it, so a whole group shares one path search.
// Dijkstra on the 8-connected grid with integer costs (10 straight, 14 diagonal) and a bucket queue: same field on every machine.
// Diagonal steps never cut a blocked corner. A blocked goal moves to the nearest open cell. Fields are cached by goal cell and the map's
// version (a placed building bumps map.version); the cache is derived data, never hashed or saved.
//   const f = flowField(sim, goalCell);   f.dir[cell]: 0..7 = step toward the goal, GOAL = this is the goal, NONE = cannot reach
//   f.cost[cell]: path cost from cell to goal (10 per straight cell)

export const GOAL = 8, NONE = 255;
/** Neighbor offsets: dx, dz, cost, in a fixed order */
export const DIRS = [[1, 0, 10], [0, 1, 10], [-1, 0, 10], [0, -1, 10], [1, 1, 14], [-1, 1, 14], [-1, -1, 14], [1, -1, 14]];
const CACHE_MAX = 48;

/** The flow field toward goal cell index `goal` (moved to the nearest open cell if blocked) */
export function flowField(sim, goal) {
  const m = sim.map, key = `${goal}:${m.version ?? 0}`;
  const cache = sim.flowCache ??= new Map();
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }   // most recent last
  const f = build(m, openCellNear(m, goal));
  cache.set(key, f);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return f;
}

/** The nearest unblocked cell to `cell` (itself when open), searching rings outward; -1 if the map has no open cell */
export function openCellNear(m, cell) {
  if (!m.block[cell]) return cell;
  const cx = cell % m.cols, cz = (cell / m.cols) | 0, maxR = Math.max(m.cols, m.rows);
  for (let r = 1; r < maxR; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = cx + dx, z = cz + dz;
      if (!m.isBlocked(x, z)) return z * m.cols + x;
    }
  }
  return -1;
}

function build(m, goal) {
  const n = m.cols * m.rows, cost = new Uint32Array(n).fill(0xffffffff), dir = new Uint8Array(n).fill(NONE);
  const f = { goal, cost, dir };
  if (goal < 0) return f;
  // bucket queue: costs grow by at most 14 per step, so 15 rotating buckets of cell lists are enough
  const B = 15, buckets = Array.from({ length: B }, () => []);
  cost[goal] = 0; dir[goal] = GOAL; buckets[0].push(goal);
  let cur = 0, pending = 1;
  while (pending > 0) {
    const bucket = buckets[cur % B];
    if (!bucket.length) { cur++; continue; }
    const c = bucket.pop(); pending--;
    if (cost[c] !== cur) continue;   // stale entry
    const cx = c % m.cols, cz = (c / m.cols) | 0;
    for (let d = 0; d < 8; d++) {
      const [dx, dz, w] = DIRS[d], x = cx + dx, z = cz + dz;
      if (m.isBlocked(x, z)) continue;
      if (dx && dz && (m.isBlocked(cx + dx, cz) || m.isBlocked(cx, cz + dz))) continue;   // no corner cutting
      const nc = z * m.cols + x, nv = cur + w;
      if (nv < cost[nc]) { cost[nc] = nv; dir[nc] = OPP[d]; buckets[nv % B].push(nc); pending++; }
    }
  }
  return f;
}

// the direction from the neighbor back to c
const OPP = [2, 3, 0, 1, 6, 7, 4, 5];
