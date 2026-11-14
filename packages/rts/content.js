// Game content for the RTS sim: unit kinds, weapons and armor, written by the game in plain numbers (meters, seconds, degrees) and turned
// into fixed values once, here. A mistake is reported with the path and a line to copy, so an AI fixes it on the first try.
//
//   const content = loadContent({
//     armor: { light: { bullet: 1, shell: 0.5 }, heavy: { bullet: 0.2, shell: 1 } },          // damage multiplier: armor → damage type
//     weapons: { rifle: { range: 30, damage: 10, cooldown: 1, damageType: 'bullet' },
//                cannon: { range: 45, damage: 80, cooldown: 3, damageType: 'shell', projectileSpeed: 90, splash: 3 } },
//     units: { soldier: { hp: 100, speed: 3, radius: 0.5, sight: 30, armor: 'light', weapons: ['rifle'] },
//              tank: { hp: 600, speed: 8, radius: 2, sight: 40, armor: 'heavy', weapons: ['cannon'], turnRate: 120 } },
//   });
//
// Each kind keeps its name (`kind.name`) and a stable index (`kind.index`, sorted by name), so every machine numbers kinds the same way.
import { fx, ANGLE } from './fixed.js';
import { hashString, Hasher } from './hash.js';

/** Simulation ticks per second. One constant: systems read TICK_RATE, never restate 20. */
export const TICK_RATE = 20;

const UNIT_KEYS = { hp: 'number', speed: 'number', radius: 'number', sight: 'number', armor: 'string', weapons: 'array', turnRate: 'number',
  cost: 'number', air: 'boolean', tags: 'array', build: 'object', produces: 'array', supply: 'number', gather: 'object', structure: 'boolean',
  footprint: 'array', income: 'number', capture: 'boolean', deployTime: 'number' };
const WEAPON_KEYS = { range: 'number', minRange: 'number', damage: 'number', cooldown: 'number', damageType: 'string', projectileSpeed: 'number',
  splash: 'number', targets: 'array', arc: 'boolean', turret: 'boolean' };

function fail(path, msg, fix) {
  const e = new Error(`content ${path}: ${msg}${fix ? ` — fix: ${fix}` : ''}`);
  e.code = 'rts-content';
  throw e;
}

function checkKeys(obj, allowed, path) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(path, 'must be an object');
  for (const [k, v] of Object.entries(obj)) {
    const want = allowed[k];
    if (!want) fail(`${path}.${k}`, 'unknown key', `allowed keys: ${Object.keys(allowed).join(', ')}`);
    const got = Array.isArray(v) ? 'array' : typeof v;
    if (got !== want) fail(`${path}.${k}`, `must be a ${want}, got ${got}`);
    if (want === 'number' && !Number.isFinite(v)) fail(`${path}.${k}`, 'must be a finite number');
  }
}

const need = (obj, key, path, example) => { if (obj[key] === undefined) fail(`${path}.${key}`, 'is required', `e.g. ${key}: ${example}`); };

/**
 * Validate and convert content. Returns { kinds: [...by index], kind: { name → kind }, weapons, armor, hash, raw }.
 * Kind fields after loading (all fixed or integer): hp, speed (fixed m per tick), radius, sight, turnRate (angle units per tick),
 * weapons [{ name, range, minRange, damage, cooldown (ticks), damageType, projectileSpeed (fixed m per tick, 0 = instant), splash, targets }],
 * armor (name), air, cost, tags, plus the game's optional build / produces / supply / gather / income / capture fields.
 * @param {object} raw
 */
export function loadContent(raw) {
  if (!raw || typeof raw !== 'object') fail('', 'must be an object with units, weapons and armor');
  checkKeys(raw, { units: 'object', weapons: 'object', armor: 'object', factions: 'object', modes: 'object' }, 'content');
  if (!raw.units || !Object.keys(raw.units).length) fail('units', 'needs at least one unit kind', "units: { soldier: { hp: 100, speed: 3, radius: 0.5, sight: 30 } }");
  const armor = raw.armor ?? {};
  const weapons = Object.create(null);   // no prototype: a command naming '__proto__' or 'constructor' finds nothing
  for (const name of Object.keys(raw.weapons ?? {}).sort()) {
    const w = raw.weapons[name], p = `weapons.${name}`;
    checkKeys(w, WEAPON_KEYS, p);
    need(w, 'range', p, 30); need(w, 'damage', p, 10); need(w, 'cooldown', p, 1);
    if (w.damageType && Object.keys(armor).length && !Object.values(armor).some(a => w.damageType in a)) fail(`${p}.damageType`, `'${w.damageType}' appears in no armor table`, `add it to armor.<name>, e.g. armor: { light: { ${w.damageType}: 1 } }`);
    weapons[name] = {
      name, range: fx(w.range), minRange: fx(w.minRange ?? 0), damage: fx(w.damage),
      cooldown: Math.max(1, Math.round(w.cooldown * TICK_RATE)), damageType: w.damageType ?? 'normal',
      projectileSpeed: fx((w.projectileSpeed ?? 0) / TICK_RATE), splash: fx(w.splash ?? 0),
      targets: (w.targets ?? ['ground']).slice().sort(), arc: !!w.arc,
    };
  }
  for (const [a, table] of Object.entries(armor)) for (const [t, m] of Object.entries(table)) if (!Number.isFinite(m) || m < 0) fail(`armor.${a}.${t}`, 'must be a number >= 0 (damage multiplier)');
  const armorFx = Object.fromEntries(Object.entries(armor).map(([a, t]) => [a, Object.fromEntries(Object.entries(t).map(([k, m]) => [k, fx(m)]))]));
  const names = Object.keys(raw.units).sort();
  const kinds = [], kind = Object.create(null);
  names.forEach((name, index) => {
    const u = raw.units[name], p = `units.${name}`;
    checkKeys(u, UNIT_KEYS, p);
    need(u, 'hp', p, 100); need(u, 'radius', p, 0.5);
    if (!u.structure) { need(u, 'speed', p, 3); }
    for (const w of u.weapons ?? []) if (!weapons[w]) fail(`${p}.weapons`, `unknown weapon '${w}'`, `define weapons.${w} or use one of: ${Object.keys(weapons).join(', ') || '(none defined)'}`);
    if (u.armor && Object.keys(armor).length && !armor[u.armor]) fail(`${p}.armor`, `unknown armor '${u.armor}'`, `one of: ${Object.keys(armor).join(', ')}`);
    for (const pr of u.produces ?? []) if (!raw.units[pr]) fail(`${p}.produces`, `unknown unit kind '${pr}'`);
    const k = {
      name, index, hp: fx(u.hp), speed: fx((u.speed ?? 0) / TICK_RATE), radius: fx(u.radius), sight: fx(u.sight ?? 20),
      turnRate: Math.round(((u.turnRate ?? 720) / 360) * ANGLE / TICK_RATE), armor: u.armor ?? 'none', air: !!u.air,
      structure: !!u.structure, cost: Math.round(u.cost ?? 0), supply: Math.round(u.supply ?? 0), income: fx((u.income ?? 0) / TICK_RATE),
      capture: u.capture ?? !u.structure, deployTime: Math.round((u.deployTime ?? 0) * TICK_RATE),
      tags: (u.tags ?? []).slice().sort(), produces: (u.produces ?? []).slice(), footprint: u.footprint ?? null,
      build: u.build ? { time: Math.max(1, Math.round((u.build.time ?? 10) * TICK_RATE)), requires: (u.build.requires ?? []).slice() } : null,
      gather: u.gather ? { amount: Math.round(u.gather.amount ?? 10), time: Math.max(1, Math.round((u.gather.time ?? 2) * TICK_RATE)) } : null,
      weapons: (u.weapons ?? []).map(w => weapons[w]),
      hash: hashString(name),
    };
    k.range = k.weapons.reduce((m, w) => Math.max(m, w.range), 0);
    kinds.push(k); kind[name] = k;
  });
  for (const k of kinds) for (const r of k.build?.requires ?? []) if (!kind[r]) fail(`units.${k.name}.build.requires`, `unknown unit kind '${r}'`);
  const h = new Hasher().str(JSON.stringify(canonical(raw)));
  return { kinds, kind, weapons, armor: armorFx, factions: raw.factions ?? {}, modes: raw.modes ?? {}, hash: h.value, raw };
}

/** Damage multiplier (fixed) for a damage type against an armor; 1.0 when either is not in the tables */
export function armorFactor(content, armor, damageType) {
  return content.armor[armor]?.[damageType] ?? 65536;
}

/** JSON with keys sorted at every level, so the content hash does not depend on key order */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
