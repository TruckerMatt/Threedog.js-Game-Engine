# RTS: draw and command a match from @threedog/rts

> **Covers:** rts: the page side of a real-time strategy match: units, selection, orders, fog of war, minimap.
> **Use when:** a game with a crowd of units you select and order, on the deterministic sim of `@threedog/rts`.
> **Shortest:** `engine.use(rts({ driver: localDriver(sim, { player: 0 }) }))`, then bind `presets.bindings.rts`.
> **Sections:** The match and the module · Controls · Drawing and look · Fog and minimap · Events · Ops and describe · Limits

```js
import { rts, rtsCamera, presets } from 'threedog';
import { createMatch, localDriver, loadContent, createMap, fx } from '@threedog/rts';

const content = loadContent({
  armor: { plain: { bullet: 1 } },
  weapons: { rifle: { range: 14, damage: 20, cooldown: 1, damageType: 'bullet' } },
  units: { grunt: { hp: 100, speed: 5, radius: 0.6, sight: 25, armor: 'plain', weapons: ['rifle'] } },
});
const sim = createMatch({ seed: 1, content, map: createMap({ width: 256, depth: 256 }), players: [{ team: 0 }, { team: 1 }] });
sim.spawn('grunt', { owner: 0, x: fx(-20), z: fx(0) });
sim.spawn('grunt', { owner: 1, x: fx(30), z: fx(10) });

engine.use(rtsCamera({ height: 50, dragPan: false }));          // the primary mouse key selects: no drag-to-pan
engine.use(rts({ driver: localDriver(sim, { player: 0 }), teamColors: [0x3366cc, 0xcc3333] }));
engine.input.bind(presets.bindings.rts);                         // the game binds the keys; the module only declares actions
```
The sim and its driver are the game's. The module steps the driver in the fixed step (`driver.update`, 20 sim ticks a second), keeps the last two `sim.view()`s and draws between them with `driver.alpha`, so movement is smooth at any frame rate. `engine.rts.driver` and `engine.rts.sim` are read only: change the match only with commands. An online match is the same code with a lockstep driver.

## Controls
`presets.bindings.rts` binds: primary mouse key selects, secondary orders, `A` then a click attack-move, `S` stop, `H` hold, `P` then a click patrol, Shift queues an order (`queue: 1`) and adds to the selection, `1`-`9` recall a control group, Ctrl + `1`-`9` store one, the same group twice within 0.4 s moves the camera to it. Left click picks the own unit nearest the pointer within 20 px (units are projected with the camera, no raycast), a drag draws a box, a double click takes every own unit of that kind on screen. Right click on a visible enemy attacks it, on the ground moves. The actions are named `rts.select`, `rts.order`, `rts.attackMove`, `rts.stop`, `rts.hold`, `rts.patrol`, `rts.queue`, `rts.groupSet`, `rts.group1`...`rts.group9`: rebind them like any action.
```js
engine.rts.select([3, 4]);                                        // own, living units only; returns the new selection
engine.rts.issue({ t: 'move', ids: engine.rts.selection.slice(), x: fx(10), z: fx(-4) });   // '' or why the sim refused it
```
Right click on a resource field with workers selected gathers, and with structures selected it also sets their rally point (base building). A game mode that needs the mouse for itself (placing a building, aiming) holds it with `const h = engine.rts.takePointer('placing')`: clicks and drags wait until `h.remove()`, keys keep working.
`engine.rts.selection` is a frozen list of ids. `issue` takes the sim's command shapes (positions fixed: `fx(meters)`). A game with its own UI passes `controls: false`: no key is read and no box is made; it calls `select` and `issue` itself.

## Drawing and look
Each unit kind is one plain `THREE.InstancedMesh` (`engine.rts.meshes[kind]`), grown when a match needs more rows. The model's forward is +x: a unit with facing 0 looks along +x, so bake any rotation into the geometry. Without a look a kind is a gray box sized by its radius; the engine ships no art.
```js
engine.use(rts({ driver, look: {
  grunt: { geometry: gruntGeometry, material: gruntMaterial, scale: 1, y: 0 },   // yours: stays yours to dispose
  projectile: { geometry: shellGeometry },                                       // shots in flight
} }));
engine.rts.ringMaterial.emissive.set(0x66ff66);                                  // selection ring: neutral until you restyle it
```
Every row is tinted by its team through the instance color (`teamColors`, else a different gray per team). Units the local team does not see are not drawn. Selected units get a ring (`ringMaterial`), selected or hurt ones a health bar (`barMaterial` over `barBackMaterial`), and the queued orders of selected units show as a path with a dot at each waypoint (`waypointMaterial`).

## Fog and minimap
With the vision system in the sim, `fog` (default on) draws a dark overlay lifted 0.3 m over the ground: unexplored mostly opaque, explored but not seen half, seen clear. It is rebuilt only when the team's vision changes. The raw fog is also published for your own terrain shader: `engine.uniforms.uRtsFog` (a `DataTexture`, one texel per vision cell, r = seen now, g = ever seen) and `engine.uniforms.uRtsFogBounds` (origin x, z and size in meters); `engine.rts.fog` holds the mesh, material, texture and uniforms (`fog: false` keeps only the texture).

The minimap (`minimap: false` to skip) is a canvas with the CSS class `threedog-rts-minimap` in the lower-left corner: heights as grays, the units the team sees as dots in team color, the fog, and the camera's footprint. Left click or drag moves the camera, right click orders the selection there. The selection box is a div with the class `threedog-rts-box`. Both are styled by rules with no specificity, so any game CSS wins.

## Events
The sim's events come back on the engine bus in meters, so the game draws the effects and plays the sounds: `rts:fire` `{ id, target, weapon, x, z, tx, tz, tick }`, `rts:hit` `{ id, by, damage, x, z, tick }`, `rts:death` and `rts:spawn` `{ id, kind, owner, x, z, tick }` (death also has `by`). Only what happens where the local team sees is announced.
```js
engine.events.on('rts:fire', f => muzzleFlash([f.x, 1, f.z], [f.tx, 1, f.tz]));
```

## Ops and describe
`engine.ops.run('rts.order', { t: 'move', x: 10, z: -4 })` orders the selection (or `ids`) with positions in meters; `rts.select` takes `{ ids }`. From a terminal: `npx threedog op rts.order t=move x=10 z=-4`. A refused command comes back as `{ ok: false, code: 'refused', facts: { why } }`. `engine.describe().rts` shows the driver, tick, selection size, units, units drawn, the match hash and the last refusal.

## Limits
The local player's units are the only selectable ones; an observer driver (`player: -1`) sees everything and selects nothing. The module reads `driver.player` each frame, so it follows a driver that changes it, but the fog is built for the team the player had at `engine.use`. A time jump (`engine.skip`) does not advance the match.
