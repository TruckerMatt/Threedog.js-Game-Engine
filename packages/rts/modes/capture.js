// Capture points: zones a team takes by standing in them alone. While one team's capturing units (kind.capture, not air) are inside, the
// point swings toward that team; a point held by another team first drains to neutral. Contested or empty points stay as they are. Every
// second each team scores the value of the points it fully holds (sim.teamScore). Used by reinforcement matches and by any mode with objectives.
//
//   captureSystem({ points: [{ id: 'bridge', x: 0, z: 40, radius: 15, value: 3 }], rate: 5 })   // meters; rate: % per second per unit (max 3 units)
//   sim.capture.points   [{ id, x, z, radius, value, holder (team or -1), amount 0..100, contested }]
import { fx, len2 } from '../fixed.js';
import { TICK_RATE } from '../content.js';

const MAX_UNITS = 3;

/**
 * @param {{ points: Array<{ id: string, x: number, z: number, radius?: number, value?: number }>, rate?: number }} o
 */
export function captureSystem(o) {
  if (!Array.isArray(o?.points) || !o.points.length) throw new Error("captureSystem: points is required, e.g. { points: [{ id: 'hill', x: 0, z: 0, radius: 15 }] }");
  const rate = o.rate ?? 5;
  return {
    name: 'capture',
    init(sim) {
      const ids = new Set();
      sim.capture = {
        points: o.points.map(p => {
          if (ids.has(p.id)) throw new Error(`captureSystem: point id '${p.id}' is used twice`);
          ids.add(p.id);
          return { id: String(p.id), x: fx(p.x), z: fx(p.z), radius: fx(p.radius ?? 15), value: Math.round(p.value ?? 1), holder: -1, amount: 0, contested: 0 };
        }),
      };
      sim.teamScore ??= Object.fromEntries(sim.teams.map(t => [t, 0]));
    },
    step(sim) {
      if (sim.tick % (TICK_RATE / 4) !== 0) return;   // 4 times a second
      const perStep = Math.max(1, Math.round(rate / 4));
      for (const pt of sim.capture.points) {
        const count = new Map();
        sim.spatial.near(pt.x, pt.z, pt.radius, e => {
          const k = sim.kindOf(e);
          if (e.owner < 0 || !k.capture || k.air || k.structure) return;
          if (sim.players[e.owner].left) return;
          const t = sim.teamOf(e);
          count.set(t, (count.get(t) ?? 0) + 1);
        });
        pt.contested = count.size > 1 ? 1 : 0;
        if (count.size !== 1) continue;
        const [team, n] = [...count][0], d = perStep * Math.min(n, MAX_UNITS);
        if (pt.holder === team) pt.amount = Math.min(100, pt.amount + d);
        else if (pt.amount > 0) pt.amount = Math.max(0, pt.amount - d);
        if (pt.amount === 0 && pt.holder !== team) { const was = pt.holder; pt.holder = team; if (was !== -1) sim.emit({ type: 'point-lost', id: pt.id, team: was }); }
        if (pt.amount === 100 && pt.holder === team && !pt.full) { pt.full = 1; sim.emit({ type: 'point-taken', id: pt.id, team }); }
        if (pt.amount < 100) pt.full = 0;
      }
      if (sim.tick % TICK_RATE === 0) for (const pt of sim.capture.points) if (pt.amount === 100 && pt.holder >= 0) sim.teamScore[pt.holder] += pt.value;
    },
    hash(sim, h) {
      for (const pt of sim.capture.points) h.int(pt.holder).int(pt.amount).int(pt.full ?? 0);
      for (const t of sim.teams) h.int(sim.teamScore[t]);
    },
    save: sim => ({ points: sim.capture.points.map(p => ({ holder: p.holder, amount: p.amount, full: p.full ?? 0 })), score: { ...sim.teamScore } }),
    load(sim, d) { d.points.forEach((p, i) => Object.assign(sim.capture.points[i], p)); sim.teamScore = { ...d.score }; },
    describe: sim => ({ points: sim.capture.points.map(p => `${p.id}: ${p.holder < 0 ? 'neutral' : `team ${p.holder}`} ${p.amount}%${p.contested ? ' contested' : ''}`), score: sim.teamScore }),
  };
}

/** Squared distance helper for other modes */
export const within = (e, pt) => len2(e.x - pt.x, e.z - pt.z) <= len2(pt.radius, 0);
