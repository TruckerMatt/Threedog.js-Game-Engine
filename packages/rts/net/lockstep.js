// Lockstep client: the online match driver (same interface as localDriver, see local.js). Every client runs the whole sim; only commands
// travel. The relay sends one turn every 100 ms; a turn's commands apply at its first tick, and a client never runs a tick whose turn has
// not arrived (status 'waiting'). It holds back `buffer` turns (adapts 1..4 to the connection's jitter) so play stays smooth, runs extra
// ticks per frame to catch up after a stall or a rejoin, and reports its hash every HASH_EVERY turns; the relay compares them.
//
//   const net = lockstepDriver({ transport: webSocketTransport('wss://relay.example/room-1'), room: 'room-1', name: 'Matt',
//     version: '1.0.0', contentHash: content.hash, mapHash: map.hash,
//     makeSim: settings => buildMatch(settings) });       // the game builds the sim from the relay's settings (seed, players, ...)
//   net.on('lobby', l => drawLobby(l)); net.ready(true); net.start({ mode: 'reinforce' });   // host starts
//   net.on('desync', d => console.warn('desync at turn', d.turn, net.dump(d.turn)));
import { PROTOCOL, HASH_EVERY } from './protocol.js';
import { TURN_TICKS, checkShape } from './local.js';
import { TICK_RATE } from '../content.js';

const CATCHUP_PER_UPDATE = 200;   // most ticks one update may run while catching up (keeps the page responsive)

/**
 * @param {{ transport: object, makeSim: (settings: object) => object, room?: string, name?: string, version?: string, contentHash?: number,
 *   mapHash?: number, observer?: boolean, key?: string, buffer?: number, debugSnapshots?: boolean, now?: () => number }} o
 *   key: rejoin a running match with the key from the 'welcome' message (kept in driver.key); debugSnapshots: keep the state at the
 *   last few hash turns so driver.dump(turn) can show what diverged
 */
export function lockstepDriver(o) {
  if (!o?.transport || typeof o.makeSim !== 'function') throw new Error('lockstepDriver: transport and makeSim(settings) are required');
  const tr = o.transport, now = o.now ?? (() => performance.now());   // measure: buffer adaptation only, never game state
  const listeners = new Map(), turns = new Map(), snaps = new Map(), netEvents = [];
  let acc = 0, received = -1, lastWait = 0, buffer = o.buffer ?? 1, adaptive = o.buffer === undefined;
  const d = {
    sim: null, transport: tr, player: -1, key: o.key ?? '', status: 'connecting', lobby: null, settings: null, desyncs: [], log: [],
    get alpha() { return Math.min(1, acc * TICK_RATE); },
    get buffer() { return buffer; },
    /** Listen to a network event: 'welcome', 'lobby', 'start', 'desync', 'away', 'back', 'error', 'close' */
    on(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn); return { remove: () => listeners.set(type, listeners.get(type).filter(f => f !== fn)) }; },
    setSlot(s) { tr.send({ type: 'slot', ...s }); },
    ready(r = true) { tr.send({ type: 'ready', ready: !!r }); },
    start(settings = {}) { tr.send({ type: 'start', settings }); },
    issue(cmd) {
      if (d.player < 0) return 'observers cannot give orders';
      if (!d.sim) return 'the match has not started';
      const why = checkShape(cmd);
      if (why) return why;
      tr.send({ type: 'cmd', cmds: [cmd] });
      return '';
    },
    update(seconds) {
      const events = netEvents.splice(0);
      let ticks = 0;
      const sim = d.sim;
      if (!sim || d.status === 'ended' || d.status === 'closed') return { ticks, events };
      acc += Math.max(0, seconds);
      const dt = 1 / TICK_RATE, have = (received + 1) * TURN_TICKS;   // ticks whose turn has arrived
      const end = have - buffer * TURN_TICKS;
      // far behind (rejoin, a long stall, a slow machine): run extra ticks now
      if (end - sim.tick > 3 * TURN_TICKS) {
        while (sim.tick < end && ticks < CATCHUP_PER_UPDATE) { runTick(events); ticks++; }
        acc = Math.min(acc, dt);
      }
      while (acc >= dt && sim.tick < end && ticks < CATCHUP_PER_UPDATE) { runTick(events); acc -= dt; ticks++; }
      if (sim.ended) d.status = 'ended';
      else if (acc >= dt) {   // time is due but the turn is not here
        d.status = 'waiting'; acc = dt;
        if (adaptive && buffer < 4 && now() - lastWait < 2000) buffer++;
        lastWait = now();
      } else {
        d.status = 'running';
        if (adaptive && buffer > 1 && now() - lastWait > 10000) { buffer--; lastWait = now(); }
      }
      return { ticks, events };
    },
    /** The snapshot kept at a hash turn (debugSnapshots: true), to compare with another client's after a desync */
    dump: turn => snaps.get(turn) ?? null,
    close() { tr.close(); d.status = 'closed'; },
    describe: () => ({ driver: 'lockstep', status: d.status, player: d.player, tick: d.sim?.tick ?? 0, turn: d.sim ? Math.floor(d.sim.tick / TURN_TICKS) : -1,
      received, buffer, behindTurns: d.sim ? Math.max(0, received + 1 - Math.ceil(d.sim.tick / TURN_TICKS)) : 0, desyncs: d.desyncs.length }),
  };

  function runTick(events) {
    const sim = d.sim, t = sim.tick, turn = Math.floor(t / TURN_TICKS), first = t % TURN_TICKS === 0;
    const cmds = first ? turns.get(turn) ?? [] : [];
    if (first) { d.log.push({ turn, cmds }); turns.delete(turn); }
    for (const ev of sim.step(cmds)) events.push(ev);
    if ((t + 1) % TURN_TICKS === 0 && turn % HASH_EVERY === 0) {
      if (d.player >= 0) tr.send({ type: 'hash', turn, hash: sim.hash() });
      if (o.debugSnapshots) { snaps.set(turn, sim.snapshot()); for (const k of snaps.keys()) if (k < turn - HASH_EVERY * 3) snaps.delete(k); }
    }
  }

  const emit = (type, m) => { for (const fn of listeners.get(type) ?? []) fn(m); };
  tr.onOpen = () => tr.send({ type: 'hello', protocol: PROTOCOL, room: o.room, name: o.name, version: o.version ?? '', contentHash: o.contentHash ?? 0,
    mapHash: o.mapHash ?? 0, observer: !!o.observer, key: o.key || undefined });
  tr.onClose = () => { if (d.status !== 'ended') d.status = 'closed'; emit('close', {}); };
  tr.onMessage = m => {
    switch (m.type) {
      case 'welcome': d.player = m.you; d.key = m.key; if (d.status === 'connecting') d.status = 'lobby'; break;
      case 'lobby': d.lobby = m; break;
      case 'start':
        d.settings = m.settings; d.player = m.you;
        d.sim = o.makeSim(m.settings);
        if (!d.sim?.step) throw new Error('lockstepDriver: makeSim(settings) must return a sim');
        d.status = 'running'; acc = 0;
        break;
      case 'turn': turns.set(m.turn, m.cmds); received = contiguous(); break;
      case 'catchup': for (const [t, c] of m.turns) turns.set(t, c); received = m.upTo; break;
      case 'desync': d.desyncs.push(m); netEvents.push({ type: 'desync', turn: m.turn, hashes: m.hashes }); break;
      case 'away': case 'back': netEvents.push({ type: m.type, p: m.p }); break;
      case 'error': netEvents.push({ type: 'net-error', code: m.code, msg: m.msg }); break;
      default: break;
    }
    emit(m.type, m);
  };

  // turns arrive in order on one connection; after a catchup the gap turns are empty by definition
  function contiguous() { let r = received; while (turns.has(r + 1)) r++; return r; }

  return d;
}
