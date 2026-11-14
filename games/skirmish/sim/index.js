// skirmish's match builder: the ONE place a match is made. Single player, online play (the relay's settings), replays and the CLI
// (npx threedog rts match / desync / browsers) all call makeSim, so every machine builds the same sim from the same settings.
// Everything in sim/ runs inside the lockstep simulation: rule R72 checks it (no Math.sin / random / Date / DOM / three.js here).
import { createMatch, loadContent, reinforceSystem, captureSystem, victorySystem, botSystem } from '@threedog/rts';
import raw from './content.js';
import { map, zones, points } from './map.js';

export const content = loadContent(raw);
export { map };

/**
 * @param {{ seed: number, players: Array<{ name?: string, team: number, bot?: { level: 'easy' | 'normal' | 'hard' } }> }} settings
 */
export function makeSim(settings) {
  return createMatch({ seed: settings.seed, content, map, players: settings.players, extra: [
    reinforceSystem({ budget: 1500, deployDelay: 6, refundDelay: 20, zones,
      start: settings.players.map((_, p) => ({ p, kinds: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'tank'] })) }),
    captureSystem({ points }),
    victorySystem({ scoreLimit: 300, timeLimit: 15 * 60 }),
    botSystem(),
  ] });
}
