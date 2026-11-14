// Reinforcement mode (World in Conflict style): no bases. Each player has a budget of points (player.res); calling in units spends their cost,
// they arrive at a drop point inside the team's deploy zone after a delay, and when a unit dies its cost comes back after refundDelay.
// The budget therefore caps how big an army can be at once.
//
//   reinforceSystem({ budget: 1500, deployDelay: 8, refundDelay: 20, maxPerDrop: 12,
//     zones: [{ team: 0, x: -200, z: 0, radius: 40 }, { team: 1, x: 200, z: 0, radius: 40 }] })     // meters, seconds
// Command: { p, t: 'reinforce', kinds: ['tank', 'soldier', 'soldier'], x, z }   (x, z fixed, inside one of the team's zones)
// Events: { type: 'reinforce', p, kinds, x, z, at } when ordered, { type: 'arrive', p, ids } when they land.
import { fx, len2 } from '../fixed.js';
import { TICK_RATE } from '../content.js';

/**
 * @param {{ budget?: number, deployDelay?: number, refundDelay?: number, maxPerDrop?: number, zones: Array<{ team: number, x: number, z: number, radius?: number }>,
 *   start?: Array<{ p: number, kinds: string[] }> }} o start: units each player gets at tick 0 (they cost budget like any drop)
 */
export function reinforceSystem(o) {
  if (!Array.isArray(o?.zones) || !o.zones.length) throw new Error('reinforceSystem: zones is required, e.g. zones: [{ team: 0, x: -200, z: 0, radius: 40 }]');
  const deployDelay = Math.round((o.deployDelay ?? 8) * TICK_RATE), refundDelay = Math.round((o.refundDelay ?? 20) * TICK_RATE), maxPerDrop = o.maxPerDrop ?? 12;
  const zones = o.zones.map(z => ({ team: z.team, x: fx(z.x), z: fx(z.z), radius: fx(z.radius ?? 40) }));
  return {
    name: 'reinforce',
    init(sim) {
      const R = sim.reinforce = { zones, pending: [], refunds: [] };
      for (const p of sim.players) p.res = Math.round(o.budget ?? 1500);
      const units = sim.content.kinds.filter(k => !k.structure);
      const cheapest = Math.min(...units.map(k => k.cost));
      sim.canRecover = team => sim.players.some((p, i) => p.team === team && !p.left && (p.res >= cheapest || R.pending.some(x => x.p === i) || R.refunds.some(x => x.p === i)));
      /** The zone of a team nearest a point, or null */
      R.zoneOf = (team, x, z) => zones.find(zn => zn.team === team && len2(x - zn.x, z - zn.z) <= len2(zn.radius, 0)) ?? null;
      R.zonesOf = team => zones.filter(zn => zn.team === team);
      sim.defineCommand('reinforce', {
        validate(sim, c) {
          if (!Array.isArray(c.kinds) || !c.kinds.length || c.kinds.length > maxPerDrop) return `kinds must list 1..${maxPerDrop} unit kind names`;
          let cost = 0;
          for (const n of c.kinds) {
            const k = typeof n === 'string' ? sim.content.kind[n] : undefined;
            if (!k) return `unknown kind '${String(n).slice(0, 40)}'`;
            if (k.structure) return `'${n}' is a structure and cannot be called in`;
            cost += k.cost;
          }
          if (cost > sim.players[c.p].res) return `costs ${cost}, player ${c.p} has ${sim.players[c.p].res}`;
          if (!Number.isInteger(c.x) || !Number.isInteger(c.z)) return 'x and z must be fixed integers';
          if (!R.zoneOf(sim.players[c.p].team, c.x, c.z)) return 'the drop point is outside your team\'s deploy zones';
          return '';
        },
        apply(sim, c) {
          const cost = c.kinds.reduce((s, n) => s + sim.content.kind[n].cost, 0);
          sim.players[c.p].res -= cost;
          R.pending.push({ p: c.p, kinds: c.kinds.slice(), x: c.x, z: c.z, at: sim.tick + deployDelay });
          sim.emit({ type: 'reinforce', p: c.p, kinds: c.kinds.slice(), x: c.x, z: c.z, at: sim.tick + deployDelay });
        },
      });
      for (const s of o.start ?? []) {   // starting forces land at once, at the zone center
        const zn = R.zonesOf(sim.players[s.p].team)[0];
        const cost = s.kinds.reduce((t, n) => t + (sim.content.kind[n]?.cost ?? 0), 0);
        sim.players[s.p].res -= cost;
        land(sim, { p: s.p, kinds: s.kinds, x: zn.x, z: zn.z });
      }
    },
    step(sim) {
      const R = sim.reinforce;
      if (R.pending.length && R.pending.some(x => x.at <= sim.tick)) {
        for (const d of R.pending.filter(x => x.at <= sim.tick)) land(sim, d);
        R.pending = R.pending.filter(x => x.at > sim.tick);
      }
      if (R.refunds.length && R.refunds.some(x => x.at <= sim.tick)) {
        for (const r of R.refunds.filter(x => x.at <= sim.tick)) if (!sim.players[r.p].left) sim.players[r.p].res += r.amount;
        R.refunds = R.refunds.filter(x => x.at > sim.tick);
      }
    },
    killed(sim, e) { if (e.owner >= 0) sim.reinforce.refunds.push({ p: e.owner, amount: sim.kindOf(e).cost, at: sim.tick + refundDelay }); },
    hash(sim, h) {
      const R = sim.reinforce;
      h.int(R.pending.length).int(R.refunds.length);
      for (const d of R.pending) { h.int(d.p).int(d.x).int(d.z).int(d.at); for (const k of d.kinds) h.str(k); }
      for (const r of R.refunds) h.int(r.p).int(r.amount).int(r.at);
    },
    save: sim => ({ pending: sim.reinforce.pending, refunds: sim.reinforce.refunds }),
    load(sim, d) { sim.reinforce.pending = d.pending.map(x => ({ ...x, kinds: x.kinds.slice() })); sim.reinforce.refunds = d.refunds.map(x => ({ ...x })); },
    describe: sim => ({ budget: sim.players.map(p => p.res), arriving: sim.reinforce.pending.map(d => `p${d.p}: ${d.kinds.length} unit(s) in ${((d.at - sim.tick) / TICK_RATE).toFixed(1)} s`), refunding: sim.reinforce.refunds.length }),
  };
}

/** Spawn a drop's units in a small square around (x, z) */
function land(sim, d) {
  const n = d.kinds.length, cols = Math.ceil(Math.sqrt(n)), gap = fx(3), ids = [];
  d.kinds.forEach((name, i) => {
    const ox = ((i % cols) * 2 - (cols - 1)) * (gap >> 1), oz = ((Math.floor(i / cols)) * 2 - (Math.ceil(n / cols) - 1)) * (gap >> 1);
    let x = d.x + ox, z = d.z + oz;
    if (!sim.map.inside(x, z) || sim.map.block[sim.map.cellAt(x, z)]) { x = d.x; z = d.z; }
    ids.push(sim.spawn(name, { owner: d.p, x, z }).id);
  });
  sim.emit({ type: 'arrive', p: d.p, ids });
}
