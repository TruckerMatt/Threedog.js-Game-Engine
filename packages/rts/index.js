// @threedog/rts: the deterministic RTS simulation. No three.js, no DOM: the same code runs in the page, in a worker and in Node, and gives
// the same hash on every machine. Drawing, input and networking read it; only commands change it.
//
//   import { createMatch, loadContent, createMap, fx } from '@threedog/rts';
//   const sim = createMatch({ seed: 1, content: loadContent(raw), map: createMap({ width: 256, depth: 256 }), players: [{ team: 0 }, { team: 1 }] });
//   sim.step([{ p: 0, t: 'move', ids: [1], x: fx(20), z: fx(0) }]);
//
// The guide for agents is docs/RTS.md in this package.
import { createSim } from './sim.js';
import { spatialSystem } from './spatial.js';
import { visionSystem } from './vision.js';
import { unitsSystem } from './units.js';
import { combatSystem } from './combat.js';

export * from './fixed.js';
export { Rng } from './rng.js';
export { Hasher, hashString, hex } from './hash.js';
export { loadContent, armorFactor, TICK_RATE } from './content.js';
export { createMap, mapFromJSON } from './map.js';
export { createSim, installSystem, restoreSim, ticks, perTick } from './sim.js';
export { flowField, openCellNear } from './flowfield.js';
export { spatialSystem } from './spatial.js';
export { visionSystem } from './vision.js';
export { unitsSystem, formation, IDLE, MOVING, ENGAGING, HOLDING, MAX_IDS } from './units.js';
export { combatSystem } from './combat.js';

/**
 * The standard system list in its fixed order: spatial → vision → units → combat, then `extra` (game modes, AI, the game's own systems).
 * Every machine in a match must install the same list in the same order.
 * @param {{ vision?: object, extra?: Array<object> }} [o]
 */
export function defaultSystems(o = {}) {
  return [spatialSystem(), visionSystem(o.vision), unitsSystem(), combatSystem(), ...(o.extra ?? [])];
}

/**
 * A sim with the standard systems: createSim plus defaultSystems. Same options as createSim, plus `systems` options for defaultSystems.
 * @param {{ seed?: number, content: object, map: object, players: Array<object>, vision?: object, extra?: Array<object> }} o
 */
export function createMatch(o) {
  return createSim({ ...o, systems: defaultSystems(o) });
}
