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
/** New fields built per tick at most; a unit that needs one more this tick steers straight and asks again next tick */
export const BUILDS_PER_TICK = 3;

/**
 * The flow field toward goal cell index `goal` (moved to the nearest open cell if blocked); null when this tick's build budget is spent.
 * Because of that budget, which fields are cached changes how units move, so the cache is game state: units saves its goals (in order)
 * and rebuilds them after a load (rebuildFlowCache). A changed map (map.version) empties it.
 */
export function flowField(sim, goal, force = false) {
  const m = sim.map, cache = flowCacheOf(sim);
  const hit = cache.fields.get(goal);
  if (hit) { cache.fields.delete(goal); cache.fields.set(goal, hit); return hit; }   // most recent last
  if (sim.flowBuildTick !== sim.tick) { sim.flowBuildTick = sim.tick; sim.flowBuilds = 0; }
  if (!force && sim.flowBuilds >= BUILDS_PER_TICK) return null;
  if (!force) sim.flowBuilds++;
  const f = build(m, openCellNear(m, goal));
  cache.fields.set(goal, f);
  if (cache.fields.size > CACHE_MAX) cache.fields.delete(cache.fields.keys().next().value);
  return f;
}

/** The sim's field cache, emptied when the map changed */
export function flowCacheOf(sim) {
  const v = sim.map.version ?? 0;
  if (!sim.flowCache || sim.flowCache.version !== v) sim.flowCache = { version: v, fields: new Map() };
  return sim.flowCache;
}

/** After a load: rebuild the cached fields a snapshot listed, oldest first, without spending the tick budget */
export function rebuildFlowCache(sim, goals) {
  sim.flowCache = { version: sim.map.version ?? 0, fields: new Map() };
  for (const g of goals) flowField(sim, g, true);
}

/** true when no blocked cell lies on the straight line between two fixed points (cell walk; for short hops) */
export function clearLine(m, x0, z0, x1, z1) {
  let cx = m.cellX(x0), cz = m.cellZ(z0);
  const tx = m.cellX(x1), tz = m.cellZ(z1), n = Math.max(Math.abs(tx - cx), Math.abs(tz - cz));
  for (let i = 1; i <= n; i++) {
    const x = cx + Math.round(((tx - cx) * i) / n), z = cz + Math.round(((tz - cz) * i) / n);
    if (m.block[z * m.cols + x]) return false;
  }
  return true;
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
  const cols = m.cols, rows = m.rows, n = cols * rows, block = m.block;
  const cost = new Uint32Array(n).fill(0xffffffff), dir = new Uint8Array(n).fill(NONE);
  const f = { goal, cost, dir };
  if (goal < 0) return f;
  // Dial's bucket queue: costs grow by at most 14 per step, so 15 rotating buckets; each bucket is a linked list in typed arrays
  const B = 15, heap = new Int32Array(n * 2 + 64), bucketOf = new Int32Array(heap.length);
  const head = new Int32Array(B).fill(-1), next = new Int32Array(heap.length);
  let free = 0, pending = 0;
  const push = (c, v) => { const i = free++; heap[i] = c; bucketOf[i] = v; next[i] = head[v % B]; head[v % B] = i; pending++; };
  cost[goal] = 0; dir[goal] = GOAL; push(goal, 0);
  let cur = 0;
  while (pending > 0) {
    const b = cur % B;
    let i = head[b];
    if (i === -1) { cur++; continue; }
    head[b] = next[i]; pending--;
    const c = heap[i];
    if (cost[c] !== cur) continue;   // stale entry
    if (free > heap.length - 16) { free = compact(); }
    const cx = c % cols, cz = (c - cx) / cols;
    const xl = cx > 0, xr = cx < cols - 1, zd = cz > 0, zu = cz < rows - 1;
    const oR = xr && !block[c + 1], oL = xl && !block[c - 1], oU = zu && !block[c + cols], oD = zd && !block[c - cols];
    if (oR) relax(c + 1, cur + 10, 2);
    if (oU) relax(c + cols, cur + 10, 3);
    if (oL) relax(c - 1, cur + 10, 0);
    if (oD) relax(c - cols, cur + 10, 1);
    if (oR && oU && !block[c + cols + 1]) relax(c + cols + 1, cur + 14, 6);
    if (oL && oU && !block[c + cols - 1]) relax(c + cols - 1, cur + 14, 7);
    if (oL && oD && !block[c - cols - 1]) relax(c - cols - 1, cur + 14, 4);
    if (oR && oD && !block[c - cols + 1]) relax(c - cols + 1, cur + 14, 5);
  }
  return f;
  function relax(nc, nv, d) { if (nv < cost[nc]) { cost[nc] = nv; dir[nc] = d; push(nc, nv); } }
  // the entry pool ran low: rebuild the lists from the live entries only (stale ones dropped)
  function compact() {
    const keep = [];
    for (let k = 0; k < B; k++) for (let j = head[k]; j !== -1; j = next[j]) if (cost[heap[j]] === bucketOf[j]) keep.push(heap[j], bucketOf[j]);
    head.fill(-1); pending = 0; free = 0;
    for (let j = 0; j < keep.length; j += 2) push(keep[j], keep[j + 1]);
    return free;
  }
}

// the direction from the neighbor back to c
const OPP = [2, 3, 0, 1, 6, 7, 4, 5];
