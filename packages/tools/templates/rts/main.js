// @ts-check
// __NAME__: RTS start (--rts) — a match against a bot. ?mode=reinforce (default, World in Conflict style: call in units, take the capture
// points), ?mode=base (C&C / StarCraft style: workers, buildings, production) or ?mode=mission (a scripted mission, sim/mission.js).
// sim/ is the game (units, map, rules: deterministic, rule R72); this file wires the page: camera, input, picture, HUD, and the driver.
// Online: open the page with ?relay=ws://localhost:8788&room=test (start the relay with npx threedog rts relay) in two browsers.
// Guide: node_modules/@threedog/rts/docs/RTS.md · engine side: node_modules/threedog/docs/recipes/67-rts.md
__TSL_IMPORT__
import { createEngine, presets, rts, rtsCamera } from 'threedog';
import { localDriver, lockstepDriver, webSocketTransport } from '@threedog/rts';
import { makeSim, buildHash, map } from './sim/index.js';
import { createPicture } from './picture/index.js';
import { createGround } from './picture/ground.js';
import { unitLooks, TEAM_COLORS, createEffects } from './picture/units.js';
import { createHud } from './ui/hud.js';
import { createBaseHud } from './ui/base-hud.js';

const engine = createEngine({ __RENDERER__canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });
const half = { x: map.width / 2 / 65536, z: map.depth / 2 / 65536 };   // map sizes are fixed-point (meters * 65536)
engine.use(rtsCamera({ height: 55, pitch: 0.95, dragPan: false, edgePan: true, bounds: { minX: -half.x, maxX: half.x, minZ: -half.z, maxZ: half.z }, start: [-205, 0, 0] }));
engine.input.bind({ ...presets.bindings.rts, ...presets.bindings.rtsRotate });
engine.use(createPicture());
createGround(engine, map);

const q = new URLSearchParams(location.search);
const online = q.get('relay');
const dev = !!(/** @type {any} */ (import.meta).env?.DEV);   // vite's dev server
const mode = /** @type {'reinforce' | 'base' | 'mission'} */ (q.get('mode') ?? 'reinforce');

/** Install the match view once a driver has a sim (an earlier match's view is removed first) */
const play = (/** @type {any} */ driver) => {
  for (const name of ['hud-base', 'hud-rts', 'effects', 'rts']) if (engine.modules.has(name)) engine.unuse(name);
  engine.use(rts({ driver, look: unitLooks(), teamColors: TEAM_COLORS }), createEffects(), driver.sim.base ? createBaseHud(driver) : createHud(driver));
  if (!online || dev) Object.assign(window, { driver });   // an online production build hands nothing to the console
};

/**
 * A single-player match against the bot (or the mission's scripted enemy): you are player 0 on team 0. Called once at startup with ?mode= and
 * ?seed=; call it again to switch (a restart button, or an agent: npx threedog js "startMatch('base', 7)").
 * @param {'reinforce' | 'base' | 'mission'} mode @param {number} seed
 */
function startMatch(mode, seed) {
  const enemy = mode === 'mission' ? { name: 'Enemy', team: 1 } : { name: 'Bot', team: 1, bot: { level: /** @type {any} */ (q.get('bot') ?? 'normal') } };   // the mission script drives its enemy
  const driver = localDriver(makeSim({ seed, mode, players: [{ name: 'You', team: 0 }, enemy] }), { player: 0 });
  play(driver);
  if (mode === 'base') {   // the starting workers go to the nearest crystal field, as players expect
    const sim = driver.sim, workers = sim.entities.filter(e => e.owner === 0 && sim.kindOf(e).gather);
    const fields = sim.entities.filter(e => e.owner < 0 && sim.kindOf(e).tags.includes('resource'));
    const w0 = workers[0], near = w0 && fields.sort((a, b) => Math.hypot(a.x - w0.x, a.z - w0.z) - Math.hypot(b.x - w0.x, b.z - w0.z))[0];
    if (near) driver.issue({ t: 'gather', ids: workers.map(e => e.id), target: near.id });
  }
  return mode;
}

// tests, shots and the console rely on window.engine. An online match in a production build leaves it out: every client holds the whole
// state in lockstep, so this is no real protection against a determined cheater, but it closes the one-line console route
if (!online || dev) Object.assign(window, { engine });
if (!online) {
  // installed before start, so tools that jump time (npx threedog shot --wait 60) see the match play forward
  startMatch(mode, Number(q.get('seed') ?? 1));
  Object.assign(window, { startMatch });
  await engine.start();
} else {
  await engine.start();
  const room = q.get('room') ?? 'default';
  const driver = lockstepDriver({ transport: webSocketTransport(`${online.replace(/\/$/, '')}/${room}`), room, name: q.get('name') ?? 'player',
    version: '__NAME__-1', contentHash: buildHash, mapHash: map.hash, makeSim });
  const lobby = createHud.lobby(driver, mode);     // ready / start buttons until the relay starts the match (the host's ?mode= is the match's)
  await new Promise(ok => driver.on('start', ok));
  lobby.remove();
  play(driver);
}
