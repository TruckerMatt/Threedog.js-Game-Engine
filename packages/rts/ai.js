// Skirmish AI. Bots are part of the sim: every client runs the same bot code on the same state with the same seeded rng, so a bot's
// commands never travel over the network and cannot desync. A bot sends ordinary commands through sim.run (validated like a player's),
// and it only targets what its team sees; it knows the map, the capture points and the enemy start positions, as a player would.
//
//   players: [{ team: 0 }, { team: 1, bot: { level: 'normal' } }]        then install botSystem() last
//   bot options: level 'easy' | 'normal' | 'hard', mix: { tank: 1, soldier: 3 } (what to buy), workers: 8, attackAt: 10,
//                buildOrder: ['barracks', 'depot', 'factory'], army: ['tank', 'soldier']
import { len2, cos, sin, ANGLE } from './fixed.js';

const LEVELS = { easy: { every: 60, attackAt: 16 }, normal: { every: 20, attackAt: 10 }, hard: { every: 10, attackAt: 8 } };

export function botSystem() {
  return {
    name: 'bots',
    init(sim) {
      sim.bots = sim.players.map(p => {
        if (!p.bot) return null;
        const lv = LEVELS[p.bot.level ?? 'normal'];
        if (!lv) throw new Error(`bot level '${p.bot.level}': use easy, normal or hard`);
        return { ...lv, workers: 8, ...p.bot };
      });
    },
    step(sim) {
      sim.players.forEach((p, i) => {
        const b = sim.bots[i];
        if (!b || p.left || sim.ended || (sim.tick + i * 7) % b.every !== 0) return;
        for (const c of sim.reinforce ? reinforceThink(sim, i, b) : sim.base ? baseThink(sim, i, b) : skirmishThink(sim, i, b)) sim.run({ ...c, p: i });
      });
    },
    describe: sim => sim.bots.map((b, i) => b && `p${i}: ${b.level ?? 'normal'}`).filter(Boolean),
  };
}

const mine = (sim, p) => sim.entities.filter(e => e.owner === p && !e.dead);
const army = (sim, p) => mine(sim, p).filter(e => { const k = sim.kindOf(e); return !k.structure && !k.gather && k.weapons.length; });
const idle = list => list.filter(e => !e.orders.length);
const centroid = list => ({ x: Math.floor(list.reduce((s, e) => s + e.x, 0) / list.length), z: Math.floor(list.reduce((s, e) => s + e.z, 0) / list.length) });
const ids = list => list.slice(0, 500).map(e => e.id);

/** Nearest seen enemy entity to (x, z), or null */
function nearestEnemy(sim, team, x, z, test = () => true) {
  let best = null, bd = Infinity;
  for (const e of sim.entities) {
    if (e.dead || e.owner < 0 || sim.teamOf(e) === team || !test(e)) continue;
    if (sim.vision && !sim.vision.seen(team, e)) continue;
    const d = len2(e.x - x, e.z - z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Weighted pick of an affordable unit kind; null if none */
function pickKind(sim, b, budget) {
  const kinds = sim.content.kinds.filter(k => !k.structure && !k.gather && k.cost <= budget && (b.mix ? b.mix[k.name] : k.weapons.length));
  if (!kinds.length) return null;
  const w = kinds.map(k => Math.max(1, Math.round(b.mix?.[k.name] ?? 1)));
  let r = sim.rng.int(w.reduce((a, c) => a + c, 0));
  for (let i = 0; i < kinds.length; i++) { r -= w[i]; if (r < 0) return kinds[i]; }
  return kinds[0];
}

// ---- reinforcement matches: buy, then send idle squads at the nearest point the team does not hold ----
function reinforceThink(sim, p, b) {
  const out = [], R = sim.reinforce, P = sim.players[p], team = P.team, zone = R.zonesOf(team)[0];
  if (!R.pending.some(d => d.p === p)) {
    const kinds = [];
    let budget = P.res;
    for (let i = 0; i < 12; i++) { const k = pickKind(sim, b, budget); if (!k) break; kinds.push(k.name); budget -= k.cost; }
    if (kinds.length) out.push({ t: 'reinforce', kinds, x: zone.x, z: zone.z });
  }
  const free = idle(army(sim, p));
  // units walking to a point the team now fully holds are free again
  if (sim.capture) for (const e of army(sim, p)) {
    const o = e.orders[0];
    if (o?.t === 'amove' && sim.capture.points.some(pt => pt.holder === team && pt.amount === 100 && len2(o.x - pt.x, o.z - pt.z) <= len2(pt.radius, 0))) free.push(e);
  }
  if (!free.length) return out;
  const c = centroid(free);
  let goal = null;
  if (sim.capture) {
    let bd = Infinity;
    for (const pt of sim.capture.points) {
      if (pt.holder === team && pt.amount === 100) continue;
      const d = len2(pt.x - c.x, pt.z - c.z);
      if (d < bd) { bd = d; goal = { x: pt.x, z: pt.z }; }
    }
  }
  goal ??= nearestEnemy(sim, team, c.x, c.z);
  if (!goal && sim.capture) goal = sim.capture.points[sim.rng.int(sim.capture.points.length)];
  if (goal) out.push({ t: 'amove', ids: ids(free), x: goal.x, z: goal.z });
  return out;
}

// ---- plain skirmish (no mode): attack-move idle units at the nearest seen enemy, else at the map center ----
function skirmishThink(sim, p, b) {
  const free = idle(army(sim, p));
  if (free.length < Math.min(b.attackAt, army(sim, p).length)) return [];
  if (!free.length) return [];
  const c = centroid(free), t = nearestEnemy(sim, sim.players[p].team, c.x, c.z);
  const m = sim.map, goal = t ?? { x: m.originX + (m.width >> 1), z: m.originZ + (m.depth >> 1) };
  return [{ t: 'amove', ids: ids(free), x: goal.x, z: goal.z }];
}

// ---- base building: workers gather, keep supply ahead, follow the build order, produce army, attack in waves ----
function baseThink(sim, p, b) {
  const out = [], B = sim.base, P = sim.players[p], team = P.team, own = mine(sim, p);
  const structs = own.filter(e => sim.kindOf(e).structure), home = structs[0];
  if (!home) return skirmishThink(sim, p, b);
  let res = P.res;
  const spend = k => { if (k.cost > res) return false; res -= k.cost; return true; };

  // workers
  const workers = own.filter(e => sim.kindOf(e).gather);
  const field = nearestNeutralResource(sim, home);
  const lazy = workers.filter(e => !e.orders.length);
  if (field && lazy.length) out.push({ t: 'gather', ids: ids(lazy), target: field.id });
  const workerKind = sim.content.kinds.find(k => k.gather);
  if (workerKind && workers.length < b.workers) {
    const hq = structs.find(e => e.phase === 0 && sim.kindOf(e).produces.includes(workerKind.name) && e.queue.length < 2);
    if (hq && !B.missing(p, workerKind).length && spend(workerKind)) out.push({ t: 'produce', id: hq.id, kind: workerKind.name });
  }

  // supply
  const sup = B.supply(p), supplyKind = sim.content.kinds.filter(k => k.structure && k.supply > 0 && !k.produces.length).sort((a, c) => a.cost - c.cost)[0];
  const buildingSupply = structs.some(e => e.phase === 1 && sim.kindOf(e) === supplyKind);
  if (supplyKind && sup.cap - sup.used <= 4 && !buildingSupply && !B.missing(p, supplyKind).length && supplyKind.cost <= res) {
    const at = findSpot(sim, p, home, supplyKind, structs.length);
    if (at && spend(supplyKind)) out.push({ t: 'build', kind: supplyKind.name, x: at.x, z: at.z });
  }

  // build order: the first structure of the list we have fewer of than the list asks
  const order = b.buildOrder ?? sim.content.kinds.filter(k => k.structure && k.produces.length && k.build).sort((a, c) => a.cost - c.cost).map(k => k.name);
  const have = new Map();
  for (const e of structs) have.set(sim.kindOf(e).name, (have.get(sim.kindOf(e).name) ?? 0) + 1);
  const want = new Map();
  for (const n of order) {
    want.set(n, (want.get(n) ?? 0) + 1);
    if ((have.get(n) ?? 0) >= want.get(n)) continue;
    const k = sim.content.kind[n];
    if (!k || B.missing(p, k).length || k.cost > res) break;   // wait for this one before skipping ahead
    const at = findSpot(sim, p, home, k, structs.length);
    if (at && spend(k)) out.push({ t: 'build', kind: n, x: at.x, z: at.z });
    break;
  }

  // production
  for (const e of structs) {
    if (e.phase !== 0 || e.queue.length) continue;
    const options = sim.kindOf(e).produces.map(n => sim.content.kind[n]).filter(k => !k.gather && k.weapons.length && (!b.army || b.army.includes(k.name)) && !B.missing(p, k).length);
    const k = options.filter(x => x.cost <= res).sort((a, c) => (c.cost - a.cost) || (a.index - c.index))[0];
    if (k && spend(k)) out.push({ t: 'produce', id: e.id, kind: k.name });
  }

  // attack in waves
  const free = idle(army(sim, p));
  if (free.length >= b.attackAt) {
    const c = centroid(free);
    const target = nearestEnemy(sim, team, c.x, c.z, e => sim.kindOf(e).structure) ?? nearestEnemy(sim, team, c.x, c.z)
      ?? B.starts.filter(s => sim.players[s.p].team !== team).sort((a, d) => len2(a.x - c.x, a.z - c.z) - len2(d.x - c.x, d.z - c.z))[0];
    if (target) out.push({ t: 'amove', ids: ids(free), x: target.x, z: target.z });
  }
  return out;
}

function nearestNeutralResource(sim, from) {
  let best = null, bd = Infinity;
  for (const e of sim.entities) {
    if (e.dead || e.owner >= 0 || !sim.kindOf(e).tags.includes('resource')) continue;
    const d = len2(e.x - from.x, e.z - from.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** A legal spot for a structure in rings around home; the start angle turns with the structure count so a base spreads out */
function findSpot(sim, p, home, k, n) {
  for (let r = 14; r <= 40; r += 6) {
    for (let i = 0; i < 16; i++) {
      const a = ((i + n * 5) * (ANGLE / 16)) & (ANGLE - 1);
      const x = home.x + (cos(a) * r), z = home.z + (sin(a) * r);   // cos(a) is fixed (ONE = 1), times whole meters r gives fixed meters
      if (sim.base.canPlace(p, k.name, x | 0, z | 0) === '') return { x: x | 0, z: z | 0 };
    }
  }
  return null;
}
