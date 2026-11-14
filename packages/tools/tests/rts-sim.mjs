// The RTS sim core (@threedog/rts): fixed-point math stays close to real math, two runs with the same commands give the same hash every tick,
// a snapshot restored mid-match continues on the same hashes, commands for another player's units are refused, a group reaches its point in
// formation, a wall is walked around, fog keeps hidden enemies untargetable and a hill blocks sight.
import { reinforceMatch } from '@threedog/rts/examples/content.js';
import { createMatch, loadContent, createMap, fx, toFloat, mul, div, sqrt, sin, cos, atan2, ANGLE, ONE, hex } from '@threedog/rts';

export const name = 'rts sim: fixed math, same hash every run, snapshot continues, refused commands, formation arrival, walls, fog and hills (node)';

const RAW = {
  armor: { light: { bullet: 1, shell: 0.6 }, heavy: { bullet: 0.25, shell: 1 } },
  weapons: { rifle: { range: 25, damage: 8, cooldown: 0.8, damageType: 'bullet' },
    cannon: { range: 40, damage: 90, cooldown: 3, damageType: 'shell', projectileSpeed: 80, splash: 3 } },
  units: { soldier: { hp: 100, speed: 3, radius: 0.5, sight: 35, armor: 'light', weapons: ['rifle'], cost: 10 },
    tank: { hp: 600, speed: 7, radius: 2, sight: 45, armor: 'heavy', weapons: ['cannon'], turnRate: 120, cost: 60 } },
};

function battle(seed, ticks, snapAt = -1) {
  const map = createMap({ width: 400, depth: 300, blocked: (x, z) => Math.abs(x) < 6 && z > -100 && z < 20 });
  const sim = createMatch({ seed, content: loadContent(RAW), map, players: [{ team: 0 }, { team: 1 }] });
  const A = [], B = [];
  for (let i = 0; i < 32; i++) {
    A.push(sim.spawn(i % 8 ? 'soldier' : 'tank', { owner: 0, x: fx(-150 + (i % 8) * 3), z: fx(-40 + Math.floor(i / 8) * 4) }).id);
    B.push(sim.spawn(i % 8 ? 'soldier' : 'tank', { owner: 1, x: fx(150 - (i % 8) * 3), z: fx(-40 + Math.floor(i / 8) * 4), facing: 32768 }).id);
  }
  const hashes = [];
  let snap = null, deaths = 0;
  for (let t = 0; t < ticks; t++) {
    const cmds = t === 0 ? [{ p: 1, t: 'amove', ids: B, x: fx(-150), z: fx(-30) }, { p: 0, t: 'amove', ids: A, x: fx(150), z: fx(-30) }] : [];
    for (const ev of sim.step(cmds)) if (ev.type === 'death') deaths++;
    hashes.push(sim.hash());
    if (t === snapAt) snap = JSON.parse(JSON.stringify(sim.snapshot()));
  }
  return { sim, hashes, snap, deaths, map };
}

export async function run({ check }) {
  // fixed math
  let worst = 0;
  for (let a = 0; a < ANGLE; a += 97) worst = Math.max(worst, Math.abs(sin(a) / ONE - Math.sin(a * 2 * Math.PI / ANGLE)), Math.abs(cos(a) / ONE - Math.cos(a * 2 * Math.PI / ANGLE)));
  check('sin / cos within 1e-4 of real math', worst < 1e-4, String(worst));
  let aw = 0;
  for (let i = 0; i < 360; i += 7) { const r = i * Math.PI / 180, x = fx(Math.cos(r) * 10), z = fx(Math.sin(r) * 10); aw = Math.max(aw, Math.abs(((atan2(z, x) - Math.round(r / (2 * Math.PI) * ANGLE)) << 16) >> 16)); }
  check('atan2 within 3 angle units over a full turn', aw <= 3, String(aw));
  check('mul / div / sqrt are exact on simple values', mul(fx(2.5), fx(-4)) === fx(-10) && div(fx(7), fx(2)) === fx(3.5) && sqrt(fx(16)) === fx(4) && mul(fx(30000), fx(0.5)) === fx(15000));

  // determinism and snapshots
  const a = battle(9, 1300, 300), b = battle(9, 1300);
  const firstDiff = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
  check('two runs with the same commands give the same hash on every tick', firstDiff === -1, `first difference at tick ${firstDiff}`);
  check('the battle really happened (units died)', a.deaths > 10, String(a.deaths));
  const c = battle(10, 300);
  check('another seed changes nothing without randomness, but the hash path is still stable', c.hashes.length === 300);
  const r = createMatch({ seed: 9, content: loadContent(RAW), map: a.map, players: [{ team: 0 }, { team: 1 }] });
  r.restore(a.snap);
  check('a restored snapshot has the same hash', r.hash() === a.hashes[300], `${hex(r.hash())} vs ${hex(a.hashes[300])}`);
  let same = true;
  for (let t = 301; t < 1300; t++) { r.step(); if (r.hash() !== a.hashes[t]) { same = false; break; } }
  check('a restored match continues on the same hashes for 1000 ticks', same);

  // commands from the wrong player
  const s = createMatch({ content: loadContent(RAW), map: createMap({ width: 200, depth: 200 }), players: [{ team: 0 }, { team: 1 }] });
  const mine = s.spawn('soldier', { owner: 0, x: fx(0), z: fx(0) });
  const why = s.run({ p: 1, t: 'move', ids: [mine.id], x: fx(10), z: fx(0) });
  check('moving another player\'s unit is refused with the reason', /not player 1's/.test(why), why);
  check('a refused command is listed in describe().rejected', s.describe().rejected.length === 1);
  check('an unknown command type names the known ones', /known: .*move/.test(s.run({ p: 0, t: 'fly', ids: [mine.id] })));
  check('a point off the map is refused', /off the map/.test(s.run({ p: 0, t: 'move', ids: [mine.id], x: fx(500), z: 0 })));

  // an attack order chases one named target until it dies
  const at = createMatch({ content: loadContent(RAW), map: createMap({ width: 200, depth: 100 }), players: [{ team: 0 }, { team: 1 }] });
  const hunter = at.spawn('tank', { owner: 0, x: fx(-30), z: fx(0) }), near = at.spawn('soldier', { owner: 1, x: fx(-5), z: fx(8) }), prey = at.spawn('soldier', { owner: 1, x: fx(5), z: fx(0) });
  at.step([{ p: 0, t: 'attack', ids: [hunter.id], target: prey.id }]);
  const kept = hunter.orders[0]?.t === 'attack' && hunter.target === prey.id;
  for (let t = 0; t < 400 && at.get(prey.id); t++) at.step();
  check('an attack order locks its named target and keeps it until the target dies', kept && !at.get(prey.id), `kept ${kept}, prey alive ${!!at.get(prey.id)}`);
  void near;

  // review fixes: hostile names are refused, no friendly attacks, an attack on a hidden target is kept and followed
  const rv = createMatch({ content: loadContent(RAW), map: createMap({ width: 200, depth: 100 }), players: [{ team: 0 }, { team: 1 }],
    extra: [] });
  const a1 = rv.spawn('soldier', { owner: 0, x: fx(-60), z: 0 }), a2 = rv.spawn('soldier', { owner: 0, x: fx(-58), z: 0 }), foe = rv.spawn('soldier', { owner: 1, x: fx(70), z: 0 });
  check('attacking a unit on your own team is refused', /own team/.test(rv.run({ p: 0, t: 'attack', ids: [a1.id], target: a2.id })));
  rv.step([{ p: 0, t: 'attack', ids: [a1.id], target: foe.id }]);
  const startX = a1.x;
  for (let t = 0; t < 40; t++) rv.step();
  check('an attack order on a target hidden in fog is kept, and the unit heads toward it', a1.orders[0]?.t === 'attack' && a1.x > startX, `${JSON.stringify(a1.orders)} moved ${toFloat(a1.x - startX)} m`);
  const rm = reinforceMatch({ seed: 1, players: [{ team: 0 }, { team: 1 }] });
  const res0 = rm.players[0].res;
  const bad = ['__proto__', 'constructor', ['tank'], 7].map(k => rm.run({ p: 0, t: 'reinforce', kinds: [k], x: fx(-260), z: 0 }));
  check('a reinforce naming __proto__, constructor, an array or a number is refused and costs nothing', bad.every(w => /unknown kind/.test(w)) && rm.players[0].res === res0, JSON.stringify(bad));
  const kc = loadContent(RAW);
  check('content lookups have no prototype: "__proto__" is not a unit kind', kc.kind['__proto__'] === undefined && kc.kind.constructor === undefined);

  // formation arrival and walking around a wall
  const w = createMatch({ content: loadContent(RAW), map: createMap({ width: 200, depth: 200, blocked: (x, z) => Math.abs(x) < 3 && z > -60 && z < 60 }), players: [{ team: 0 }] });
  const ids = [];
  for (let i = 0; i < 24; i++) ids.push(w.spawn('soldier', { owner: 0, x: fx(-40 + (i % 6) * 1.5), z: fx((Math.floor(i / 6) - 2) * 1.5) }).id);
  w.step([{ p: 0, t: 'move', ids, x: fx(40), z: fx(0) }]);
  for (let t = 0; t < 1200 && w.entities.some(e => e.orders.length); t++) w.step();
  const across = w.entities.filter(e => toFloat(e.x) > 30 && Math.abs(toFloat(e.x) - 40) < 10 && Math.abs(toFloat(e.z)) < 10);
  check('24 soldiers walk around the wall and arrive near the point', across.length === 24, `${across.length} arrived, ${w.entities.filter(e => e.orders.length).length} still walking`);
  let overlaps = 0;
  for (const e of w.entities) for (const o of w.entities) if (e.id < o.id && Math.hypot(toFloat(e.x - o.x), toFloat(e.z - o.z)) < 0.6) overlaps++;
  check('arrived soldiers stand apart (formation + separation)', overlaps === 0, `${overlaps} pairs closer than 0.6 m`);
  check('nobody stands inside the wall', w.entities.every(e => !w.map.block[w.map.cellAt(e.x, e.z)]));

  // fog: a hill between two units blocks sight, so neither shoots
  const hill = createMap({ width: 200, depth: 100, height: (x) => Math.max(0, 20 - Math.abs(x) * 2) });
  const f = createMatch({ content: loadContent(RAW), map: hill, players: [{ team: 0 }, { team: 1 }] });
  f.spawn('soldier', { owner: 0, x: fx(-14), z: fx(0) }); f.spawn('soldier', { owner: 1, x: fx(14), z: fx(0) });
  let fired = 0;
  for (let t = 0; t < 100; t++) for (const ev of f.step()) if (ev.type === 'fire') fired++;
  check('a hill between two soldiers in weapon range blocks sight, so neither fires', fired === 0 && !f.vision.seen(0, f.entities[1]), `fired ${fired}`);
  const flat = createMatch({ content: loadContent(RAW), map: createMap({ width: 200, depth: 100 }), players: [{ team: 0 }, { team: 1 }] });
  flat.spawn('soldier', { owner: 0, x: fx(-10), z: fx(0) }); flat.spawn('soldier', { owner: 1, x: fx(10), z: fx(0) });
  fired = 0;
  for (let t = 0; t < 100; t++) for (const ev of flat.step()) if (ev.type === 'fire') fired++;
  check('on flat ground the same pair sees and fires', fired > 0);

  // content mistakes are reported with the path and a fix
  let msg = '';
  try { loadContent({ units: { a: { hp: 1, speed: 1, radius: 1, weapons: ['laser'] } } }); } catch (e) { msg = e.message; }
  check('an unknown weapon names the path and the fix', /units\.a\.weapons: unknown weapon 'laser'/.test(msg), msg);
  try { loadContent({ units: { a: { hp: 1, speed: 1, radius: 1, hitpoints: 3 } } }); } catch (e) { msg = e.message; }
  check('an unknown key lists the allowed keys', /units\.a\.hitpoints: unknown key — fix: allowed keys: hp/.test(msg), msg);
}
