// Spatial buckets: which entities stand near a point. Rebuilt once per tick (after commands, before movement), in id order, so a query
// visits entities in the same order on every machine. Two grids:
//   fine   (2 cells, ~4 m): short queries such as separation, where a dense blob must not cost hundreds of checks per unit
//   coarse (8 cells, ~16 m), one per team: long queries such as target search, which only walk the enemy teams' lists
//   sim.spatial.near(x, z, r, fn)               every alive entity within r (fixed) of (x, z)
//   sim.spatial.nearEnemies(team, x, z, r, fn)  only entities of other teams (neutral included)
import { len2 } from './fixed.js';

const FINE = 2, COARSE = 8;

export function spatialSystem() {
  return {
    name: 'spatial',
    init(sim) {
      const m = sim.map, teams = sim.teams, nt = teams.length + 1;   // + 1: neutral entities
      const teamIndex = new Map(teams.map((t, i) => [t, i]));
      const grid = cells => ({ c: Math.ceil(m.cols / cells), r: Math.ceil(m.rows / cells), cells });
      const F = grid(FINE), C = grid(COARSE);
      F.head = new Int32Array(F.c * F.r); C.head = new Int32Array(C.c * C.r * nt);
      const S = sim.spatial = { list: [], nextF: new Int32Array(64), nextC: new Int32Array(64) };
      const bucket = (G, x, z) => Math.floor(m.cellZ(z) / G.cells) * G.c + Math.floor(m.cellX(x) / G.cells);
      const tIdx = e => e.owner < 0 ? nt - 1 : teamIndex.get(sim.players[e.owner].team);
      S.rebuild = () => {
        const list = S.list = sim.entities;
        if (S.nextF.length < list.length) { S.nextF = new Int32Array(list.length * 2); S.nextC = new Int32Array(list.length * 2); }
        F.head.fill(-1); C.head.fill(-1);
        const cn = C.c * C.r;
        for (let i = list.length - 1; i >= 0; i--) {   // backwards: each chain ends up in ascending id order
          const e = list[i];
          if (e.dead) continue;
          const bf = bucket(F, e.x, e.z), bc = tIdx(e) * cn + bucket(C, e.x, e.z);
          S.nextF[i] = F.head[bf]; F.head[bf] = i;
          S.nextC[i] = C.head[bc]; C.head[bc] = i;
        }
      };
      const walk = (G, head, next, base, x, z, r, fn) => {
        const x0 = Math.floor(m.cellX(x - r) / G.cells), x1 = Math.floor(m.cellX(x + r) / G.cells);
        const z0 = Math.floor(m.cellZ(z - r) / G.cells), z1 = Math.floor(m.cellZ(z + r) / G.cells);
        const r2 = len2(r, 0);
        for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
          for (let i = head[base + bz * G.c + bx]; i !== -1; i = next[i]) {
            const e = S.list[i], dx = e.x - x, dz = e.z - z;
            if (!e.dead && dx * dx + dz * dz <= r2) fn(e);
          }
        }
      };
      /** Every alive entity within r of (x, z): ascending id within each bucket, buckets row by row */
      S.near = (x, z, r, fn) => {
        if (r <= m.cell * FINE * 2) return walk(F, F.head, S.nextF, 0, x, z, r, fn);
        for (let t = 0; t < nt; t++) walk(C, C.head, S.nextC, t * C.c * C.r, x, z, r, fn);
      };
      /** Entities of every team but `team` within r (neutral entities included), team by team in team order */
      S.nearEnemies = (team, x, z, r, fn) => {
        const skip = teamIndex.get(team);
        for (let t = 0; t < nt; t++) if (t !== skip) walk(C, C.head, S.nextC, t * C.c * C.r, x, z, r, fn);
      };
      S.rebuild();
    },
    step(sim) { sim.spatial.rebuild(); },
  };
}
