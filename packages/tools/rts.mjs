// threedog rts: headless tools for RTS games built on @threedog/rts. Everything runs in Node, no browser, in seconds.
//   threedog rts match   [--sim file] [--mode reinforce|base] [--players 2] [--level normal] [--seed 1] [--minutes 15] [--runs 1] [--json]
//                        bots play a whole match; one line per run (winner, length, ms per tick, hash, refused commands). --runs 100 is the
//                        "many matches, no crash, no desync" gate: each run is also played twice and the hashes compared
//   threedog rts desync  [--sim file] [--mode …] [--seed 1] [--minutes 5]
//                        plays the match twice in one process, and once more through a save/load (JSON snapshot) every 500 ticks; the first
//                        tick whose hash differs is printed with the entity fields that differ: the bug is in what changed them
//   threedog rts bench   [--units 2000] [--seconds 60]   two armies attack-move into each other; ms per tick: average, p95, worst
//   threedog rts replay  <file.json> [--sim file] [--mode …]   verify a replay (made by makeReplay or saved by the relay) against this build
//   threedog rts relay   [--port 8788] [--replays dir]   start the lockstep relay server
// --sim file: a module exporting makeSim(settings) (the game's own match builder, the same one its lockstep client uses); settings are
// { seed, players: [{ team, bot }] }. Without --sim, ./sim/index.js of the current folder is used when present, else the built-in examples.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { hex, verifyReplay, TICK_RATE, fx } from '@threedog/rts';
import { reinforceMatch, baseMatch, REINFORCE_CONTENT } from '@threedog/rts/examples/content.js';
import { parseOptions } from './lib/cli-args.mjs';

const [sub, ...rest] = process.argv.slice(2);
const SUBS = ['match', 'desync', 'bench', 'replay', 'relay'];
if (!SUBS.includes(sub)) { console.error(`✗ threedog rts ${sub ?? ''}: use one of ${SUBS.join(', ')} (threedog rts --help)`); process.exit(1); }

if (sub === 'relay') {
  const dir = dirname(createRequire(import.meta.url).resolve('@threedog/rts/package.json'));
  process.exit(spawnSync(process.execPath, [join(dir, 'net/relay.mjs'), ...rest], { stdio: 'inherit' }).status ?? 1);
}

let opts, positionals = [];
try {
  ({ opt: opts, rest: positionals } = parseOptions(rest, { positional: sub === 'replay', values: ['sim', 'mode', 'players', 'level', 'seed', 'minutes', 'runs', 'units', 'seconds'], flags: ['json'] }));
} catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }

const num = (k, d) => { const v = opts[k] === undefined ? d : Number(opts[k]); if (!Number.isFinite(v) || v < 0) { console.error(`✗ --${k} must be a number`); process.exit(1); } return v; };

async function loadMaker() {
  const file = opts.sim ?? (existsSync('sim/index.js') ? 'sim/index.js' : null);
  if (file) {
    const m = await import(pathToFileURL(resolve(file)).href);
    if (typeof m.makeSim !== 'function') { console.error(`✗ ${file} must export makeSim(settings)`); process.exit(1); }
    return { make: m.makeSim, label: file };
  }
  const mode = opts.mode ?? 'reinforce';
  if (!['reinforce', 'base'].includes(mode)) { console.error('✗ --mode is reinforce or base'); process.exit(1); }
  return { make: mode === 'base' ? baseMatch : reinforceMatch, label: `example ${mode} match` };
}

const settingsFor = seed => {
  const n = num('players', 2), level = opts.level ?? 'normal';
  return { seed, players: Array.from({ length: n }, (_, i) => ({ team: i % 2, name: `bot ${i + 1}`, bot: { level } })) };
};

function play(make, settings, maxTicks, every = 0) {
  let sim = make(settings);
  const hashes = [], times = [];
  while (!sim.ended && sim.tick < maxTicks) {
    const a = performance.now();   // measure
    sim.step();
    times.push(performance.now() - a);   // measure
    hashes.push(sim.hash());
    if (every && sim.tick % every === 0) { const snap = JSON.parse(JSON.stringify(sim.snapshot())); const s2 = make(settings); s2.restore(snap); sim = s2; }
  }
  return { sim, hashes, times };
}

const stats = t => { const s = t.slice().sort((a, b) => a - b); return { avg: s.reduce((a, b) => a + b, 0) / (s.length || 1), p95: s[Math.floor(s.length * 0.95)] ?? 0, max: s[s.length - 1] ?? 0 }; };
const clock = ticks => { const s = Math.round(ticks / TICK_RATE); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Field-level differences between two snapshots: entities by id, players, system state (first few) */
function diffSnaps(a, b) {
  const out = [];
  const byId = s => new Map(s.entities.map(e => [e.id, e]));
  const ea = byId(a), eb = byId(b);
  for (const [id, x] of ea) {
    const y = eb.get(id);
    if (!y) { out.push(`entity ${id} only in run A`); continue; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`entity ${id} (kind ${x.kind}, owner ${x.owner}).${k}: A ${JSON.stringify(x[k])} · B ${JSON.stringify(y[k])}`);
  }
  for (const id of eb.keys()) if (!ea.has(id)) out.push(`entity ${id} only in run B`);
  a.players.forEach((p, i) => { for (const k of Object.keys(p)) if (JSON.stringify(p[k]) !== JSON.stringify(b.players[i][k])) out.push(`player ${i}.${k}: A ${JSON.stringify(p[k])} · B ${JSON.stringify(b.players[i][k])}`); });
  for (const k of Object.keys(a.systems)) if (JSON.stringify(a.systems[k]) !== JSON.stringify(b.systems[k])) out.push(`system ${k} state differs`);
  if (a.rng !== b.rng) out.push(`rng state: A ${a.rng} · B ${b.rng}`);
  return out;
}

const { make, label } = sub === 'bench' ? { make: null, label: '' } : await loadMaker();

if (sub === 'match') {
  const runs = num('runs', 1), seed0 = num('seed', 1), maxTicks = num('minutes', 15) * 60 * TICK_RATE;
  let wins = new Map(), bad = 0;
  for (let r = 0; r < runs; r++) {
    const settings = settingsFor(seed0 + r);
    let a, b;
    try { a = play(make, settings, maxTicks); b = runs > 1 ? play(make, settings, maxTicks) : null; }
    catch (e) { bad++; console.log(`✗ seed ${seed0 + r}: crashed: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
    const st = stats(a.times), d = a.sim.describe(), w = a.sim.ended ? a.sim.winner : null;
    const same = !b || a.hashes.at(-1) === b.hashes.at(-1);
    if (!same) bad++;
    wins.set(w, (wins.get(w) ?? 0) + 1);
    if (opts.json) { console.log(JSON.stringify({ seed: seed0 + r, winner: w, reason: a.sim.endReason ?? null, ticks: a.sim.tick, hash: hex(a.hashes.at(-1)), ms: st, deterministic: same, describe: d })); continue; }
    const result = w === null ? 'no winner yet' : w === -1 ? `draw (${a.sim.endReason})` : `team ${w} won (${a.sim.endReason})`;
    console.log(`${same && !d.rejected.length ? '✓' : '✗'} ${label}, seed ${seed0 + r}: ${result} at ${clock(a.sim.tick)} · ${st.avg.toFixed(2)} ms/tick avg, ${st.max.toFixed(1)} worst · hash ${hex(a.hashes.at(-1))}${same ? '' : ' · DESYNC between two runs'}${d.rejected.length ? ` · ${d.rejected.length} refused: ${d.rejected[0].t} "${d.rejected[0].why}"` : ''}`);
  }
  if (runs > 1) console.log(`${bad ? '✗' : '✓'} ${runs} matches: ${[...wins].map(([w, n]) => `${w === null ? 'unfinished' : w === -1 ? 'draw' : `team ${w}`} ×${n}`).join(', ')}${bad ? ` · ${bad} crashed or desynced` : ' · no crash, no desync'}`);
  process.exit(bad ? 1 : 0);
}

if (sub === 'desync') {
  const settings = settingsFor(num('seed', 1)), maxTicks = num('minutes', 5) * 60 * TICK_RATE;
  const a = play(make, settings, maxTicks), b = play(make, settings, maxTicks), c = play(make, settings, maxTicks, 500);
  const firstDiff = (x, y) => { const n = Math.min(x.length, y.length); for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i + 1; return x.length === y.length ? 0 : n + 1; };
  const ab = firstDiff(a.hashes, b.hashes), ac = firstDiff(a.hashes, c.hashes);
  if (!ab && !ac) { console.log(`✓ ${label}: ${a.hashes.length} ticks, identical hashes in two runs and through a save/load every 500 ticks (final ${hex(a.hashes.at(-1))})`); process.exit(0); }
  const [what, tick, every] = ab ? ['two plain runs differ', ab, 0] : ['a save/load changes the game (state not saved or not restored)', ac, 500];
  console.log(`✗ ${label}: ${what} first at tick ${tick} (${clock(tick)})`);
  const x = play(make, settings, tick).sim.snapshot(), y = play(make, settings, tick, every).sim.snapshot();
  const diffs = diffSnaps(x, y);
  for (const l of diffs.slice(0, 12)) console.log(`  · ${l}`);
  if (diffs.length > 12) console.log(`  · … ${diffs.length - 12} more`);
  if (!diffs.length) console.log('  · the snapshots are equal: the difference is in state the snapshot does not hold (a system without save/load, or a cache that changes behavior)');
  console.log('  → fix: find the code that writes those fields; look for iteration over unordered data, float math (R72), state kept outside the sim, or a system missing save/load');
  process.exit(1);
}

if (sub === 'bench') {
  const { createMatch, loadContent, createMap } = await import('@threedog/rts');
  const n = num('units', 2000), seconds = num('seconds', 60);
  const content = loadContent(REINFORCE_CONTENT), map = createMap({ width: 800, depth: 500 });
  const sim = createMatch({ seed: 1, content, map, players: [{ team: 0 }, { team: 1 }] });
  const per = Math.floor(n / 2), cols = Math.ceil(Math.sqrt(per));
  const ids = [[], []];
  for (let side = 0; side < 2; side++) for (let i = 0; i < per; i++) {
    const kind = i % 10 === 0 ? 'tank' : 'rifleman';
    ids[side].push(sim.spawn(kind, { owner: side, x: fx((side ? 300 : -300) + (i % cols) * 2.2 * (side ? 1 : -1)), z: fx(Math.floor(i / cols) * 2.2 - cols) }).id);
  }
  sim.step([{ p: 0, t: 'amove', ids: ids[0].slice(0, 500), x: fx(300), z: 0 }, { p: 0, t: 'amove', ids: ids[0].slice(500, 1000), x: fx(300), z: 0 },
    { p: 1, t: 'amove', ids: ids[1].slice(0, 500), x: fx(-300), z: 0 }, { p: 1, t: 'amove', ids: ids[1].slice(500, 1000), x: fx(-300), z: 0 }]);
  const times = [];
  for (let t = 0; t < seconds * TICK_RATE; t++) { const a = performance.now(); sim.step(); times.push(performance.now() - a); }   // measure
  const s = stats(times), budget = 1000 / TICK_RATE;
  console.log(`${s.p95 < budget ? '✓' : '✗'} ${n} units, ${seconds} s of battle: ${s.avg.toFixed(2)} ms/tick avg, p95 ${s.p95.toFixed(1)}, worst ${s.max.toFixed(1)} (budget ${budget} ms) · ${sim.entities.length} left · ${(n - sim.entities.length)} died`);
  process.exit(s.p95 < budget ? 0 : 1);
}

if (sub === 'replay') {
  const file = positionals[0];
  if (!file || !existsSync(file)) { console.error('✗ threedog rts replay <file.json>: give a replay file'); process.exit(1); }
  const rep = JSON.parse(readFileSync(file, 'utf8'));
  const v = verifyReplay(rep, make);
  if (v.ok) console.log(`✓ ${file}: ${v.turns} turns replay with the same hashes on this build (final ${hex(v.sim.hash())}, ${v.sim.ended ? `team ${v.sim.winner} won` : 'unfinished'})`);
  else console.log(`✗ ${file}: ${v.why ?? `hash differs first at turn ${v.firstMismatch.turn} (recorded ${hex(v.firstMismatch.want)}, now ${hex(v.firstMismatch.got)})`} → the game's rules changed since it was recorded, or the sim is not deterministic (threedog rts desync)`);
  process.exit(v.ok ? 0 : 1);
}
