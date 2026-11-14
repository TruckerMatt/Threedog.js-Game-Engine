// skirmish's match builder: the ONE place a match is made. Single player, online play (the relay's settings), replays and the CLI
// (npx threedog rts match / desync / browsers) all call makeSim, so every machine builds the same sim from the same settings.
// Everything in sim/ runs inside the lockstep simulation: rule R72 checks it (no Math.sin / random / Date / DOM / three.js here).
// settings.mode: 'reinforce' (World in Conflict style, default), 'base' (C&C / StarCraft style) or 'mission' (the scripted mission in mission.js)
import { createMatch, loadContent, reinforceSystem, captureSystem, baseSystem, victorySystem, botSystem } from '@threedog/rts';
import raw from './content.js';
import baseRaw from './base-content.js';
import { map, zones, points, bases } from './map.js';
import { missionSystem } from './mission.js';

export const content = loadContent(raw);
export const baseContent = loadContent(baseRaw);
export { map };
/** What every player's build must agree on (the lobby refuses a client whose game differs) */
export const buildHash = (content.hash ^ baseContent.hash) >>> 0;

/**
 * @param {{ seed: number, mode?: 'reinforce' | 'base' | 'mission', players: Array<{ name?: string, team: number, bot?: { level: 'easy' | 'normal' | 'hard' } }> }} settings
 */
export function makeSim(settings) {
  const players = settings.players;
  if (settings.mode === 'base') {
    return createMatch({ seed: settings.seed, content: baseContent, map, players, extra: [
      baseSystem({ startRes: 500, start: players.map((_, p) => ({ p, ...bases[p % bases.length], kinds: ['hq', 'worker', 'worker', 'worker', 'worker'] })),
        resources: bases.slice(0, players.length).flatMap(b => [{ kind: 'crystal', x: b.x + (b.x < 0 ? 30 : -30), z: b.z + 20 }, { kind: 'crystal', x: b.x + (b.x < 0 ? 30 : -30), z: b.z - 20 }])
          .concat([{ kind: 'crystal', x: 0, z: 0 }]) }),
      victorySystem({ timeLimit: 30 * 60 }),
      botSystem(),
    ] });
  }
  if (settings.mode === 'mission') {
    return createMatch({ seed: settings.seed, content, map, players, extra: [
      reinforceSystem({ budget: 900, deployDelay: 6, refundDelay: 30, zones: zones.slice(0, 1), start: [{ p: 0, kinds: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'tank', 'tank'] }] }),
      captureSystem({ points: points.filter(p => p.id === 'north-ford') }),
      missionSystem(),
    ] });
  }
  return createMatch({ seed: settings.seed, content, map, players, extra: [
    reinforceSystem({ budget: 1500, deployDelay: 6, refundDelay: 20, zones,
      start: players.map((_, p) => ({ p, kinds: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'tank'] })) }),
    captureSystem({ points }),
    victorySystem({ scoreLimit: 300, timeLimit: 15 * 60 }),
    botSystem(),
  ] });
}
