// @ts-check
// skirmish: RTS start (--rts) — a World in Conflict-style reinforcement match against a bot: call in units, take the capture points.
// sim/ is the game (units, map, rules: deterministic, rule R72); this file wires the page: camera, input, picture, HUD, and the driver.
// Online: open the page with ?relay=ws://localhost:8788&room=test (start the relay with npx threedog rts relay) in two browsers.
// Guide: node_modules/@threedog/rts/docs/RTS.md · engine side: node_modules/threedog/docs/recipes/67-rts.md
import 'threedog/tsl';   // first import: this game runs on WebGPU and writes shaders in TSL, recipe 56. A browser without WebGPU runs the same game on three's WebGL2 backend (slower); engine.describe().renderer says which and why
import { createEngine, presets, rts, rtsCamera } from 'threedog';
import { localDriver, lockstepDriver, webSocketTransport } from '@threedog/rts';
import { makeSim, content, map } from './sim/index.js';
import { createPicture } from './picture/index.js';
import { createGround } from './picture/ground.js';
import { unitLooks, TEAM_COLORS, createEffects } from './picture/units.js';
import { createHud } from './ui/hud.js';

const engine = createEngine({ renderer: 'webgpu', canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: { title: 'skirmish' } }, saveKey: 'skirmish' });
const half = { x: map.width / 2 / 65536, z: map.depth / 2 / 65536 };   // map sizes are fixed-point (meters * 65536)
engine.use(rtsCamera({ height: 55, pitch: 0.95, dragPan: false, edgePan: true, bounds: { minX: -half.x, maxX: half.x, minZ: -half.z, maxZ: half.z }, start: [-205, 0, 0] }));
engine.input.bind({ ...presets.bindings.rts, ...presets.bindings.rtsRotate });
engine.use(createPicture());
createGround(engine, map);

const q = new URLSearchParams(location.search);
const online = q.get('relay');

/** Install the match view once a driver has a sim */
const play = (/** @type {any} */ driver) => {
  engine.use(rts({ driver, look: unitLooks(), teamColors: TEAM_COLORS }), createEffects(), createHud(driver));
  Object.assign(window, { driver });
};

Object.assign(window, { engine });   // tests, shots and the console rely on it
if (!online) {
  // single player: you are player 0 (team 0), the bot is player 1; ?seed=7 replays the same match. Installed before start, so tools that
  // jump time (npx threedog shot --wait 60) see the match play forward
  play(localDriver(makeSim({ seed: Number(q.get('seed') ?? 1), players: [{ name: 'You', team: 0 }, { name: 'Bot', team: 1, bot: { level: /** @type {any} */ (q.get('bot') ?? 'normal') } }] }), { player: 0 }));
  await engine.start();
} else {
  await engine.start();
  const room = q.get('room') ?? 'default';
  const driver = lockstepDriver({ transport: webSocketTransport(`${online.replace(/\/$/, '')}/${room}`), room, name: q.get('name') ?? 'player',
    version: 'skirmish-1', contentHash: content.hash, mapHash: map.hash, makeSim });
  const lobby = createHud.lobby(driver);           // ready / start buttons until the relay starts the match
  await new Promise(ok => driver.on('start', ok));
  lobby.remove();
  play(driver);
}
