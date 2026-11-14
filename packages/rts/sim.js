// The RTS simulation: deterministic, integer-only, no three.js and no DOM, so it runs the same in a page, a worker or Node.
// Everything that changes the game goes through commands; everything else (drawing, sound, UI, the camera) only reads.
//
//   import { createSim, loadContent, createMap, fx } from '@threedog/rts';
//   const sim = createSim({ seed: 7, content: loadContent(raw), map: createMap({ width: 256, depth: 256 }),
//     players: [{ team: 0 }, { team: 1 }] });
//   const tank = sim.spawn('tank', { owner: 0, x: fx(-50), z: fx(0) });
//   sim.step([{ p: 0, t: 'move', ids: [tank.id], x: fx(40), z: fx(10) }]);   // one tick (1/20 s); commands apply first
//   sim.hash()            // the same number on every machine after the same commands
//   sim.describe()        // short plain summary for tools and AI
//
// Order inside one step (never depends on machine speed or arrival order):
//   1. commands, sorted by player then by their order in the list   2. every system's step, in the order systems were installed
//   3. dead entities removed   4. tick + 1
// Entities sit in sim.entities sorted by id (ids only grow), and systems loop in that order.
import { Rng } from './rng.js';
import { Hasher, hex } from './hash.js';
import { fx, toFloat } from './fixed.js';
import { TICK_RATE } from './content.js';

/** Per-entity integer fields that are hashed and saved. A system that adds a field to entities lists it with sim.field(name). */
const BASE_FIELDS = ['id', 'kind', 'owner', 'x', 'z', 'facing', 'hp', 'vx', 'vz', 'target', 'state'];

/**
 * @param {{ seed?: number, content: object, map: object, players: Array<{ team?: number, name?: string, faction?: string, bot?: object }>,
 *   systems?: Array<object> }} o systems: installed in this order after the built-in ones (see defaultSystems in index.js)
 */
export function createSim(o) {
  if (!o?.content?.kinds) throw new Error('createSim: content is required (loadContent(raw))');
  if (!o.map?.cols) throw new Error('createSim: map is required (createMap({ width, depth }))');
  if (!Array.isArray(o.players) || !o.players.length) throw new Error('createSim: players is required, e.g. players: [{ team: 0 }, { team: 1 }]');
  const sim = {
    content: o.content, map: o.map.copy(), tickRate: TICK_RATE,
    tick: 0, nextId: 1, seed: o.seed ?? 1, rng: new Rng(o.seed ?? 1),
    players: o.players.map((p, i) => ({ index: i, team: p.team ?? i, name: p.name ?? `player ${i + 1}`, faction: p.faction ?? null,
      bot: p.bot ?? null, alive: true, left: false, res: 0, score: 0 })),
    entities: [], byId: new Map(),
    events: [], rejected: [], systems: [],
    fields: BASE_FIELDS.slice(),
    commands: new Map(),
  };
  sim.teams = [...new Set(sim.players.map(p => p.team))].sort((a, b) => a - b);

  /** Add a hashed and saved integer field to every entity (default value def) */
  sim.field = (name, def = 0) => {
    if (!sim.fields.includes(name)) sim.fields.push(name);
    sim.fieldDefaults[name] = def;
    for (const e of sim.entities) if (!(name in e)) e[name] = def;   // entities spawned before this system was installed
  };
  sim.fieldDefaults = {};

  /**
   * Define a command type. validate(sim, cmd) returns an error string or '' (network input is never trusted); apply(sim, cmd) changes state.
   * @param {string} type
   * @param {{ validate: (sim: any, cmd: any) => string, apply: (sim: any, cmd: any) => void }} handler
   */
  sim.defineCommand = (type, handler) => {
    if (sim.commands.has(type)) throw new Error(`rts command '${type}' is defined twice`);
    sim.commands.set(type, handler);
  };

  /**
   * Create an entity of a content kind. Only systems and command handlers call this (inside a step), plus setup code before the first step.
   * @param {string} kindName
   * @param {{ owner: number, x: number, z: number, facing?: number }} at fixed position
   */
  sim.spawn = (kindName, at) => {
    const k = sim.content.kind[kindName];
    if (!k) throw new Error(`sim.spawn: unknown kind '${kindName}' (known: ${Object.keys(sim.content.kind).join(', ')})`);
    if (!Number.isInteger(at?.x) || !Number.isInteger(at?.z)) throw new Error(`sim.spawn('${kindName}'): x and z must be fixed integers, e.g. { x: fx(10), z: fx(-4) }`);
    if (!sim.players[at.owner] && at.owner !== -1) throw new Error(`sim.spawn('${kindName}'): owner ${at.owner} is not a player (-1 = neutral)`);
    const e = { id: sim.nextId++, kind: k.index, owner: at.owner, x: at.x, z: at.z, facing: at.facing ?? 0, hp: k.hp, vx: 0, vz: 0, target: 0, state: 0, orders: [] };
    for (const [f, d] of Object.entries(sim.fieldDefaults)) e[f] = d;
    for (const s of sim.systems) s.spawned?.(sim, e);
    sim.entities.push(e); sim.byId.set(e.id, e);
    sim.emit({ type: 'spawn', id: e.id, kind: k.name, owner: e.owner });
    return e;
  };

  /** The kind object of an entity */
  sim.kindOf = e => sim.content.kinds[e.kind];
  /** The team of an entity (-1 for neutral) */
  sim.teamOf = e => e.owner < 0 ? -1 : sim.players[e.owner].team;
  /** Alive entity by id, or null */
  sim.get = id => { const e = sim.byId.get(id); return e && e.hp > 0 ? e : null; };
  /** Mark an entity dead; it leaves sim.entities at the end of the step */
  sim.kill = (e, by = 0) => {
    if (e.dead) return;
    e.hp = 0; e.dead = true;
    sim.emit({ type: 'death', id: e.id, kind: sim.kindOf(e).name, owner: e.owner, by });
    for (const s of sim.systems) s.killed?.(sim, e, by);   // every system hears of it now, whatever the install order
  };
  /** Record something that happened this tick, for drawing and sound (not hashed, not saved) */
  sim.emit = ev => { ev.tick = sim.tick; sim.events.push(ev); };

  /**
   * Run one tick. cmds: [{ p: player, t: type, ...args }] for this tick, any order; they are applied sorted by player (stable).
   * Returns this tick's events.
   */
  sim.step = (cmds = []) => {
    // sim.events already holds what happened since the last step (setup spawns, a kill from outside): systems see those too
    const sorted = cmds.map((c, i) => [c, i]).sort((a, b) => (a[0].p - b[0].p) || (a[1] - b[1])).map(a => a[0]);
    for (const c of sorted) sim.run(c);
    for (const s of sim.systems) s.step?.(sim);
    if (sim.entities.some(e => e.dead)) {
      sim.entities = sim.entities.filter(e => !e.dead);
      for (const [id, e] of sim.byId) if (e.dead) sim.byId.delete(id);
    }
    sim.tick++;
    const out = sim.events;
    sim.events = [];
    return out;
  };

  /** Apply one command now (validated). Returns '' or the reason it was refused. */
  sim.run = c => {
    const h = sim.commands.get(c?.t);
    let why = !h ? `unknown command '${c?.t}' (known: ${[...sim.commands.keys()].join(', ')})`
      : !sim.players[c.p] ? `player ${c.p} does not exist` : sim.players[c.p].left && c.t !== 'leave' ? `player ${c.p} has left` : '';
    if (!why) why = h.validate(sim, c) || '';
    if (why) { sim.rejected.push({ tick: sim.tick, p: c?.p, t: c?.t, why }); if (sim.rejected.length > 50) sim.rejected.shift(); return why; }
    h.apply(sim, c);
    return '';
  };

  /** Hash of the whole game state: tick, rng, players, every entity's fields and orders, every system's own state */
  sim.hash = () => {
    const h = new Hasher().int(sim.tick).int(sim.rng.state).int(sim.nextId);
    for (const p of sim.players) h.int(p.team).int(p.alive ? 1 : 0).int(p.left ? 1 : 0).int(p.res).int(p.score);
    for (const e of sim.entities) {
      for (const f of sim.fields) { const v = e[f]; if (Array.isArray(v)) { h.int(v.length); for (const x of v) h.int(x); } else h.int(v); }
      h.int(e.orders.length);
      for (const ord of e.orders) for (const k of Object.keys(ord).sort()) { h.str(k); const v = ord[k]; typeof v === 'string' ? h.str(v) : h.int(v); }
    }
    for (const s of sim.systems) s.hash?.(sim, h);
    return h.value;
  };

  /** A plain JSON copy of the state (with each system's own state), enough to rebuild the sim with restoreSim() */
  sim.snapshot = () => ({
    v: 1, tick: sim.tick, nextId: sim.nextId, seed: sim.seed, rng: sim.rng.state,
    players: sim.players.map(p => ({ ...p })),
    entities: structuredClone(sim.entities),
    systems: structuredClone(Object.fromEntries(sim.systems.filter(s => s.save).map(s => [s.name, s.save(sim)]))),
  });

  /** Replace the state with a snapshot taken from a sim with the same content, map and systems */
  sim.restore = snap => {
    if (snap?.v !== 1) throw new Error('sim.restore: not a sim snapshot (v 1)');
    sim.tick = snap.tick; sim.nextId = snap.nextId; sim.rng.state = snap.rng;
    sim.players = snap.players.map(p => ({ ...p }));
    sim.entities = structuredClone(snap.entities);
    sim.byId = new Map(sim.entities.map(e => [e.id, e]));
    for (const s of sim.systems) s.load?.(sim, snap.systems[s.name]);
    for (const s of sim.systems) s.afterLoad?.(sim, snap.systems[s.name]);   // second pass: state that depends on other systems' loaded state
  };

  /** Short plain summary: tick, time, hash, players with unit counts, recent refused commands, each system's own line */
  sim.describe = () => {
    const counts = sim.players.map(() => 0);
    for (const e of sim.entities) if (e.owner >= 0) counts[e.owner]++;
    const out = { tick: sim.tick, seconds: sim.tick / TICK_RATE, hash: hex(sim.hash()), entities: sim.entities.length,
      players: sim.players.map((p, i) => ({ name: p.name, team: p.team, units: counts[i], res: p.res, score: p.score, alive: p.alive, left: p.left })),
      rejected: sim.rejected.slice(-5) };
    for (const s of sim.systems) { const d = s.describe?.(sim); if (d !== undefined) out[s.name] = d; }
    return out;
  };

  /**
   * The current state as flat typed arrays for drawing: { n, id, kind, owner, x, z, y, facing, hp (0..1000 of max), flags }. Positions are
   * plain meters (floats) because only drawing reads them. flags bit 1: moving, bit 2: firing this tick.
   */
  sim.view = () => {
    const n = sim.entities.length, v = { tick: sim.tick, n, id: new Int32Array(n), kind: new Int16Array(n), owner: new Int8Array(n),
      x: new Float32Array(n), z: new Float32Array(n), y: new Float32Array(n), facing: new Uint16Array(n), hp: new Int16Array(n), flags: new Uint8Array(n) };
    sim.entities.forEach((e, i) => {
      const k = sim.kindOf(e);
      v.id[i] = e.id; v.kind[i] = e.kind; v.owner[i] = e.owner; v.x[i] = toFloat(e.x); v.z[i] = toFloat(e.z);
      v.y[i] = toFloat(sim.map.heightAt(e.x, e.z)); v.facing[i] = e.facing & 0xffff; v.hp[i] = Math.round((e.hp / k.hp) * 1000);
      v.flags[i] = (e.vx || e.vz ? 1 : 0) | (e.fired === sim.tick - 1 ? 2 : 0);
    });
    return v;
  };

  // a player who left (the relay inserts this after a long disconnect): their units drop their orders and stand; nothing they send counts
  sim.defineCommand('leave', {
    validate: () => '',
    apply(sim, c) {
      const p = sim.players[c.p];
      p.left = true;
      for (const e of sim.entities) if (e.owner === c.p) { e.orders.length = 0; e.target = 0; }
      sim.emit({ type: 'left', p: c.p });
    },
  });

  /** Install one more system (see installSystem) */
  sim.install = s => installSystem(sim, s);
  for (const s of o.systems ?? []) sim.install(s);
  return sim;
}

/**
 * Install a system: { name, init?(sim), step?(sim), hash?(sim, hasher), save?(sim), load?(sim, data), describe?(sim), spawned?(sim, entity) }.
 * Systems step in install order; that order is part of the game rules, so every machine installs the same list.
 */
export function installSystem(sim, s) {
  if (!s?.name) throw new Error('installSystem: a system needs a name');
  if (sim.systems.some(x => x.name === s.name)) throw new Error(`rts system '${s.name}' is installed twice`);
  const before = sim.entities.slice();
  sim.systems.push(s);
  s.init?.(sim);
  for (const e of before) s.spawned?.(sim, e);   // entities made by earlier systems' setup get this system's per-entity state too
}

/** Build a sim from a snapshot: createSim with the same options, then restore */
export function restoreSim(opts, snap) {
  const sim = createSim(opts);
  sim.restore(snap);
  return sim;
}

/** Seconds as whole ticks (rounded), for content and rules written in seconds */
export const ticks = seconds => Math.max(0, Math.round(seconds * TICK_RATE));

/** Meters per second as fixed meters per tick */
export const perTick = metersPerSecond => fx(metersPerSecond / TICK_RATE);
