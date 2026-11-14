# RTS games on threedog: the guide for agents

`@threedog/rts` is a deterministic RTS simulation: integer math, no three.js, no DOM. Every player's machine runs the whole sim; only
commands travel. The engine's `rts()` module (recipe 67-rts.md) draws it, reads input and talks to a driver. Your game is mostly data
(content, map, mode options) plus picture code.

Look up the task, then read only that section.

| Task | Where |
|---|---|
| Start a game | [Shape of a game](#shape-of-a-game) |
| Units, weapons, armor | [Content](#content) |
| The map | [Map](#map) |
| Orders from code | [Commands](#commands) |
| Reinforcement match (World in Conflict style) | [Modes](#modes) |
| Base building (C&C / StarCraft style) | [Modes](#modes) |
| Bots | [AI](#ai) |
| Online play | [Multiplayer](#multiplayer) |
| Replays, observers | [Replays](#replays) |
| My own rule or system | [Your own systems](#your-own-systems) |
| Something desynced | [Determinism](#determinism) |
| Check my work | [Tools](#tools) |

## Shape of a game

```
sim/index.js     export function makeSim(settings) { ... }   ← the ONLY place the match is built; same code for single player, online, replays, CLI
sim/content.js   units, weapons, armor (plain numbers)
sim/map.js       createMap(...) from baked data
main.js          engine + rts({ driver }) module + picture code
picture/         how units, effects, terrain look (three.js)
```

`settings` is `{ seed, players: [{ name, team, faction, bot? }], ...your options }`. Online, the relay hands it to every client; offline,
you build it. `makeSim` must give the same sim for the same settings on every machine.

```js
// sim/index.js
import { reinforceMatch } from '@threedog/rts/examples/content.js';   // or build your own, see Modes
export const makeSim = settings => reinforceMatch(settings);

// main.js, single player against a bot
import { localDriver } from '@threedog/rts';
const sim = makeSim({ seed: 1, players: [{ team: 0 }, { team: 1, bot: { level: 'normal' } }] });
engine.use(rts({ driver: localDriver(sim, { player: 0 }) }));
```

## Content

`loadContent({ units, weapons, armor })`. Meters, seconds, degrees; it turns them into fixed-point once and names the path and the fix for
every mistake. Unit keys: `hp speed radius sight armor weapons turnRate cost air tags capture supply build produces gather structure
footprint income deployTime`. Weapon keys: `range minRange damage cooldown damageType projectileSpeed splash targets arc turret`.
Armor: `{ light: { bullet: 1, shell: 0.6 } }` is a damage multiplier per damage type. Full example: `examples/content.js`.

## Map

`createMap({ width, depth, cell, height(x, z), blocked(x, z) })` or baked arrays (`heights`, `blocks`). Heights block sight (hills,
ridges). A map sampled from float terrain must be baked once and shipped as data (`map.toJSON()` → file → `mapFromJSON`), never re-sampled
per client: one rounding difference is a desync. `map.hash` goes in the lobby check.

## Commands

All positions are fixed: `fx(meters)`. From the engine: `engine.rts.issue(cmd)` (fills `p`); in the sim: `sim.run({ p, ...cmd })` returns
'' or why it was refused.

| t | args | |
|---|---|---|
| move, amove, patrol | ids, x, z, queue? | queue: 1 appends (shift) |
| attack | ids, target | |
| stop, hold | ids | |
| reinforce | kinds: [names], x, z | reinforcement mode |
| build | kind, x, z | base mode; `sim.base.canPlace(p, kind, x, z)` says why not |
| produce, cancel | id, kind, count? / id | base mode |
| rally | id, x, z | base mode |
| gather | ids, target | base mode |

## Modes

Modes are systems added after the standard ones: `createMatch({ seed, content, map, players, extra: [...] })`.

- `reinforceSystem({ budget, deployDelay, refundDelay, zones: [{ team, x, z, radius }], start })`: a points budget, drops land after a
  delay, dead units refund their cost later.
- `captureSystem({ points: [{ id, x, z, radius, value }] })`: zones taken by standing in them alone; held points score every second.
- `baseSystem({ startRes, supplyCap, buildRadius, start, resources })`: structures, production queues, supply, workers, income.
- `victorySystem({ scoreLimit, timeLimit, annihilation })`: sets `sim.ended`, `sim.winner`, emits `end`.
- `botSystem()`: last, when any player has `bot`.

`examples/content.js` builds both styles (`reinforceMatch`, `baseMatch`); copy it as your start.

## AI

`players: [{ team: 1, bot: { level: 'easy' | 'normal' | 'hard', mix, workers, attackAt, buildOrder, army } }]` and `botSystem()` last in
`extra`. Bots run inside the sim on every client, so they never send network traffic and cannot desync. They only target what their team
sees.

## Multiplayer

```js
import { lockstepDriver, webSocketTransport } from '@threedog/rts';
const driver = lockstepDriver({ transport: webSocketTransport(`wss://relay.example.com/${room}`), room, name,
  version: BUILD_VERSION, contentHash: content.hash, mapHash: map.hash, makeSim });
driver.on('lobby', l => showLobby(l));   driver.setSlot({ team: 1 });   driver.ready(true);   driver.start({ mode: 'skirmish' }); // host
engine.use(rts({ driver }));             // draws once the relay starts the match
driver.on('desync', d => report(d, driver.dump(d.turn)));
```

The relay (`npx threedog rts relay --port 8788`) owns the turn clock (100 ms turns), stamps each command with its sender, compares hashes,
keeps the log for rejoins (`lockstepDriver({ ..., key: oldDriver.key })`) and observers (`observer: true`, 3 s behind). A dropped player's
units stand idle; after `leaveAfterMs` (60 s) the relay makes them leave in every sim. Host it on any small VM (Compute Engine e2-small is
plenty); put TLS in front (wss://).

## Replays

`makeReplay(driver, { makeSim })` → small JSON (settings + non-empty turns + hashes). `verifyReplay(rep, makeSim)` replays it headless and
names the first turn whose hash differs. `replayDriver(makeSim(rep.settings), rep, { speed: 4, makeSim })` plays it in the engine like any
driver (`seek(turn)`). The relay saves replays with `--replays dir`.

## Your own systems

A system is `{ name, init?(sim), step?(sim), hash?(sim, hasher), save?(sim), load?(sim, data), afterLoad?(sim, data), describe?(sim),
spawned?(sim, entity) }`, added to `extra` (order matters: the same list everywhere). Keep it in `sim/` so rule R72 checks it. Add entity
fields with `sim.field(name, default)` (hashed and saved); keep your own state in `save`/`load` and mix it into `hash`. New commands:
`sim.defineCommand(type, { validate(sim, cmd) → '' | reason, apply(sim, cmd) })`. Events for picture and sound: `sim.emit({ type, ... })`.

## Determinism

In sim code (packages/rts, your `sim/`), rule R72 refuses `Math.sin/cos/atan2/pow/...`, `**`, `Math.random`, `Date`, `performance.now`,
DOM and three.js. Use `fx`, `mul`, `div`, `sqrt`, `len`, `sin`, `cos`, `atan2` (angles 0..65535 per turn) and `sim.rng`. Loop over
`sim.entities` (id order). Never read the camera, frame time or anything the page computed. Integer `+ - * /` and `Math.sqrt`,
`Math.floor`, `Math.round` are safe.

## Tools

```
npx threedog rts match --runs 100        bots play 100 matches, each twice: crashes, desyncs, refused commands, ms per tick
npx threedog rts desync                  two runs and a save/load every 500 ticks; the first bad tick with the entity fields that differ
npx threedog rts bench --units 2000      ms per tick in a 2000-unit battle (budget 50 ms)
npx threedog rts browsers                the same match in Node, Chromium, Firefox, WebKit: hashes compared
npx threedog rts replay file.json        verify a replay against this build
npm test -- rts                          the test suites
```
`--sim sim/index.js` points every command at your game's `makeSim` (the default when that file exists).
