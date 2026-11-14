# Notes for this game

This game starts from `--rts`: a World in Conflict-style reinforcement match against a bot on the deterministic sim in `sim/` (units, map, capture points, rules; read `node_modules/@threedog/rts/docs/RTS.md` before changing it, rule R72 checks it), drawn by the engine `rts()` module (recipe 67-rts.md) with a ground mesh from the sim map, simple unit shapes in `picture/units.js` and a HUD in `ui/hud.js`. `?relay=ws://localhost:8788&room=test` plays online (`npx threedog rts relay`). Check gameplay headless with `npx threedog rts match` and `npx threedog rts desync`.

**Three rules.** 1. Each thing has a name: `engine.describe()` lists it, `explain module <name>` says why.
2. Each thing has an owner: `add` returns a handle, `h.remove()` undoes it (not `engine.add`, `world.add`, `addPlayer`); `define` names a kind; `input.bind` sets keys.
3. What several sides change has one owner the rest go through (values `engine.mod`, services `provides`).

## Already here
Commands: `npx threedog <command>` (installed here, not on PATH).
**Before writing a system, in any file:** name the engine system for it below, or the `npx threedog how` result that found none.
`npx threedog check` hints at hand-rolled systems (names as in this table): use them or `// hint-off(kind)`.
Wired in `main.js`: start screen, autosave, Esc pause and quality settings; keep, replace or delete each.
**Anything else: `npx threedog how "<task words>"` first; it prints the section.** One option by name: `npx threedog how --read interactions.add.once`.
Full table: `node_modules/threedog/docs/AI.md`.
| Needs | Use | Recipe |
|---|---|---|
| Third-person start (player walks, walking player, pause) | `addPlayer` | 63-third-person-start.md §1 |
| Player, characters | `engine.player`, `engine.characters`, `engine.control` | 57-control.md §"Who takes what", 13-animation.md |
| Camera: followCamera (third person), first person, fixedCamera, rts; setCamera | `engine.cameraRig`, `engine.page` | 21-camera.md §1 |
| Keys, gamepad, rebinding, seats | `engine.input` | 58-input.md §1 |
| Save game, load game, autosave, story flags, counters | `engine.saves.define`, `engine.vars` | 20-content-actions-save.md §4 |
| NPC conversation: talk to an NPC, what NPCs do | `engine.npcs`, `engine.dialogue` | 02-npc.md §1 |
| Quests, objective markers | `engine.quests`, `engine.hud.marker()` | 04-quests.md §1 |
| Prompts, trigger zones | `engine.interactions`, `engine.triggers` | 20-content-actions-save.md §3 |
| Items, chests, shops, gold; things to pick up | `engine.inventory`, `engine.pickups` | 03-items-pickups.md §"Items and pickups", 22-shop-gold.md |
| UI, menus, HUD, languages, settings, photo mode | `engine.ui`, `makeWindow`, `toast(engine, text)`, `engine.hud`, `engine.i18n`, `engine.settings`, `engine.photo` | 26-ui-parts.md §1, 26-ui-parts.md §6 |
| Sound, music, ambience | `engine.audio`, `engine.music`, `engine.ambience` | 31-audio.md |
| Physics, ragdoll, collision, vehicles | `engine.collision`, `engine.rigid`, `engine.collider3d` | 11-vehicles.md §3 |
| Terrain, height | `engine.terrain`, `engine.ground` | 28-terrain.md §2 |
| Water, rain, snow cover (own rain: `THREE.md`) | `engine.water`, `weather({ rain, snow })` | 44-water-weather-hooks.md |
| Grass, trees | `engine.vegetation.define` | 05-props-bake.md §2e, 36-ground-plants.md |
| Time of day, day / night, seasons | `engine.calendar` | 08-weather-sky.md §4, 06-clock-events.md |
| Slow, low fps | `engine.jobs`, `engine.threads`, `engine.budget`, `engine.debug` | 15-perf.md §1 |
| Broke; describe, explain, shot: which tool | `.threedog/errors.log`, `engine.describe`, `engine.explain` | 16-dev-bridge.md §11 |

## The loop
1. Run: `npx threedog play` runs the game for you (`--stop` ends); `npx threedog dev` for a person.
2. Look: `npx threedog shot` (`--play` past the start screen), `engine.describe()` for state; judge a picture: recipe 60.
3. Fix: an error names its `code`, `fix` and docs section (`.threedog/errors.log`); root cause first, fixed once where it lives (recipe 16 §11).
4. After a change: `npx threedog map`, `npx threedog check`, related tests (`npx threedog test name`).
Helpers skip this file: tell them `npx threedog how` first, recipes 60 + 62, a clean `check`. Taking over: STATUS.md, then DESIGN.md.

## Working rules
- A clear request: build it, no confirmation round. Ask only about a choice that changes the result; picture not given: ask for reference images, the style and what would be wrong (DESIGN.md "Loved / Not for this game"). Other picks go into DESIGN.md as "(picked, not asked)" with a one-line why; changing what DESIGN.md settled: ask first.
- Done = it plays AND looks as DESIGN.md describes; gray placeholders mean the art is still to make (STATUS.md lists them). Thin slice first (one place, one action, one goal, one shot), then widen; stop at DESIGN.md "Done for this version".
- Before writing, list every place the change reaches. The least code that fully works; no "for later" code; a new way deletes the old one in the same change.
- End of a piece: a test or assert for logic with weight, one shot for a picture round, a scenario per end state.
- Never cut save-data safety, input checks or what was asked. A known-limit shortcut gets `// shortcut: <limit>, <when to upgrade>`; other comments say why.
- Report what is true: verified, not verified, placeholder; never call a picture "close to the reference". Check licenses before using others' code or assets.
- Records: a change updates only the records it makes wrong (DESIGN.md, `docs/design/`, STATUS.md). Reply in the user's language.

## Picture and content
The picture is plain three.js in `picture/`, one file per job (recipe 62 §0); `npx threedog lib list` holds what the user liked before. This game runs on WebGPU: shaders are TSL on node materials (recipe 56); GLSL (`ShaderMaterial`, `onBeforeCompile`) stops with an error naming it.
Without WebGPU the browser runs it on WebGL2, slower; `engine.describe().renderer` says which backend draws and why.
Shape is code, placement is content (`content/`, saves read it): what a save stores whole is never made again at startup (`check` warns). Gameplay: `game/`, one createX(engine) per system, wired in `main.js`.

<!-- "Working rules" adapt principles from the ponytail skill (github.com/DietrichGebert/ponytail, MIT). -->
