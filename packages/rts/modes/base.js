// Base building (C&C / StarCraft style): structures placed on the grid, production queues, supply, workers gathering from resource fields,
// and passive income. Content describes it all; this system is the rules.
//
// Content keys it reads (see content.js): structure: true, footprint: [width, depth] (meters), build: { time, requires: [kinds] },
//   produces: [unit kinds], supply (a structure provides it, a unit uses it), income (per second, structures), gather: { amount, time }
//   (a worker), tags: ['dropoff'] (workers bring resources here), tags: ['resource'] (a neutral field; its hp is the amount left).
//
//   baseSystem({ startRes: 400, supplyCap: 200, buildRadius: 40,
//     start: [{ p: 0, x: -150, z: 0, kinds: ['hq', 'worker', 'worker'] }, { p: 1, x: 150, z: 0, kinds: ['hq', 'worker', 'worker'] }],
//     resources: [{ kind: 'crystal', x: -120, z: 20 }] })
// Commands: build { kind, x, z } · produce { id, kind, count? } · cancel { id } · rally { id, x, z } · gather { ids, target }
// Events: placed, built, produced, supply-blocked, deposit, depleted
// sim.base.canPlace(p, kindName, x, z) → '' or why not (UI placement ghosts use it too)
import { fx, len2, ONE } from '../fixed.js';
import { TICK_RATE } from '../content.js';
import { moveToward } from '../units.js';

export const BUILDING = 1, READY = 0;

/**
 * @param {{ startRes?: number, supplyCap?: number, buildRadius?: number, start?: Array<{ p: number, x: number, z: number, kinds: string[] }>,
 *   resources?: Array<{ kind: string, x: number, z: number }> }} [o] meters
 */
export function baseSystem(o = {}) {
  const supplyCap = o.supplyCap ?? 200, buildRadius = fx(o.buildRadius ?? 40);
  return {
    name: 'base',
    init(sim) {
      for (const f of ['prog', 'carry', 'phase']) sim.field(f);
      sim.field('queue', null); sim.field('rally', null);
      const B = sim.base = { income: sim.players.map(() => 0), blocked: new Map(), starts: (o.start ?? []).map(s => ({ p: s.p, x: fx(s.x), z: fx(s.z) })) };
      for (const p of sim.players) p.res = Math.round(o.startRes ?? 400);

      B.cellsOf = (k, x, z) => {
        const m = sim.map, [w, d] = k.footprint ?? [m.cellM * 2, m.cellM * 2], hw = fx(w) >> 1, hd = fx(d) >> 1, out = [];
        for (let cz = m.cellZ(z - hd); cz <= m.cellZ(z + hd - 1); cz++) for (let cx = m.cellX(x - hw); cx <= m.cellX(x + hw - 1); cx++) out.push(cz * m.cols + cx);
        return out;
      };
      B.owns = (p, kindName) => sim.entities.some(e => e.owner === p && !e.dead && sim.kindOf(e).name === kindName && e.phase === READY);
      B.missing = (p, k) => (k.build?.requires ?? []).filter(r => !B.owns(p, r));
      B.supply = p => {
        let used = 0, cap = 0;
        for (const e of sim.entities) {
          if (e.owner !== p || e.dead) continue;
          const k = sim.kindOf(e);
          if (k.structure) { if (e.phase === READY) cap += k.supply; } else used += k.supply;
        }
        return { used, cap: Math.min(cap, supplyCap) };
      };
      B.canPlace = (p, kindName, x, z) => {
        const k = sim.content.kind[kindName];
        if (!k) return `unknown kind '${kindName}'`;
        if (!k.structure) return `'${kindName}' is not a structure`;
        if (!Number.isInteger(x) || !Number.isInteger(z)) return 'x and z must be fixed integers';
        if (!sim.map.inside(x, z)) return 'off the map';
        const miss = B.missing(p, k);
        if (miss.length) return `needs ${miss.join(', ')} first`;
        if (k.cost > sim.players[p].res) return `costs ${k.cost}, you have ${sim.players[p].res}`;
        const cells = B.cellsOf(k, x, z);
        if (cells.some(c => sim.map.block[c])) return 'the ground there is blocked';
        const near = sim.entities.some(e => e.owner === p && !e.dead && sim.kindOf(e).structure && len2(e.x - x, e.z - z) <= len2(buildRadius, 0));
        if (!near && sim.entities.some(e => e.owner === p && sim.kindOf(e).structure)) return 'too far from your other structures';
        return '';
      };

      const own = (sim, c, id) => { const e = sim.get(id); return !e ? `entity ${id} does not exist` : e.owner !== c.p ? `entity ${id} is not yours` : ''; };
      sim.defineCommand('build', {
        validate: (sim, c) => typeof c.kind !== 'string' ? 'kind must be a structure kind name' : B.canPlace(c.p, c.kind, c.x, c.z),
        apply(sim, c) {
          const k = sim.content.kind[c.kind];
          sim.players[c.p].res -= k.cost;
          const e = place(sim, c.p, k, c.x, c.z, true);
          sim.emit({ type: 'placed', id: e.id, kind: k.name, owner: c.p });
        },
      });
      sim.defineCommand('produce', {
        validate(sim, c) {
          const why = own(sim, c, c.id);
          if (why) return why;
          const e = sim.get(c.id), k = sim.content.kind[c.kind], n = c.count ?? 1;
          if (e.phase !== READY) return 'the structure is still being built';
          if (!k || !sim.kindOf(e).produces.includes(c.kind)) return `${sim.kindOf(e).name} does not produce '${c.kind}' (it produces: ${sim.kindOf(e).produces.join(', ') || 'nothing'})`;
          if (!Number.isInteger(n) || n < 1 || n > 10) return 'count must be 1..10';
          if (e.queue.length + n > 10) return 'the queue holds 10';
          const miss = B.missing(c.p, k);
          if (miss.length) return `needs ${miss.join(', ')} first`;
          if (k.cost * n > sim.players[c.p].res) return `costs ${k.cost * n}, you have ${sim.players[c.p].res}`;
          return '';
        },
        apply(sim, c) {
          const e = sim.get(c.id), k = sim.content.kind[c.kind], n = c.count ?? 1;
          sim.players[c.p].res -= k.cost * n;
          for (let i = 0; i < n; i++) e.queue.push(k.index);
        },
      });
      sim.defineCommand('cancel', {
        validate: (sim, c) => own(sim, c, c.id) || (sim.get(c.id).queue?.length ? '' : 'nothing is queued'),
        apply(sim, c) { const e = sim.get(c.id), k = sim.content.kinds[e.queue.pop()]; sim.players[c.p].res += k.cost; if (!e.queue.length) e.prog = 0; },
      });
      sim.defineCommand('rally', {
        validate: (sim, c) => own(sim, c, c.id) || (!Number.isInteger(c.x) || !Number.isInteger(c.z) || !sim.map.inside(c.x, c.z) ? 'x and z must be a fixed point on the map' : ''),
        apply(sim, c) { sim.get(c.id).rally = [c.x, c.z]; },
      });
      sim.defineCommand('gather', {
        validate(sim, c) {
          if (!Array.isArray(c.ids) || !c.ids.length) return 'ids must list workers';
          for (const id of c.ids) { const e = sim.byId.get(id); if (e && e.owner !== c.p) return `entity ${id} is not yours`; }
          const t = sim.get(c.target);
          return !t ? 'the resource is gone' : !sim.kindOf(t).tags.includes('resource') ? `${sim.kindOf(t).name} is not a resource` : '';
        },
        apply(sim, c) {
          for (const id of c.ids) {
            const e = sim.get(id);
            if (!e || !sim.kindOf(e).gather) continue;
            e.orders.length = 0; e.target = 0; e.orders.push({ t: 'gather', target: c.target }); e.phase = 0;
          }
        },
      });

      for (const r of o.resources ?? []) place(sim, -1, kindNamed(sim, r.kind), fx(r.x), fx(r.z), false);
      for (const s of o.start ?? []) s.kinds.forEach((n, i) => {
        const k = kindNamed(sim, n);
        if (k.structure) place(sim, s.p, k, fx(s.x), fx(s.z), false);
        else sim.spawn(n, { owner: s.p, x: fx(s.x) + fx(8) + fx((i % 4) * 2), z: fx(s.z) + fx(Math.floor(i / 4) * 2) });
      });
    },
    spawned(sim, e) { e.queue = []; e.rally = null; },
    step(sim) {
      const B = sim.base;
      for (const e of sim.entities) {
        if (e.dead) continue;
        const k = sim.kindOf(e);
        if (k.structure && e.owner >= 0) structureStep(sim, B, e, k);
        else if (e.orders[0]?.t === 'gather') gatherStep(sim, B, e, k);
      }
      // a dead structure opens its cells again
      for (const ev of sim.events) if (ev.type === 'death') { const k = sim.content.kind[ev.kind]; if (k.structure) unblock(sim, ev.id); }
    },
    hash(sim, h) { for (const v of sim.base.income) h.int(v); },
    save: sim => ({ income: sim.base.income.slice(), blocked: [...sim.base.blocked] }),
    load(sim, d) {
      sim.base.income = d.income.slice();
      for (const [, cells] of sim.base.blocked) sim.map.setBlocked(cells, 0);
      sim.base.blocked = new Map(d.blocked);
      for (const [, cells] of sim.base.blocked) sim.map.setBlocked(cells, 1);
    },
    describe: sim => ({ supply: sim.players.map((_, p) => { const s = sim.base.supply(p); return `${s.used}/${s.cap}`; }),
      building: sim.entities.filter(e => e.phase === BUILDING && sim.kindOf(e).structure).length,
      queued: sim.entities.reduce((n, e) => n + (e.queue?.length ?? 0), 0) }),
  };
}

function kindNamed(sim, n) {
  const k = sim.content.kind[n];
  if (!k) throw new Error(`baseSystem: unknown kind '${n}' in start or resources`);
  return k;
}

/** Spawn a structure, block its cells; constructing: starts at 10% hp and phase BUILDING */
function place(sim, p, k, x, z, constructing) {
  const B = sim.base, cells = B.cellsOf(k, x, z);
  const e = sim.spawn(k.name, { owner: p, x, z });
  if (constructing && k.build) { e.phase = BUILDING; e.prog = 0; e.hp = Math.max(1, Math.floor(k.hp / 10)); }
  B.blocked.set(e.id, cells);
  sim.map.setBlocked(cells, 1);
  return e;
}

function unblock(sim, id) {
  const cells = sim.base.blocked.get(id);
  if (!cells) return;
  sim.base.blocked.delete(id);
  sim.map.setBlocked(cells, 0);
}

function structureStep(sim, B, e, k) {
  if (e.phase === BUILDING) {
    e.prog++;
    e.hp = Math.min(k.hp, e.hp + Math.max(1, Math.floor((k.hp - Math.floor(k.hp / 10)) / k.build.time)));
    if (e.prog >= k.build.time) { e.phase = READY; e.prog = 0; e.hp = k.hp; sim.emit({ type: 'built', id: e.id, kind: k.name, owner: e.owner }); }
    return;
  }
  if (k.income) {   // fixed per tick into a fraction counter, whole points to the player
    B.income[e.owner] += k.income;
    if (B.income[e.owner] >= ONE) { sim.players[e.owner].res += B.income[e.owner] >> 16; B.income[e.owner] &= ONE - 1; }
  }
  if (!e.queue.length) return;
  const uk = sim.content.kinds[e.queue[0]], sup = B.supply(e.owner);
  if (e.prog === 0 && sup.used + uk.supply > sup.cap) {
    if (sim.tick % TICK_RATE === 0) sim.emit({ type: 'supply-blocked', id: e.id, owner: e.owner, used: sup.used, cap: sup.cap });
    return;
  }
  if (++e.prog < (uk.build?.time ?? TICK_RATE * 10)) return;
  e.prog = 0; e.queue.shift();
  const [w] = k.footprint ?? [4, 4];
  const u = sim.spawn(uk.name, { owner: e.owner, x: e.x + (fx(w) >> 1) + uk.radius + fx(1), z: e.z });
  if (e.rally) u.orders.push({ t: 'move', x: e.rally[0], z: e.rally[1], g: -1, r: fx(2) });
  sim.emit({ type: 'produced', id: u.id, kind: uk.name, owner: e.owner, by: e.id });
}

// gather phases: 0 walking to the resource, 1 harvesting, 2 carrying back
function gatherStep(sim, B, e, k) {
  const o = e.orders[0];
  if (e.phase === 2 || e.carry > 0 && e.phase !== 1) {
    e.phase = 2;
    const drop = nearest(sim, e, x => x.owner === e.owner && sim.kindOf(x).tags.includes('dropoff') && x.phase === READY);
    if (!drop) return;
    const reach = (fx((sim.kindOf(drop).footprint?.[0] ?? 4)) >> 1) + k.radius + fx(1.5);
    if (len2(drop.x - e.x, drop.z - e.z) > len2(reach, 0)) return moveToward(sim, e, k, drop.x, drop.z, -1);
    sim.players[e.owner].res += e.carry;
    sim.emit({ type: 'deposit', id: e.id, owner: e.owner, amount: e.carry });
    e.carry = 0; e.phase = 0;
    return;
  }
  let res = sim.get(o.target);
  if (!res) {   // depleted: the nearest other field of the same kind, else stop
    res = nearest(sim, e, x => x.owner < 0 && sim.kindOf(x).tags.includes('resource'));
    if (!res) { e.orders.shift(); return; }
    o.target = res.id;
  }
  const reach = (fx((sim.kindOf(res).footprint?.[0] ?? 4)) >> 1) + k.radius + fx(1.5);
  if (e.phase === 0) {
    if (len2(res.x - e.x, res.z - e.z) > len2(reach, 0)) return moveToward(sim, e, k, res.x, res.z, -1);
    e.phase = 1; e.prog = 0;
  }
  if (++e.prog < k.gather.time) return;
  const take = Math.min(k.gather.amount, Math.max(0, res.hp >> 16));
  e.carry = take; e.prog = 0; e.phase = 2;
  res.hp -= take * ONE;
  if (res.hp <= 0) { sim.emit({ type: 'depleted', id: res.id }); sim.kill(res, e.id); }
}

/** Nearest alive entity to e passing test, ties by id (a full scan: few structures) */
function nearest(sim, e, test) {
  let best = null, bd = Infinity;
  for (const x of sim.entities) {
    if (x.dead || !test(x)) continue;
    const d = len2(x.x - e.x, x.z - e.z);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}
