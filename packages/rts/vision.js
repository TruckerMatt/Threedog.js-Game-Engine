// Fog of war: per team, which vision cells are seen now and which were ever seen. Terrain blocks sight: a cell is seen only when the line
// from the viewer's eye to that cell's ground passes above every height between them (World in Conflict-style high ground). Air units see
// and are seen without that test. The grid is recomputed every UPDATE ticks (staggering is not needed: one pass dedupes viewers that share
// a cell), saved in snapshots, and its checksum is hashed, so targeting, which only picks what the team sees, stays in sync.
//   sim.vision.visible(team, x, z)    true when team sees the fixed point now (always true for a team id of -1, an observer with full view)
//   sim.vision.explored(team, x, z)   true when team ever saw it
//   sim.vision.seen(team, e)          true when team sees entity e (its own team's entities count as seen)
//   sim.vision.grid(team)             { cols, rows, cell (meters), visible: Uint8Array, explored: Uint8Array } for drawing the fog
import { fx, ONE, len2 } from './fixed.js';

export const UPDATE = 5;          // ticks between recomputes (4 per second at 20 ticks)
const EYE = fx(2), TARGET = fx(1);

/** @param {{ cellsPerVision?: number }} [o] vision cell size in map cells (default 4: 8 m on a 2 m map) */
export function visionSystem(o = {}) {
  const per = o.cellsPerVision ?? 4;
  return {
    name: 'vision',
    init(sim) {
      const m = sim.map, cols = Math.ceil(m.cols / per), rows = Math.ceil(m.rows / per), n = cols * rows;
      // each vision cell's height: the highest map cell inside it (a ridge blocks sight across the whole vision cell)
      const height = new Int32Array(n).fill(-0x7fffffff);
      for (let cz = 0; cz < m.rows; cz++) for (let cx = 0; cx < m.cols; cx++) {
        const v = ((cz / per) | 0) * cols + ((cx / per) | 0), h = m.height[cz * m.cols + cx];
        if (h > height[v]) height[v] = h;
      }
      const teams = {};
      for (const t of sim.teams) teams[t] = { visible: new Uint8Array(n), explored: new Uint8Array(n), sum: 0 };
      const size = m.cell * per;
      const V = sim.vision = { cols, rows, per, size, height, teams };
      V.cellOf = (x, z) => Math.min(rows - 1, Math.max(0, Math.floor((z - m.originZ) / size))) * cols
        + Math.min(cols - 1, Math.max(0, Math.floor((x - m.originX) / size)));
      V.visible = (team, x, z) => team === -1 || !!teams[team]?.visible[V.cellOf(x, z)];
      V.explored = (team, x, z) => team === -1 || !!teams[team]?.explored[V.cellOf(x, z)];
      V.seen = (team, e) => team === -1 || sim.teamOf(e) === team || V.visible(team, e.x, e.z);
      V.grid = team => ({ cols, rows, cell: (size / ONE), originX: m.originX / ONE, originZ: m.originZ / ONE,
        visible: teams[team]?.visible, explored: teams[team]?.explored });
      update(sim);
    },
    step(sim) { if (sim.tick % UPDATE === 0) update(sim); },
    hash(sim, h) { for (const t of sim.teams) h.int(sim.vision.teams[t].sum); },
    save(sim) { return Object.fromEntries(sim.teams.map(t => { const g = sim.vision.teams[t]; return [t, { v: pack(g.visible), e: pack(g.explored), sum: g.sum }]; })); },
    load(sim, d) { for (const t of sim.teams) { const g = sim.vision.teams[t]; unpack(d[t].v, g.visible); unpack(d[t].e, g.explored); g.sum = d[t].sum; } },
    describe(sim) {
      return Object.fromEntries(sim.teams.map(t => { const g = sim.vision.teams[t]; let v = 0, e = 0; for (let i = 0; i < g.visible.length; i++) { v += g.visible[i]; e += g.explored[i]; }
        return [`team${t}`, { seenPct: Math.round(100 * v / g.visible.length), exploredPct: Math.round(100 * e / g.visible.length) }]; }));
    },
  };
}

function update(sim) {
  const V = sim.vision, { cols, rows, height, size } = V;
  for (const t of sim.teams) V.teams[t].visible.fill(0);
  const done = new Set();
  for (const e of sim.entities) {
    if (e.dead || e.owner < 0) continue;
    const k = sim.kindOf(e), team = sim.teamOf(e), c = V.cellOf(e.x, e.z);
    const r = Math.ceil(k.sight / size);
    const key = `${team}:${c}:${k.sight}:${k.air ? 1 : 0}`;
    if (done.has(key)) continue;
    done.add(key);
    const vis = V.teams[team].visible, exp = V.teams[team].explored;
    const cx = c % cols, cz = (c / cols) | 0, eye = height[c] + (k.air ? fx(50) : EYE), r2 = len2(k.sight, 0);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
      if (len2(dx * size, dz * size) > r2) continue;
      const i = z * cols + x;
      if (vis[i]) continue;
      if (k.air || lineOfSight(V, cx, cz, x, z, eye)) { vis[i] = 1; exp[i] = 1; }
    }
  }
  for (const t of sim.teams) { const v = V.teams[t].visible; let s = 0; for (let i = 0; i < v.length; i++) if (v[i]) s = (Math.imul(s, 31) + i) | 0; V.teams[t].sum = s; }
}

/** Walk the cells between (x0, z0) and (x1, z1); false when the ground rises above the line from the eye to the target's ground + 1 m */
function lineOfSight(V, x0, z0, x1, z1, eye) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  if (n <= 1) return true;
  const end = V.height[z1 * V.cols + x1] + TARGET, dh = end - eye;
  for (let i = 1; i < n; i++) {
    const x = x0 + Math.round(((x1 - x0) * i) / n), z = z0 + Math.round(((z1 - z0) * i) / n);
    const lineH = eye + Math.floor((dh * i) / n);
    if (V.height[z * V.cols + x] > lineH) return false;
  }
  return true;
}

// run-length pack for snapshots: [value, count, value, count, ...]
function pack(a) { const out = []; for (let i = 0; i < a.length;) { let j = i; while (j < a.length && a[j] === a[i]) j++; out.push(a[i], j - i); i = j; } return out; }
function unpack(p, a) { let k = 0; for (let i = 0; i < p.length; i += 2) { a.fill(p[i], k, k + p[i + 1]); k += p[i + 1]; } }
