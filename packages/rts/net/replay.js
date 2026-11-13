// Replays: a match is its settings plus every turn's commands, so a replay file is small (kilobytes for a long match) and playing it back is
// running the sim again. Hashes recorded every HASH_EVERY turns let a replay double as a determinism test: play it in another browser or
// after a code change, and the first hash that differs is where behavior changed.
//
//   const rep = makeReplay(driver, { version: '1.0.0' });         // from any driver (driver.log), after or during a match
//   localStorage.setItem('last', JSON.stringify(rep));
//   const check = verifyReplay(rep, settings => buildMatch(settings));   // { ok, turns, firstMismatch }
//   const player = replayDriver(buildMatch(rep.settings), rep, { speed: 4 });   // a driver: plug it into engine.use(rts({ driver: player }))
import { TURN_TICKS } from './local.js';
import { HASH_EVERY } from './protocol.js';
import { TICK_RATE } from '../content.js';

/** Bump when the replay format changes */
export const REPLAY_VERSION = 1;

/**
 * Build a replay from a driver's log. Hashes are recomputed by replaying, so they reflect the sim, not what a client claimed.
 * @param {{ sim: object, log: Array<{ turn: number, cmds: Array<object> }>, settings?: object }} driver
 * @param {{ version?: string, settings?: object, makeSim?: (s: object) => object }} [o] makeSim: also record hashes (needs a fresh sim)
 */
export function makeReplay(driver, o = {}) {
  const settings = o.settings ?? driver.settings ?? null;
  const rep = { v: REPLAY_VERSION, version: o.version ?? '', settings, contentHash: driver.sim.content.hash, mapHash: driver.sim.map.hash,
    turns: driver.log.filter(t => t.cmds.length).map(t => [t.turn, t.cmds]), lastTurn: driver.log.length ? driver.log[driver.log.length - 1].turn : -1, hashes: [] };
  if (o.makeSim) rep.hashes = run(rep, o.makeSim(settings)).hashes;
  return rep;
}

function run(rep, sim, stopAt = rep.lastTurn) {
  const byTurn = new Map(rep.turns), hashes = [];
  for (let turn = 0; turn <= stopAt; turn++) {
    for (let i = 0; i < TURN_TICKS; i++) sim.step(i === 0 ? byTurn.get(turn) ?? [] : []);
    if (turn % HASH_EVERY === 0) hashes.push([turn, sim.hash()]);
  }
  return { sim, hashes };
}

/**
 * Play a replay headless and compare with its recorded hashes.
 * @returns {{ ok: boolean, turns: number, firstMismatch: null | { turn: number, want: number, got: number }, sim: object }}
 */
export function verifyReplay(rep, makeSim) {
  if (rep?.v !== REPLAY_VERSION) throw new Error(`verifyReplay: replay format ${rep?.v}, this build reads ${REPLAY_VERSION}`);
  const sim = makeSim(rep.settings);
  if (sim.content.hash !== rep.contentHash) return { ok: false, turns: 0, firstMismatch: null, sim, why: 'content differs from the recording (another game build)' };
  if (sim.map.hash !== rep.mapHash) return { ok: false, turns: 0, firstMismatch: null, sim, why: 'map differs from the recording' };
  const { hashes } = run(rep, sim);
  const want = new Map(rep.hashes);
  for (const [turn, got] of hashes) if (want.has(turn) && want.get(turn) !== got) return { ok: false, turns: rep.lastTurn + 1, firstMismatch: { turn, want: want.get(turn), got }, sim };
  return { ok: true, turns: rep.lastTurn + 1, firstMismatch: null, sim };
}

/**
 * A driver that plays a replay in real time (same interface as localDriver): speed multiplies time; seek(turn) jumps (forward: runs
 * ahead; backward: needs makeSim to start over). Orders are refused (issue returns why).
 * @param {object} sim a fresh sim from makeSim(rep.settings)
 * @param {object} rep
 * @param {{ speed?: number, makeSim?: (s: object) => object }} [o]
 */
export function replayDriver(sim, rep, o = {}) {
  const byTurn = new Map(rep.turns);
  let acc = 0;
  const d = {
    sim, player: -1, speed: o.speed ?? 1, status: 'running', log: [], paused: false,
    get alpha() { return Math.min(1, acc * TICK_RATE); },
    issue: () => 'a replay takes no orders',
    update(seconds) {
      const events = [];
      let ticks = 0;
      if (d.paused || d.status === 'ended') return { ticks, events };
      acc += Math.max(0, seconds) * d.speed;
      const dt = 1 / TICK_RATE;
      while (acc >= dt && ticks < 200) {
        if (Math.floor(d.sim.tick / TURN_TICKS) > rep.lastTurn) { d.status = 'ended'; break; }
        stepOne(events); acc -= dt; ticks++;
      }
      return { ticks, events };
    },
    /** Jump to the start of `turn` */
    seek(turn) {
      if (turn * TURN_TICKS < d.sim.tick) {
        if (!o.makeSim) throw new Error('replayDriver.seek backward needs makeSim in the options');
        d.sim = o.makeSim(rep.settings);
      }
      while (d.sim.tick < turn * TURN_TICKS) stepOne([]);
      acc = 0; d.status = 'running';
    },
    describe: () => ({ driver: 'replay', status: d.status, tick: d.sim.tick, turn: Math.floor(d.sim.tick / TURN_TICKS), lastTurn: rep.lastTurn, speed: d.speed }),
  };
  function stepOne(events) {
    const t = d.sim.tick, cmds = t % TURN_TICKS === 0 ? byTurn.get(t / TURN_TICKS) ?? [] : [];
    for (const ev of d.sim.step(cmds)) events.push(ev);
  }
  return d;
}
