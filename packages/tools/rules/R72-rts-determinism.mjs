// R72 RTS determinism: code that runs inside the lockstep simulation must give identical bits on every browser and machine.
// Detection: per line, regexes for the calls below in sim files; known limits: an aliased Math (const M = Math) or a computed property is not seen.
// Scope: packages/rts/*.js (the sim) and every game's sim/ folder (games/<game>/sim/**, a game's own systems and rules).
// Errors:
//   · Math.sin / cos / tan / asin / acos / atan / atan2 / sinh / cosh / tanh / exp / expm1 / log / log1p / log2 / log10 / pow / cbrt / hypot:
//     each JS engine approximates these its own way, so two players' sims drift apart (a desync). Use fixed.js: sin, cos, atan2, sqrt, len.
//   · the ** operator (Math.pow in disguise)
//   · Math.random, Date, performance.now, setTimeout / setInterval: real time and unseeded randomness differ per machine. Use sim.rng and sim.tick.
//   · importing three or touching document / window: the sim runs in workers and Node, and drawing must never decide game state.
// Allowlist: a line ending in // not-sim (code in a sim file that only formats output for tools, never feeds the state).
// Files that are not simulation (the relay server, the lockstep client, CLI helpers) sit in packages/rts/net/ or packages/rts/tools/ and are not scanned.
import { existsSync } from 'node:fs';
import { walk, read, codeOnly, rel, abs } from './_lib.mjs';

const TRIG = /\bMath\.(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log1p|log2|log10|log|pow|cbrt|hypot|fround)\b/g;
const TIME = /\b(Math\.random|Date\b|performance\.now|setTimeout|setInterval|requestAnimationFrame)\b/g;
const DOM = /\b(document|window|navigator|localStorage)\s*[.[]/g;
const THREE = /(?:from\s*|import\s*\(\s*)['"]three(\/[^'"]*)?['"]/;

function simFiles() {
  const out = walk('packages/rts', ['.js']).filter(f => !/^packages\/rts\/(net|tools|docs)\//.test(f));
  if (existsSync(abs('games'))) out.push(...walk('games', ['.js']).filter(f => /^games\/[^/]+\/sim\//.test(f)));
  return out;
}

export default {
  id: 'R72', title: 'RTS simulation code is deterministic (no float trig, real time, randomness or drawing)', game: true,
  run() {
    const out = [];
    for (const f of simFiles()) read(f).split(/\r?\n/).forEach((raw, i) => {
      if (/\/\/\s*not-sim\b/.test(raw) || /^\s*(\/\*|\*)/.test(raw)) return;
      const line = codeOnly(raw);
      for (const m of line.matchAll(TRIG)) out.push({ level: 'error', file: f, line: i + 1, msg: `Math.${m[1]} in simulation code (differs between browsers: desync)`, fix: `use the fixed-point version from '@threedog/rts' (sin, cos, atan2, sqrt, len); angles are 0..65535 per turn` });
      if (/[\w)\]]\s*\*\*\s*[\w(]/.test(line)) out.push({ level: 'error', file: f, line: i + 1, msg: 'the ** operator in simulation code (a pow: differs between browsers)', fix: 'multiply it out (x * x), or use mul() from fixed.js' });
      for (const m of line.matchAll(TIME)) out.push({ level: 'error', file: f, line: i + 1, msg: `${m[1]} in simulation code (differs per machine)`, fix: 'randomness: sim.rng (int, range, chance, pick); time: sim.tick (TICK_RATE ticks per second)' });
      for (const m of line.matchAll(DOM)) out.push({ level: 'error', file: f, line: i + 1, msg: `${m[1]} in simulation code`, fix: 'the sim runs in workers and Node: move page code to the engine rts module or the game\'s picture/ui code' });
      if (THREE.test(line)) out.push({ level: 'error', file: f, line: i + 1, msg: 'simulation code imports three', fix: 'drawing reads sim.view() from the engine rts module; the sim never imports three' });
    });
    out.note = `${simFiles().length} simulation file(s) scanned`;
    return out;
  },
};
export const _files = () => simFiles().map(f => rel(abs(f)));
