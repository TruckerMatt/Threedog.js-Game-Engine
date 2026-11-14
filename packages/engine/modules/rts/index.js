// RTS module: draws and operates a match from @threedog/rts. The sim and its driver (local, or lockstep online) are the game's; this module is the page side:
// time (driver.update in the fixed step), drawing between ticks, selection, orders, fog and a minimap. The engine ships no art, no effects and no sounds: the game
// draws shots and deaths from the rts:fire / rts:hit / rts:death / rts:spawn events.
//
//   import { createMatch, localDriver, loadContent, createMap } from '@threedog/rts';
//   const sim = createMatch({ content: loadContent(raw), map: createMap({ width: 256, depth: 256 }), players: [{ team: 0 }, { team: 1 }] });
//   engine.use(rtsCamera({ dragPan: false }), rts({ driver: localDriver(sim, { player: 0 }), look: { tank: { geometry, material } } }));
//   engine.input.bind(presets.bindings.rts);
//   engine.rts.issue({ t: 'move', ids: engine.rts.selection, x: fx(10), z: fx(0) });
//
// Details and every option: recipes/67-rts.md.
import { fx } from '@threedog/rts/fixed';
import { codedError } from '../../core/base/errorHints.js';
import { readParams } from '../../core/base/params.js';
import { screenToGround } from '../../core/scene/screenToGround.js';
import { ViewPair } from './views.js';
import { UnitDraw, teamTints } from './draw.js';
import { Marks } from './marks.js';
import { Fog } from './fog.js';
import { Minimap } from './minimap.js';
import { Picker } from './pick.js';
import { Controls } from './controls.js';
import { reemit } from './events.js';
import { defineOps } from './ops.js';
import { STRINGS } from './strings.js';

const PARAMS = {
  driver: { type: 'object', desc: 'the match driver from @threedog/rts (localDriver(sim) or a lockstep driver); the module steps it and reads its sim' },
  look: { type: 'object', default: {}, desc: 'how each unit kind is drawn: { [kind]: { geometry?, material?, scale?, y? } }; "projectile" is the shot. A kind with no look is a gray box sized by its radius' },
  teamColors: { type: 'array', optional: true, desc: 'a color per team index (anything THREE.Color takes); without it each team is a different gray' },
  controls: { type: 'bool', default: true, desc: 'false turns off the built-in mouse and keys: the game calls engine.rts.select and engine.rts.issue itself' },
  minimap: { type: 'bool', default: true, desc: 'a minimap canvas in the lower-left corner (CSS class threedog-rts-minimap)' },
  fog: { type: 'bool', default: true, desc: 'a dark overlay on the ground for what the local team has not seen; false keeps only the fog texture' },
};
const MINIMAP_PX = 160;

/**
 * RTS match view and controls: units, selection, orders, fog, minimap -> engine.rts. See recipes/67-rts.md
 * @param {import('../../types/gameplay').RtsOptions} opts
 * @returns {import('../../types/core').ModuleDef<import('../../types/gameplay').Rts>}
 * @example engine.use(rts({ driver: localDriver(sim, { player: 0 }), teamColors: [0x3366cc, 0xcc3333] }));
 * @experimental
 */
export function rts(opts) {
  const o = readParams('rts', PARAMS, opts);
  let e = null, pair, draw, marks, fog, minimap, controls, picker, driver, sim;
  let list = Object.freeze([]), selected = new Set(), lastRefused = null;
  const team = () => sim.players[driver.player]?.team ?? -1;

  const api = {
    get driver() { return driver; },
    get sim() { return sim; },
    /** Entity ids of the selected units (read only: change it with select) */
    get selection() { return list; },
    /** The unit meshes by kind name (plain InstancedMesh: castShadow, layers, renderOrder are yours; a kind that outgrows its mesh gets a bigger one with these set copied) */
    get meshes() { return draw.meshes; },
    get ringMaterial() { return marks.ringMaterial; },
    get barMaterial() { return marks.barMaterial; },
    get barBackMaterial() { return marks.barBackMaterial; },
    get fog() { return fog; },
    select(ids) {
      if (!Array.isArray(ids)) throw codedError('module-params', 'engine.rts.select(ids): ids is an array of entity ids, e.g. engine.rts.select([3, 4])');
      const mine = driver.player, keep = [];
      for (const id of ids) { const u = sim.get(id); if (u && mine >= 0 && u.owner === mine && !keep.includes(id)) keep.push(id); }
      if (keep.length === list.length && keep.every((id, i) => id === list[i])) return list;
      list = Object.freeze(keep); selected = new Set(keep);
      return list;
    },
    issue(cmd) {
      const why = driver.issue(cmd);
      if (why) lastRefused = { t: cmd?.t, why };
      return why;
    },
  };

  /** Four corners of the camera's view on the ground, for the minimap (fewer when a corner looks past the horizon) */
  const footprint = () => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => screenToGround(e, x, y)).filter(Boolean);

  return {
    name: 'rts', skipKind: 'none', noSkip: 'the match runs in real time on its driver; a time jump does not advance it', type: 'rules', label: 'RTS', params: PARAMS, options: opts,
    optional: ['cameraRig'], stage: 'gameplay',
    install(engine, ctx) {
      e = engine; driver = o.driver; sim = driver.sim;
      if (!sim?.view || !sim.content) throw codedError('module-params', 'rts({ driver }): driver.sim must be a @threedog/rts sim, e.g. rts({ driver: localDriver(createMatch({ content, map, players }), { player: 0 }) })');
      e.i18n.add(STRINGS);
      pair = new ViewPair(sim);
      draw = new UnitDraw(e, sim, { look: o.look, teamColors: o.teamColors });
      ctx.track({ remove: () => draw.dispose() });
      marks = new Marks(e, sim);
      ctx.track({ remove: () => marks.dispose() });
      draw.refreshVisible(pair, team());
      draw.rememberShots();
      if (sim.vision && team() >= 0) {
        fog = new Fog(e, sim, team(), { overlay: o.fog });
        Object.assign(e.uniforms, fog.uniforms);   // for a game's own terrain shader: engine.uniforms.uRtsFog / uRtsFogBounds
        ctx.track({ remove: () => { delete e.uniforms.uRtsFog; delete e.uniforms.uRtsFogBounds; fog.dispose(); fog = null; } });
      }
      picker = new Picker(e, pair, sim);
      const goto = (x, z) => e.cameraRig?.moveTo?.({ x, z });
      if (o.minimap) {
        minimap = new Minimap(e, ctx, sim, team(), { size: MINIMAP_PX, tints: draw.tints, footprint, goto,
          order: (x, z, queue) => api.issue({ t: 'move', ids: list.slice(0, 500), x: fx(x), z: fx(z), ...(queue ? { queue: 1 } : {}) }) });
        ctx.track({ remove: () => { minimap = null; } });
      }
      if (o.controls) {
        controls = new Controls(e, api, ctx, { pair, picker, visible: () => draw.visible, alpha: () => driver.alpha });
        ctx.track({ remove: () => { controls = null; } });
      }
      ctx.track(e.onRender(() => {
        const a = driver.alpha, t = team();
        draw.units(pair, a);
        draw.projectiles(a, t);
        marks.draw(pair, a, selected, draw.visible, e.camera);
      }));
      defineOps(ctx, api);
      return api;
    },
    fixed(dt) {
      const before = pair.cur, { ticks, events } = driver.update(dt);
      if (!ticks) return;
      pair.advance();
      draw.refreshVisible(pair, team());
      draw.rememberShots();
      if (list.some(id => !sim.get(id))) api.select(list);   // the dead leave the selection
      fog?.update();
      reemit(e, sim, pair, before, events, team());
    },
    frame(dt) {
      controls?.frame();
      minimap?.draw(dt, pair, draw.visible);
    },
    describe() {
      const s = sim.describe();
      return { driver: driver.describe(), tick: sim.tick, player: driver.player, selection: list.length, units: pair.cur.n, drawn: draw.drawn, hash: s.hash, players: s.players, ...(s.rejected.length ? { rejected: s.rejected } : {}),
        fog: fog ? { sum: fog.sum, overlay: !!fog.mesh } : null, ...(lastRefused ? { lastRefused } : {}) };
    },
  };
}

export const handRolled = 'none: a crowd of units on a deterministic sim has no short code shape to detect; the module is the whole browser side';
