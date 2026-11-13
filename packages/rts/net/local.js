// A match driver runs a sim in real time and takes the local player's commands. The engine's rts module only talks to a driver, so a
// single-player skirmish (this file) and an online lockstep match (lockstep.js) look the same to drawing and input code.
//
// Driver interface (both drivers):
//   driver.sim              the sim (read it; never change it directly)
//   driver.player           the local player index (-1 for an observer)
//   driver.issue(cmd)       queue a command from the local player: { t: 'move', ids, x, z, queue? } (p is filled in); returns '' or why refused
//   driver.update(seconds)  advance by real time: steps every tick that is due and allowed; returns { ticks, events } (events of all steps)
//   driver.alpha            0..1, how far real time is into the next tick (for drawing between ticks)
//   driver.status           'running' | 'waiting' (lockstep: the next turn has not arrived) | 'ended'
//   driver.log              every turn's commands so far: [{ turn, cmds }] (a replay; see replay.js)
//   driver.describe()       short plain state for tools
//
//   const driver = localDriver(sim, { player: 0 });
//   driver.issue({ t: 'move', ids: [3], x: fx(10), z: fx(0) });
//   const { events } = driver.update(1 / 60);
import { TICK_RATE } from '../content.js';

/** Ticks per turn: commands are grouped into turns of this many ticks (100 ms at 20 ticks per second) */
export const TURN_TICKS = 2;

/** Light checks on a command before it is queued, so a bad call from UI code fails at the call site, not silently inside the sim */
export function checkShape(cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return "a command is { t: 'move', ids: [...], x, z } (t is the command type)";
  for (const [k, v] of Object.entries(cmd)) {
    if (k === 't' || k === 'kind' || k === 'name') continue;
    if (k === 'ids' || k === 'kinds') { if (!Array.isArray(v)) return `${k} must be an array`; continue; }
    if (!Number.isInteger(v)) return `${k} must be an integer (positions are fixed: fx(meters))`;
  }
  return '';
}

/**
 * Single-player driver: commands apply at the start of the next turn, like online play, so a game feels the same offline.
 * @param {object} sim from createMatch
 * @param {{ player?: number, speed?: number }} [o] speed: game speed multiplier (1 = real time)
 */
export function localDriver(sim, o = {}) {
  let acc = 0, queued = [], pending = [];
  const d = {
    sim, player: o.player ?? 0, speed: o.speed ?? 1, status: 'running', log: [],
    get alpha() { return Math.min(1, acc * TICK_RATE); },
    issue(cmd) {
      const why = checkShape(cmd);
      if (why) return why;
      queued.push({ ...cmd, p: d.player });
      return '';
    },
    update(seconds) {
      const events = [];
      let ticks = 0;
      if (d.status === 'ended') return { ticks, events };
      acc += Math.max(0, seconds) * d.speed;
      const dt = 1 / TICK_RATE;
      while (acc >= dt && ticks < 10) {   // at most 10 ticks per update: a long frame catches up over a few frames, never a freeze
        if (sim.tick % TURN_TICKS === 0) {
          pending = queued; queued = [];
          d.log.push({ turn: sim.tick / TURN_TICKS, cmds: pending });
        }
        const cmds = sim.tick % TURN_TICKS === 0 ? pending : [];
        for (const ev of sim.step(cmds)) events.push(ev);
        acc -= dt; ticks++;
        if (sim.ended) { d.status = 'ended'; break; }
      }
      return { ticks, events };
    },
    describe: () => ({ driver: 'local', status: d.status, player: d.player, tick: sim.tick, queued: queued.length, speed: d.speed }),
  };
  return d;
}
