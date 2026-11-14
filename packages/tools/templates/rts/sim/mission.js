// __NAME__ mission 1, "Hold the North Ford": a scripted mission written as one sim system, with no engine code. Pattern for a campaign:
// phases advance on sim facts (a point taken, a timer, units lost), enemy waves are spawned and ordered with the same commands a player
// uses, and the HUD reads sim.mission (objective text, last message). Deterministic like all of sim/ (rule R72): it saves, replays and
// could even run online. Player 0 is you; player 1 is the scripted enemy (no bot: the script is its brain).
//
// Phases: 0 take the ford → 1 hold it for HOLD_S seconds while waves come every WAVE_S seconds → won; you lose if your forces are wiped
// out (no units, not enough points to call more).
import { fx } from '@threedog/rts';

const HOLD_S = 180, WAVE_S = 40, ENEMY_EDGE_X = 280;

/** The waves, in order (the last one repeats); kinds from sim/content.js */
const WAVES = [
  ['rifleman', 'rifleman', 'rifleman', 'rifleman'],
  ['rifleman', 'rifleman', 'rifleman', 'scout', 'scout'],
  ['tank', 'rifleman', 'rifleman', 'rifleman', 'rifleman'],
  ['tank', 'tank', 'artillery', 'rifleman', 'rifleman', 'rifleman'],
];

export function missionSystem() {
  return {
    name: 'mission',
    init(sim) {
      sim.ended = false; sim.winner = -1;
      sim.mission = { phase: 0, until: 0, nextWave: 0, wave: 0, objective: 'Take the North Ford', message: 'Enemy forces are moving on the river. Take the North Ford before they do.' };
      sim.emit({ type: 'mission', text: sim.mission.message });
    },
    step(sim) {
      const M = sim.mission, rate = sim.tickRate;
      if (sim.ended || sim.tick % 5) return;   // 4 checks a second are plenty
      const ford = sim.capture.points.find(p => p.id === 'north-ford');
      const say = text => { M.message = text; sim.emit({ type: 'mission', text }); };
      if (M.phase === 0 && ford.holder === 0 && ford.amount === 100) {
        M.phase = 1; M.until = sim.tick + HOLD_S * rate; M.nextWave = sim.tick + 10 * rate;
        M.objective = `Hold the North Ford for ${HOLD_S / 60} minutes`;
        say('The ford is ours. Their counterattack is coming from the east: hold it!');
      }
      if (M.phase === 1) {
        if (sim.tick >= M.nextWave) { wave(sim, M, ford); M.nextWave = sim.tick + WAVE_S * rate; }
        const left = Math.max(0, Math.ceil((M.until - sim.tick) / rate));
        M.objective = `Hold the North Ford: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left${ford.holder === 0 && ford.amount === 100 ? '' : ' (retake it!)'}`;
        if (sim.tick >= M.until && ford.holder === 0) { say('The ford held. Mission complete.'); end(sim, 0, 'mission complete'); return; }
        if (sim.tick >= M.until) M.until = sim.tick + rate;   // time is up but the ford is not ours: keep going until it is
      }
      const mine = sim.entities.some(e => e.owner === 0 && !e.dead);
      if (!mine && !sim.canRecover?.(0)) { say('Our forces are gone. Mission failed.'); end(sim, 1, 'mission failed'); }
    },
    hash(sim, h) { const M = sim.mission; h.int(M.phase).int(M.until).int(M.nextWave).int(M.wave).int(sim.ended ? 1 : 0).int(sim.winner); },
    save: sim => ({ ...sim.mission, ended: sim.ended, winner: sim.winner }),
    load(sim, d) { const { ended, winner, ...m } = d; sim.mission = m; sim.ended = ended; sim.winner = winner; },
    describe: sim => ({ phase: sim.mission.phase, objective: sim.mission.objective, wave: sim.mission.wave }),
  };
}

/** Spawn the next wave on the east edge and send it at the ford with an attack-move, as a player would */
function wave(sim, M, ford) {
  const kinds = WAVES[Math.min(M.wave, WAVES.length - 1)], ids = [];
  kinds.forEach((k, i) => ids.push(sim.spawn(k, { owner: 1, x: fx(ENEMY_EDGE_X), z: ford.z + fx((i - kinds.length / 2) * 4), facing: 32768 }).id));
  M.wave++;
  sim.run({ p: 1, t: 'amove', ids, x: ford.x, z: ford.z });
  sim.emit({ type: 'mission', text: `Wave ${M.wave} sighted on the east road.` });
  M.message = `Wave ${M.wave} sighted on the east road.`;
}

function end(sim, winner, reason) {
  sim.ended = true; sim.winner = winner; sim.endReason = reason;
  sim.emit({ type: 'end', winner, reason });
}
