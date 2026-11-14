// Units: the order commands (move, attack-move, attack, stop, hold, patrol), the order queue, steering along flow fields, formations and
// separation. All integer math; units loop in id order.
//
// Commands (wire form, all numbers integers, positions fixed):
//   { p, t: 'move',   ids: [3, 4], x, z, queue?: 1 }   walk there in formation; queue: 1 appends instead of replacing (shift-click)
//   { p, t: 'amove',  ids, x, z, queue? }             attack-move: walk, but fight anything met on the way
//   { p, t: 'attack', ids, target, queue? }            chase and fight one entity
//   { p, t: 'patrol', ids, x, z, queue? }              attack-move back and forth between here and there
//   { p, t: 'stop',   ids }                             drop every order
//   { p, t: 'hold',   ids }                             stay put, fight only what comes in range
// Ids that died since the order was given are skipped; an id the player does not own refuses the whole command.
import { mul, div, len, len2, atan2, cos, sin, angleDiff, clamp, fx, ANGLE, ONE } from './fixed.js';
import { flowField, flowCacheOf, rebuildFlowCache, clearLine, GOAL, NONE, DIRS } from './flowfield.js';

/** Most units one command may carry */
export const MAX_IDS = 500;
const APPROACH_CELLS = 6;   // closer than this to the final point, steer straight at it
const DIRECT_CELLS = 30;    // closer than this with nothing blocked in between, steer straight too (no field needed)
const STUCK_DONE = 12;      // ticks without progress inside the group radius count as arrived

// state field values
export const IDLE = 0, MOVING = 1, ENGAGING = 2, HOLDING = 3;

function checkIds(sim, c) {
  if (!Array.isArray(c.ids) || !c.ids.length || c.ids.length > MAX_IDS) return `ids must be a list of 1..${MAX_IDS} entity ids`;
  for (const id of c.ids) {
    if (!Number.isInteger(id)) return `ids must be integers (got ${id})`;
    const e = sim.byId.get(id);
    if (e && e.owner !== c.p) return `entity ${id} is not player ${c.p}'s`;
  }
  return '';
}
const checkPoint = (sim, c) => !Number.isInteger(c.x) || !Number.isInteger(c.z) ? 'x and z must be fixed integers (fx(meters))'
  : !sim.map.inside(c.x, c.z) ? 'the point is off the map' : '';
const checkQueue = c => c.queue === undefined || c.queue === 0 || c.queue === 1 ? '' : 'queue must be 0 or 1';
/** The command's units that are alive and can take orders (not structures) */
const movers = (sim, c) => c.ids.map(id => sim.get(id)).filter(e => e && !sim.kindOf(e).structure);

function give(e, order, queue) {
  if (!queue) { e.orders.length = 0; e.target = 0; }
  if (e.orders.length < 32) e.orders.push(order);
}

/**
 * Formation slots: units keep their left-to-right order across the march direction and stand in rows facing it.
 * Returns [{ e, x, z }] (fixed), one per unit, around the target point.
 */
export function formation(sim, units, tx, tz) {
  if (units.length === 1) return [{ e: units[0], x: tx, z: tz }];
  let cx = 0, cz = 0, rMax = 0;
  for (const e of units) { cx += e.x; cz += e.z; rMax = Math.max(rMax, sim.kindOf(e).radius); }
  cx = Math.floor(cx / units.length); cz = Math.floor(cz / units.length);
  const ang = atan2(tz - cz, tx - cx), fwdX = cos(ang), fwdZ = sin(ang), sideX = -fwdZ, sideZ = fwdX;
  const cols = Math.ceil(Math.sqrt(units.length)), gap = rMax * 2 + (rMax >> 1) + fx(0.5);
  // sort across the march (side axis), then along it, ties by id: neighbors stay neighbors, nobody crosses the group
  const keyed = units.map(e => ({ e, s: mul(e.x - cx, sideX) + mul(e.z - cz, sideZ), f: mul(e.x - cx, fwdX) + mul(e.z - cz, fwdZ) }));
  keyed.sort((a, b) => (b.f - a.f) || (a.s - b.s) || (a.e.id - b.e.id));
  const rows = [];
  for (let i = 0; i < keyed.length; i += cols) rows.push(keyed.slice(i, i + cols).sort((a, b) => (a.s - b.s) || (a.e.id - b.e.id)));
  const out = [];
  rows.forEach((row, r) => row.forEach((k, i) => {
    const side = (i * 2 - (row.length - 1)) * (gap >> 1), back = -r * gap;
    let x = tx + mul(sideX, side) + mul(fwdX, back), z = tz + mul(sideZ, side) + mul(fwdZ, back);
    x = clamp(x, sim.map.minX + 1, sim.map.maxX - 1); z = clamp(z, sim.map.minZ + 1, sim.map.maxZ - 1);
    if (sim.map.block[sim.map.cellAt(x, z)] && !sim.kindOf(k.e).air) { x = tx; z = tz; }
    out.push({ e: k.e, x, z });
  }));
  return out;
}

function pointOrder(t) {
  return {
    validate: (sim, c) => checkIds(sim, c) || checkPoint(sim, c) || checkQueue(c),
    apply(sim, c) {
      const us = movers(sim, c);
      if (!us.length) return;
      const goal = sim.map.cellAt(c.x, c.z), r = groupRadius(sim, us);
      for (const s of formation(sim, us, c.x, c.z)) {
        const o = { t, x: s.x, z: s.z, g: goal, r };
        if (t === 'patrol') { o.bx = s.e.x; o.bz = s.e.z; }
        give(s.e, o, c.queue);
      }
    },
  };
}

function groupRadius(sim, us) {
  let area = 0;
  for (const e of us) { const r = sim.kindOf(e).radius; area += mul(r, r) * 4; }
  return Math.max(fx(1), Math.floor(Math.sqrt(area * ONE)) | 0);
}

/** The units system. Install after spatial and before combat. */
export function unitsSystem() {
  return {
    name: 'units',
    init(sim) {
      sim.field('stuck');
      sim.defineCommand('move', pointOrder('move'));
      sim.defineCommand('amove', pointOrder('amove'));
      sim.defineCommand('patrol', pointOrder('patrol'));
      sim.defineCommand('attack', {
        validate(sim, c) {
          const why = checkIds(sim, c) || checkQueue(c) || (!Number.isInteger(c.target) ? 'target must be an entity id' : '');
          if (why) return why;
          const t = sim.get(c.target);
          return t && t.owner >= 0 && sim.teamOf(t) === sim.players[c.p].team ? `entity ${c.target} is on your own team` : '';
        },
        apply(sim, c) {
          const t = sim.get(c.target);
          if (!t) return;
          for (const e of movers(sim, c)) if (e.id !== t.id && sim.kindOf(e).weapons.length) give(e, { t: 'attack', target: t.id }, c.queue);
        },
      });
      sim.defineCommand('stop', {
        validate: (sim, c) => checkIds(sim, c),
        apply: (sim, c) => { for (const e of movers(sim, c)) { e.orders.length = 0; e.target = 0; e.state = IDLE; e.vx = e.vz = 0; } },
      });
      sim.defineCommand('hold', {
        validate: (sim, c) => checkIds(sim, c),
        apply: (sim, c) => { for (const e of movers(sim, c)) { e.orders.length = 0; e.orders.push({ t: 'hold' }); e.target = 0; } },
      });
    },
    step(sim) {
      for (const e of sim.entities) {
        e.vx = 0; e.vz = 0;
        const k = sim.kindOf(e);
        if (e.dead || k.structure || k.speed === 0) continue;
        const o = e.orders[0];
        if (!o) { e.state = e.target ? ENGAGING : IDLE; continue; }
        if (o.t === 'hold') { e.state = HOLDING; continue; }
        if (o.t === 'attack') {   // an attack order lasts while its target lives: locked (and fired at) while seen, followed while hidden
          const t = sim.get(o.target);
          if (!t) { e.orders.shift(); e.target = 0; continue; }
          if (!sim.vision || sim.vision.seen(sim.teamOf(e), t)) e.target = t.id;
          else { e.target = 0; e.state = MOVING; moveToward(sim, e, k, t.x, t.z, sim.map.cellAt(t.x, t.z)); continue; }
        }
        // an engaged unit (attack order, or attack-move / patrol that found a target) moves toward its target until in range
        if (e.target && (o.t === 'attack' || o.t === 'amove' || o.t === 'patrol')) {
          const t = sim.get(e.target);
          if (t) {
            e.state = ENGAGING;
            const range = k.range + sim.kindOf(t).radius;
            if (len2(t.x - e.x, t.z - e.z) > range * range) moveToward(sim, e, k, t.x, t.z, sim.map.cellAt(t.x, t.z));
            continue;
          }
          e.target = 0;
          if (o.t === 'attack') { e.orders.shift(); continue; }
        }
        if (o.t === 'attack') { e.orders.shift(); continue; }   // the target is gone
        if (o.t !== 'move' && o.t !== 'amove' && o.t !== 'patrol') continue;   // another system's order (gather, build...): it moves the unit
        e.state = MOVING;
        const d = len(o.x - e.x, o.z - e.z), before = d;
        if (d <= Math.max(k.speed, fx(0.25))) { arrive(e, o); continue; }
        moveToward(sim, e, k, o.x, o.z, o.g);
        const after = len(o.x - e.x, o.z - e.z);
        e.stuck = after >= before - (k.speed >> 3) ? e.stuck + 1 : 0;
        if (e.stuck >= STUCK_DONE && after <= o.r + k.radius * 2) arrive(e, o);
      }
      separate(sim);
    },
    // which fields are cached decides some steering (see flowField), so it is saved: the goals in cache order, rebuilt after every system loaded
    save: sim => ({ flow: [...flowCacheOf(sim).fields.keys()], builds: sim.flowBuildTick === sim.tick ? sim.flowBuilds : 0 }),
    afterLoad(sim, d) { rebuildFlowCache(sim, d.flow); sim.flowBuildTick = sim.tick; sim.flowBuilds = d.builds; },
    hash(sim, h) { const c = flowCacheOf(sim); h.int(c.fields.size); for (const g of c.fields.keys()) h.int(g); },
    describe(sim) {
      let moving = 0, engaging = 0;
      for (const e of sim.entities) { if (e.state === MOVING) moving++; else if (e.state === ENGAGING) engaging++; }
      return { moving, engaging, flowFieldsCached: flowCacheOf(sim).fields.size };
    },
  };
}

function arrive(e, o) {
  e.stuck = 0;
  if (o.t === 'patrol') {   // turn around: swap the two ends and keep going
    [o.x, o.bx] = [o.bx, o.x]; [o.z, o.bz] = [o.bz, o.z]; o.g = -1;
    return;
  }
  e.orders.shift();
  if (!e.orders.length) e.state = IDLE;
}

/** Steer e one tick toward (tx, tz): along the flow field to goal cell g (g < 0: compute from the point), straight when close or flying */
export function moveToward(sim, e, k, tx, tz, g) {
  const m = sim.map;
  let wx = tx, wz = tz;
  const d2 = len2(tx - e.x, tz - e.z);
  const close = d2 <= len2(m.cell * APPROACH_CELLS, 0) || (d2 <= len2(m.cell * DIRECT_CELLS, 0) && clearLine(m, e.x, e.z, tx, tz));
  const f = !k.air && !close ? flowField(sim, g >= 0 ? g : m.cellAt(tx, tz)) : null;
  if (f) {
    let c = m.cellAt(e.x, e.z);
    const d0 = f.dir[c];
    if (d0 !== NONE && d0 !== GOAL) {
      // look two cells ahead along the field: smoother than turning at every cell center
      for (let i = 0; i < 2; i++) { const d = f.dir[c]; if (d === GOAL || d === NONE) break; c = (((c / m.cols) | 0) + DIRS[d][1]) * m.cols + (c % m.cols) + DIRS[d][0]; }
      if (f.dir[c] !== GOAL) { wx = m.centerX(c % m.cols); wz = m.centerZ((c / m.cols) | 0); }
    }
  }
  const dx = wx - e.x, dz = wz - e.z, dist = len(dx, dz);
  if (dist === 0) return;
  const want = atan2(dz, dx), diff = angleDiff(e.facing, want);
  e.facing = (e.facing + clamp(diff, -k.turnRate, k.turnRate)) & (ANGLE - 1);
  const left = angleDiff(e.facing, want), c = cos(left);
  if (c <= 0) return;   // still turning toward the way
  const step = Math.min(mul(k.speed, c), dist);
  const nx = e.x + mul(cos(e.facing), step), nz = e.z + mul(sin(e.facing), step);
  place(sim, e, k, nx, nz);
}

/** Move e to (nx, nz) unless that is blocked ground; slide along one axis if only that is open */
function place(sim, e, k, nx, nz) {
  const m = sim.map, ox = e.x, oz = e.z;
  nx = clamp(nx, m.minX, m.maxX - 1); nz = clamp(nz, m.minZ, m.maxZ - 1);
  if (k.air || !m.block[m.cellAt(nx, nz)]) { e.x = nx; e.z = nz; }
  else if (!m.block[m.cellAt(nx, oz)]) e.x = nx;
  else if (!m.block[m.cellAt(ox, nz)]) e.z = nz;
  e.vx += e.x - ox; e.vz += e.z - oz;
}

/** Push overlapping ground units apart, half each; structures never move. One pass, id order. */
function separate(sim) {
  const S = sim.spatial;
  if (!S) return;
  let rMax = 0;
  for (const k of sim.content.kinds) if (k.radius > rMax) rMax = k.radius;
  for (const e of sim.entities) {
    const k = sim.kindOf(e);
    if (e.dead || k.structure || k.air) continue;
    S.near(e.x, e.z, k.radius + rMax, o => {
      if (o === e) return;
      const ko = sim.kindOf(o);
      if (ko.air) return;
      const dx = e.x - o.x, dz = e.z - o.z, d = len(dx, dz), overlap = k.radius + ko.radius - d;
      if (overlap <= 0) return;
      const share = ko.structure ? overlap : overlap >> 1;
      let ux, uz;
      if (d === 0) { const a = Math.imul(e.id, 40503) & (ANGLE - 1); ux = cos(a); uz = sin(a); }
      else { ux = div(dx, d); uz = div(dz, d); }
      place(sim, e, k, e.x + mul(ux, share), e.z + mul(uz, share));
    });
  }
}
