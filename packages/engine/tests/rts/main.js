// RTS page (tests/specs/rts.mjs): a small match over a localDriver, the rts() module drawing it, selection, orders, fog, events, ops and unuse.
import * as THREE from 'three';
import { createEngine, rts, rtsCamera, presets } from '../../index.js';
import { createMatch, localDriver, loadContent, createMap, fx } from '@threedog/rts';

const W = 320, H = 240;
const base = { lights: false, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false };
let n = 0;

const content = loadContent({
  armor: { plain: { bullet: 1 } },
  weapons: { rifle: { range: 14, damage: 40, cooldown: 0.5, damageType: 'bullet' } },
  units: {
    grunt: { hp: 100, speed: 6, radius: 0.6, sight: 20, armor: 'plain', weapons: ['rifle'] },
    dummy: { hp: 30000, speed: 0, radius: 0.6, sight: 20, armor: 'plain' },   // a target that never dies and never shoots
    glass: { hp: 30, speed: 0, radius: 0.6, sight: 20, armor: 'plain' },       // dies from one rifle shot
  },
});

/** A match: player 0 owns grunts a (-20, 0) and b (-10, 10); player 1 owns dummies near (-20, -14), 14 m from a (about 70 px on screen), in sight, and far (40, 40), out of everyone's sight */
function match() {
  const sim = createMatch({ seed: 3, content, map: createMap({ width: 128, depth: 128 }), players: [{ team: 0 }, { team: 1 }] });
  const at = (owner, x, z, kind = 'grunt') => sim.spawn(kind, { owner, x: fx(x), z: fx(z) });
  const a = at(0, -20, 0), b = at(0, -10, 10), near = at(1, -20, -14, 'dummy'), far = at(1, 40, 40, 'dummy');
  return { sim, a, b, near, far };
}

async function make(opts = {}, m = match()) {
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  document.body.appendChild(c);
  const e = createEngine({ canvas: c, ...base, saveKey: `test-rts-${++n}` });
  e.use(rtsCamera({ height: 50, dragPan: false, edgePan: false }));
  e.input.bind(presets.bindings.rts);
  e.use(rts({ driver: localDriver(m.sim, { player: 0 }), ...opts }));
  await e.start();
  e.haltLoop();
  e.step(0.05);
  return { e, ...m };
}

const meshOf = (e, kind = 'grunt') => e.rts.meshes[kind];
const row = (mesh, i) => Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16));
const ndcOf = (e, x, z) => { const v = new THREE.Vector3(x, 0.5, z).project(e.camera); return [v.x, v.y]; };
const clickAt = (e, [x, y], opts = {}) => {
  e.input.pointer.ndcX = x; e.input.pointer.ndcY = y;
  e.input.simulate(opts.action ?? 'rts.select', true); e.step(1 / 30, { describe: false });
  e.input.simulate(opts.action ?? 'rts.select', false); e.step(1 / 30, { describe: false });
};

window.rtsCases = async () => {
  const out = {};
  try {
  {
    const { e, sim, a, b, near, far } = await make();
    const mesh = meshOf(e);
    const dummies = meshOf(e, 'dummy');
    out.draw = { isInstanced: mesh.isInstancedMesh, count: mesh.count, dummies: dummies.count, inScene: !!e.scene.getObjectByName('rts:grunt'), units: sim.entities.length,
      hasColor: !!mesh.instanceColor, projectile: !!e.scene.getObjectByName('rts:projectile') };
    // rows follow the id order of the units the team sees: grunts a, b; dummies near (far is behind the fog)
    out.rows = [row(mesh, 0)[14], row(mesh, 1)[14], row(dummies, 0)[14]].map(Math.round);
    out.hiddenNotAt = !Array.from({ length: dummies.count }, (_, i) => row(dummies, i)).some(r => Math.abs(r[12] - 40) < 0.5 && Math.abs(r[14] - 40) < 0.5);

    // selection
    out.select = {
      own: e.rts.select([a.id, b.id]).slice(), enemy: e.rts.select([near.id]).length, mixed: e.rts.select([a.id, near.id, 9999]).slice(),
      isFrozen: Object.isFrozen(e.rts.selection), expectA: a.id,
    };

    // an order moves the unit, and so does its instance
    const before = row(mesh, 0);
    e.rts.select([a.id]);
    const why = e.rts.issue({ t: 'move', ids: [a.id], x: fx(-26), z: fx(0) });
    const bad = e.rts.issue({ t: 'move', ids: [a.id], x: 1.5, z: fx(0) });
    e.step(2);
    const after = row(meshOf(e), 0);
    out.move = { why, bad, simX: sim.get(a.id).x / 65536, was: before[12], now: after[12], moved: after.some((v, i) => Math.abs(v - before[i]) > 1e-4), yUnchanged: after[13] === before[13] };

    // fog: the far enemy stays hidden; the overlay and texture exist, the visible cell is clear
    const g = sim.vision.grid(0), f = e.rts.fog;
    out.fog = { hasMesh: !!f?.mesh, name: f?.mesh?.name, tex: !!f?.texture, u: !!e.uniforms.uRtsFog && !!e.uniforms.uRtsFogBounds, bounds: e.uniforms.uRtsFogBounds?.value.toArray(), gridCols: g.cols, texW: f?.texture.image.width,
      farVisible: sim.vision.visible(0, fx(40), fx(40)), nearVisible: sim.vision.visible(0, fx(-20), fx(-14)) };
    const alpha = f.mesh.geometry.attributes.color, cols = g.cols + 1;
    const cx = Math.floor((-20 - g.originX) / g.cell), cz = Math.floor((0 - g.originZ) / g.cell), fx0 = Math.floor((40 - g.originX) / g.cell), fz0 = Math.floor((40 - g.originZ) / g.cell);
    out.fog.alphaOwn = alpha.array[(cz * cols + cx) * 4 + 3]; out.fog.alphaFar = alpha.array[(fz0 * cols + fx0) * 4 + 3];

    // describe
    const d = e.describe().rts;
    out.describe = { has: !!d, selection: d?.selection, units: d?.units, drawn: d?.drawn, driver: d?.driver?.driver, tick: d?.tick, hash: typeof d?.hash, players: d?.players?.length };

    // ops
    const sel = e.ops.run('rts.select', { ids: [b.id] });
    const ord = e.ops.run('rts.order', { t: 'move', x: 5, z: 5 });
    const bog = e.ops.run('rts.order', { t: 'move', ids: 'b', x: 5, z: 5 });
    const off = e.ops.run('rts.order', { t: 'move', ids: [b.id], x: 5000, z: 5 });
    out.ops = { selOk: sel.ok, selValue: sel.value, ordOk: ord.ok, ordValue: ord.value, bogOk: bog.ok, bogCode: bog.code, offOk: off.ok };
    e.step(3);
    out.ops.rejected = e.describe().rts.rejected?.map(r => r.why) ?? [];
    out.ops.bMoved = Math.hypot(sim.get(b.id).x / 65536 - 5, sim.get(b.id).z / 65536 - 5) < 4;

    // unuse takes everything back
    const dom = () => e.uiRoot.querySelectorAll('.threedog-rts-minimap, .threedog-rts-box').length;
    const scene = () => e.scene.children.filter(o => /^rts:/.test(o.name)).length;
    out.unuse = { domBefore: dom(), sceneBefore: scene() };
    e.unuse('rts');
    out.unuse.domAfter = dom(); out.unuse.sceneAfter = scene(); out.unuse.api = e.rts === undefined; out.unuse.uniform = e.uniforms.uRtsFog === undefined;
    e.step(0.1);
  }

  // mouse and keys: click picks the nearest own unit, a box takes the units inside, right click orders, A then click attack-moves
  {
    const { e, sim, a, b, near } = await make();
    e.step(0.1);
    const ndc = id => { const u = sim.get(id); return ndcOf(e, u.x / 65536, u.z / 65536); };
    const pa = ndc(a.id), pb = ndc(b.id), pn = ndc(near.id);
    clickAt(e, pa);
    const sel0 = e.rts.selection.slice();
    const one = e.rts.selection.slice();
    clickAt(e, [pn[0], pn[1]]);
    const enemy = e.rts.selection.slice();   // not selectable: clicking it clears the selection
    clickAt(e, pa); e.input.simulate('rts.queue', true);
    clickAt(e, pb);
    e.input.simulate('rts.queue', false);
    const both = e.rts.selection.slice();
    // box: drag from a corner above-left of both to below-right
    const lo = [Math.min(pa[0], pb[0]) - 0.05, Math.max(pa[1], pb[1]) + 0.05], hi = [Math.max(pa[0], pb[0]) + 0.05, Math.min(pa[1], pb[1]) - 0.05];
    e.rts.select([]);
    e.input.pointer.ndcX = lo[0]; e.input.pointer.ndcY = lo[1]; e.input.pointer.x = 10; e.input.pointer.y = 10;
    e.input.simulate('rts.select', true); e.step(1 / 30, { describe: false });
    e.input.pointer.ndcX = hi[0]; e.input.pointer.ndcY = hi[1]; e.input.pointer.x = 200; e.input.pointer.y = 150;
    e.step(1 / 30, { describe: false });
    const boxShown = e.uiRoot.querySelector('.threedog-rts-box').style.display;
    e.input.simulate('rts.select', false); e.step(1 / 30, { describe: false });
    const boxed = e.rts.selection.slice(), boxHidden = e.uiRoot.querySelector('.threedog-rts-box').style.display;
    // right click on the ground: a move order for the selection; on a visible enemy: an attack
    const target = ndcOf(e, -20, 20);
    clickAt(e, target, { action: 'rts.order' });
    e.step(1);
    const z1 = sim.get(a.id).z / 65536, bx = sim.get(b.id).x / 65536;
    clickAt(e, pn, { action: 'rts.order' });
    e.step(0.2);
    const attackIssued = e.rts.driver.log.some(turn => turn.cmds.some(c => c.t === 'attack' && c.target === near.id && c.ids.length === 2));
    // hotkeys: S stops, group 1 keeps the selection
    e.rts.select([a.id]);
    e.input.simulate('rts.groupSet', true); clickAt(e, [0, 0], { action: 'rts.group1' }); e.input.simulate('rts.groupSet', false);
    e.rts.select([]);
    clickAt(e, [0, 0], { action: 'rts.group1' });
    const recalled = e.rts.selection.slice();
    clickAt(e, [0, 0], { action: 'rts.stop' });
    e.step(0.1);
    out.input = { attackIssued, one, enemy, both, boxed, boxShown, boxHidden, bx, z1, recalled, stopped: sim.get(a.id).orders.length, a: a.id, b: b.id };
  }

  // events and drawing of a fight: a (armed) and the visible enemy shoot at each other, in meters
  {
    const { e, sim, a, near } = await make();
    const seen = { fire: [], hit: [], death: [], spawn: [] };
    for (const k of Object.keys(seen)) e.events.on(`rts:${k}`, ev => seen[k].push(ev));
    // spawn events exist only for spawns inside a step: a system of the match makes two at tick 20
    const made = {};
    sim.install({ name: 'reinforce', step(s) {
      if (s.tick !== 20) return;
      s.spawn('glass', { owner: 1, x: fx(60), z: fx(60) });   // out of sight: its spawn is not announced
      made.near = s.spawn('glass', { owner: 1, x: fx(-20), z: fx(-5) }).id;   // in sight, 5 m from a
    } });
    e.step(3);
    out.events = { fire: seen.fire.length, hit: seen.hit.length, death: seen.death.length, spawn: seen.spawn.length, firstFire: seen.fire[0], firstHit: seen.hit[0],
      death0: seen.death[0], spawnIds: seen.spawn.map(s => s.id), near2: made.near, aStillAlive: !!sim.get(a.id), nearAlive: !!sim.get(near.id), tick: sim.tick,
      bars: e.scene.getObjectByName('rts:bars')?.count };
  }

  // queued orders of a selected unit draw as a path with a dot per waypoint; deselected, nothing is drawn
  {
    const { e, a } = await make();
    e.rts.select([a.id]);
    e.rts.issue({ t: 'move', ids: [a.id], x: fx(10), z: fx(0) });
    e.rts.issue({ t: 'move', ids: [a.id], x: fx(10), z: fx(20), queue: 1 });
    e.step(0.3);
    const count = n => e.scene.getObjectByName(n)?.count ?? 0;
    out.paths = { segs: count('rts:paths'), dots: count('rts:waypoints') };
    e.rts.select([]); e.step(0.1);
    out.paths.after = count('rts:paths');
  }

  // a unit of a kind with its own look, team colors, controls: false
  {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const { e, a } = await make({ look: { grunt: { geometry, scale: 2, y: 3 } }, teamColors: [0xff0000, 0x0000ff], controls: false, minimap: false, fog: false });
    const mesh = meshOf(e), m = row(mesh, 0), c = mesh.instanceColor.array;
    out.look = { sameGeometry: mesh.geometry === geometry, scale: m[0], lift: m[13], color0: Array.from(c.slice(0, 3)).map(x => +x.toFixed(2)), noMinimap: !e.uiRoot.querySelector('.threedog-rts-minimap'), noBox: !e.uiRoot.querySelector('.threedog-rts-box'),
      noOverlay: e.rts.fog.mesh === null, texture: !!e.rts.fog.texture, id: a.id };
    e.unuse('rts');
    out.look.geometryAlive = geometry.attributes.position.count === 24 && !e.scene.getObjectByName('rts:grunt');
  }
  } catch (err) { out.error = err.stack; }
  return out;
};
window.engine = (await make({ minimap: false, controls: false })).e;   // the runner waits for window.engine; the cases above build their own
