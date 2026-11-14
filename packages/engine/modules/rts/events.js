// Sim events -> engine events, in meters. The sim's events (fire, hit, death, spawn) carry fixed positions and, for a death, none at all; this adds where it happened
// and drops what happened where the local team sees nothing, so a game that draws effects from them does not show the fog's secrets.
import { toFloat, fx } from '@threedog/rts/fixed';
import { rowOf } from './views.js';

/**
 * @param {any} e engine
 * @param {any} sim
 * @param {import('./views.js').ViewPair} pair views after the update
 * @param {any} before the current view before the update (where a unit that died this tick last stood)
 * @param {any[]} events what driver.update returned
 * @param {number} team the local team (-1 sees all)
 */
export function reemit(e, sim, pair, before, events, team) {
  const V = sim.vision, seen = (x, z) => !V || V.visible(team, x, z);
  const whereId = id => {
    for (const v of [pair.cur, before]) { const r = rowOf(v, id); if (r >= 0) return { x: v.x[r], z: v.z[r] }; }
    return null;
  };
  for (const ev of events) {
    switch (ev.type) {
      case 'fire':
        if (seen(ev.x, ev.z) || seen(ev.tx, ev.tz)) e.events.emit('rts:fire', { id: ev.id, target: ev.target, weapon: ev.weapon, x: toFloat(ev.x), z: toFloat(ev.z), tx: toFloat(ev.tx), tz: toFloat(ev.tz), tick: ev.tick });
        break;
      case 'hit':
        if (seen(ev.x, ev.z)) e.events.emit('rts:hit', { id: ev.id, by: ev.by, damage: toFloat(ev.damage), x: toFloat(ev.x), z: toFloat(ev.z), tick: ev.tick });
        break;
      case 'death': {
        const at = whereId(ev.id);
        if (at && seen(fx(at.x), fx(at.z))) e.events.emit('rts:death', { id: ev.id, kind: ev.kind, owner: ev.owner, by: ev.by, x: at.x, z: at.z, tick: ev.tick });
        break;
      }
      case 'spawn': {
        const at = whereId(ev.id);
        if (at && seen(fx(at.x), fx(at.z))) e.events.emit('rts:spawn', { id: ev.id, kind: ev.kind, owner: ev.owner, x: at.x, z: at.z, tick: ev.tick });
        break;
      }
      default: break;
    }
  }
}
