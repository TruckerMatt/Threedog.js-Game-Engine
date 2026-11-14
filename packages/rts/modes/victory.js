// How a match ends. Checked once a second; the first rule that fires sets sim.ended, sim.winner (a team, or -1 for a draw) and
// emits { type: 'end', winner, reason }. After that the sim keeps stepping (units still stand) but drivers report 'ended'.
//
//   victorySystem({ scoreLimit: 500, timeLimit: 20 * 60, annihilation: true })
//   annihilation: a team is out when it has no entities left and cannot get more (every player left, or sim.canRecover(team) says no)
import { TICK_RATE } from '../content.js';

/** @param {{ scoreLimit?: number, timeLimit?: number, annihilation?: boolean }} [o] timeLimit in seconds */
export function victorySystem(o = {}) {
  const annihilation = o.annihilation ?? true;
  return {
    name: 'victory',
    init(sim) { sim.ended = false; sim.winner = -1; sim.teamScore ??= Object.fromEntries(sim.teams.map(t => [t, 0])); },
    step(sim) {
      if (sim.ended || sim.tick % TICK_RATE !== 0 || sim.tick === 0) return;
      const end = (winner, reason) => { sim.ended = true; sim.winner = winner; sim.endReason = reason; sim.emit({ type: 'end', winner, reason }); };
      const alive = sim.teams.filter(t => !teamOut(sim, t, annihilation));
      if (alive.length === 1 && sim.teams.length > 1) return end(alive[0], 'last team standing');
      if (alive.length === 0) return end(-1, 'no team left');
      if (o.scoreLimit) {
        const over = sim.teams.filter(t => sim.teamScore[t] >= o.scoreLimit).sort((a, b) => (sim.teamScore[b] - sim.teamScore[a]) || (a - b));
        if (over.length) return end(over[0], `score limit ${o.scoreLimit}`);
      }
      if (o.timeLimit && sim.tick >= o.timeLimit * TICK_RATE) {
        const best = sim.teams.slice().sort((a, b) => (sim.teamScore[b] - sim.teamScore[a]) || (a - b));
        const tie = best.length > 1 && sim.teamScore[best[0]] === sim.teamScore[best[1]];
        return end(tie ? -1 : best[0], 'time limit');
      }
    },
    hash(sim, h) { h.int(sim.ended ? 1 : 0).int(sim.winner); },
    save: sim => ({ ended: sim.ended, winner: sim.winner, reason: sim.endReason ?? '' }),
    load(sim, d) { sim.ended = d.ended; sim.winner = d.winner; sim.endReason = d.reason; },
    describe: sim => sim.ended ? { ended: true, winner: sim.winner, reason: sim.endReason } : { ended: false, timeLeft: o.timeLimit ? Math.max(0, o.timeLimit - sim.tick / TICK_RATE) : null },
  };
}

function teamOut(sim, team, annihilation) {
  const players = sim.players.filter(p => p.team === team);
  if (players.every(p => p.left)) return true;
  if (!annihilation) return false;
  if (sim.entities.some(e => e.owner >= 0 && sim.players[e.owner].team === team && !e.dead)) return false;
  return !(sim.canRecover?.(team) ?? false);
}
