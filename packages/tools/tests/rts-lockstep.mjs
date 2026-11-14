// RTS lockstep over an in-process relay with latency and jitter: three players fight for 30 s and their sims agree on every tick; a deliberate
// determinism bug is caught by the relay within a second and the client keeps a state dump; a dropped player rejoins with its key, catches
// up and agrees again; a player gone too long becomes a 'leave' in every sim; an observer runs the same match behind a delay; a replay made
// from the log verifies, and a tampered replay names the first turn that differs. Finally the real WebSocket relay answers a hello.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createMatch, loadContent, createMap, fx, lockstepDriver, memoryNetwork, webSocketTransport, makeReplay, verifyReplay, HASH_EVERY } from '@threedog/rts';

export const name = 'rts lockstep: 3 players agree every tick over jitter, desync caught, rejoin catches up, leave, observer, replays verify, relay server answers (node)';

const RAW = {
  armor: { light: { bullet: 1 } },
  weapons: { rifle: { range: 22, damage: 9, cooldown: 0.7, damageType: 'bullet', projectileSpeed: 70, splash: 1.5 } },
  units: { soldier: { hp: 100, speed: 3.5, radius: 0.5, sight: 32, armor: 'light', weapons: ['rifle'], cost: 10 } },
};
const content = loadContent(RAW), map = createMap({ width: 300, depth: 300, blocked: (x, z) => Math.hypot(x, z) < 12 });

function makeSim(settings, extraHp = 0) {
  const sim = createMatch({ seed: settings.seed, content, map, players: settings.players });
  settings.players.forEach((p, i) => {
    const a = (i / settings.players.length) * Math.PI * 2;   // positions are computed once here and turned into fixed: same on every client
    for (let k = 0; k < 10; k++) sim.spawn('soldier', { owner: i, x: fx(Math.round(Math.cos(a) * 110) + (k % 5) * 2), z: fx(Math.round(Math.sin(a) * 110) + Math.floor(k / 5) * 2) });
  });
  if (extraHp) sim.entities[0].hp += extraHp;
  return sim;
}

function setup(net, n, o = {}) {
  const drivers = [];
  for (let i = 0; i < n; i++) drivers.push(lockstepDriver({ transport: net.connect(), name: `p${i}`, version: 't', contentHash: content.hash, mapHash: map.hash,
    debugSnapshots: true, now: () => net.now, makeSim: s => makeSim(s, o.bug === i ? 7 : 0) }));
  return drivers;
}

/** Advance real time by `sec` seconds in 1/60 s frames; record each client's hash per tick */
function play(net, drivers, sec, onFrame, hashes) {
  const frames = Math.round(sec * 60);
  for (let f = 0; f < frames; f++) {
    net.advance(1000 / 60);
    drivers.forEach((d, i) => {
      if (!d) return;
      const before = d.sim?.tick ?? 0;
      d.update(1 / 60);
      if (d.sim && hashes && d.sim.tick !== before) (hashes[i] ??= new Map()).set(d.sim.tick, d.sim.hash());
    });
    onFrame?.(f);
  }
}

function startMatch(net, drivers) {
  // waits on conditions, not times: a slow link takes longer for each handshake
  const until = (cond, sec = 8) => { for (let f = 0; f < sec * 60 && !cond(); f++) play(net, drivers, 1 / 60); };
  until(() => drivers.every(d => d.player !== -1 || d.status === 'lobby') && drivers.filter(d => d.lobby).length >= drivers.filter(d => d.player >= 0).length);
  // jitter decides who arrived first: slot 0 is the host, whoever that is
  drivers.filter(d => d.player > 0).forEach(d => d.ready(true));
  const players = drivers.filter(d => d.player >= 0).length;
  until(() => drivers.some(d => d.lobby?.slots.length === players && d.lobby.slots.filter((x, i) => i !== d.lobby.host).every(x => x.ready)));
  drivers.find(d => d.player === 0).start({});
  until(() => drivers.every(d => d.sim));
}

const orders = (d, x, z) => { const ids = d.sim.entities.filter(e => e.owner === d.player).map(e => e.id); if (ids.length) d.issue({ t: 'amove', ids, x: fx(x), z: fx(z) }); };

function agree(hashes) {
  let compared = 0, bad = null;
  for (const [tick, h] of hashes[0]) for (let i = 1; i < hashes.length; i++) {
    if (!hashes[i]?.has(tick)) continue;
    compared++;
    if (hashes[i].get(tick) !== h && !bad) bad = { tick, client: i };
  }
  return { compared, bad };
}

export async function run({ check }) {
  // 1. three players, latency + jitter, 30 seconds of fighting
  {
    const net = memoryNetwork({ latency: 60, jitter: 40, room: { observerDelay: 20 } });
    const ds = setup(net, 3);
    const obs = lockstepDriver({ transport: net.connect(), observer: true, version: 't', contentHash: content.hash, mapHash: map.hash, now: () => net.now, makeSim });
    startMatch(net, [...ds, obs]);
    check('all three clients and the observer got the start', ds.every(d => d.sim) && !!obs.sim, ds.map(d => d.status).join());
    const hashes = [];
    play(net, [...ds, obs], 30, f => {
      if (f === 30) ds.forEach((d, i) => orders(d, i === 0 ? 0 : -20, i === 2 ? 20 : 0));
      if (f === 900) ds.forEach(d => orders(d, 0, 0));
    }, hashes);
    const a = agree(hashes.slice(0, 3));
    check('the three sims agree on every common tick', a.compared > 1000 && !a.bad, JSON.stringify(a));
    check('the relay saw no desync', net.room.desyncs.length === 0 && ds.every(d => !d.desyncs.length));
    check('units fought (some died)', ds[0].sim.entities.length < 30, String(ds[0].sim.entities.length));
    const ob = agree([hashes[0], hashes[3]]);
    check('the observer runs the same match behind its delay', ob.compared > 300 && !ob.bad && obs.sim.tick < ds[0].sim.tick, JSON.stringify(ob));
    check('observers cannot give orders', /observers/.test(obs.issue({ t: 'stop', ids: [1] })));
    check('a client is never ahead of the turns it has', ds.every(d => d.describe().received >= Math.floor((d.sim.tick - 1) / 2)));

    // replays
    const rep = makeReplay(ds[0], { version: 't', makeSim });
    const v = verifyReplay(rep, makeSim);
    check('a replay made from the log verifies', v.ok && v.turns > 250, JSON.stringify({ ok: v.ok, turns: v.turns, why: v.why, m: v.firstMismatch }));
    check('the replay ends on the live hash', v.sim.hash() === hashOfTurnEnd(ds[0], rep.lastTurn, makeSim));
    const bad = JSON.parse(JSON.stringify(rep));
    bad.turns[0][1][0].x += fx(5);
    const vb = verifyReplay(bad, makeSim);
    check('a tampered replay names the first turn whose hash differs', !vb.ok && vb.firstMismatch && vb.firstMismatch.turn % HASH_EVERY === 0, JSON.stringify(vb.firstMismatch));
    check('a replay is small (JSON under 20 KB for 30 s)', JSON.stringify(rep).length < 20000, String(JSON.stringify(rep).length));
  }

  // 1b. a bad connection: 200 ms latency, 60 ms jitter, 5% of messages 300 ms late (TCP resends): still in sync, and an order lands within half a second
  {
    const net = memoryNetwork({ latency: 200, jitter: 60, spikes: { chance: 0.05, ms: 300 }, seed: 11 });
    const ds = setup(net, 3);
    startMatch(net, ds);
    const hashes = [];
    let sentAt = -1, appliedAt = -1;
    play(net, ds, 20, f => {
      if (f === 60) { orders(ds[0], 0, 0); sentAt = net.now; }
      if (sentAt >= 0 && appliedAt < 0 && ds[0].sim.entities.some(e => e.owner === ds[0].player && e.orders.length)) appliedAt = net.now;
      if (f === 400) ds.forEach(d => orders(d, 10, 10));
    }, hashes);
    const a = agree(hashes);
    check('200 ms latency, jitter and 5% late messages: three sims agree on every common tick', ds.every(d => d.sim) && a.compared > 400 && !a.bad, JSON.stringify(a));
    check('no desync on the bad connection', net.room.desyncs.length === 0);
    const lag = appliedAt - sentAt;
    check('an order takes effect within 750 ms on the bad connection (2 x 200 ms network + up to 1 turn + the buffer)', lag > 0 && lag < 750, `${Math.round(lag)} ms, buffer ${ds[0].buffer}`);
    check('every client keeps up (within a few turns of the newest turn)', ds.every(d => d.describe().behindTurns <= 6), JSON.stringify(ds.map(d => d.describe().behindTurns)));
  }

  // 2. a determinism bug in one client is caught by the relay within about a second
  {
    const net = memoryNetwork({ latency: 30, jitter: 10 });
    const ds = setup(net, 2, { bug: 1 });
    startMatch(net, ds);
    play(net, ds, 3);
    const first = net.room.desyncs[0];
    check('the relay reports the desync to both clients', first && ds.every(d => d.desyncs.length > 0), JSON.stringify(first));
    check('it is caught at the first hash turn (turn 0)', first?.turn === 0, String(first?.turn));
    check('each client kept a state dump for that turn', !!ds[0].dump(first?.turn) && !!ds[1].dump(first?.turn));
    const e0 = ds[0].dump(first.turn).entities[0], e1 = ds[1].dump(first.turn).entities[0];
    check('the dumps show the difference', e0.hp !== e1.hp, `${e0.hp} vs ${e1.hp}`);
  }

  // 3. a dropped player rejoins with its key and catches up; a player gone too long leaves in every sim
  {
    const net = memoryNetwork({ latency: 50, jitter: 30, room: { leaveAfterMs: 4000 } });
    const ds = setup(net, 3);
    startMatch(net, ds);
    const hashes = [];
    play(net, ds, 2, f => { if (f === 10) ds.forEach(d => orders(d, 0, 0)); }, hashes);
    const key = ds[1].key, back = ds[1].player, goneP = ds[2].player, stay = ds[0];
    net.drop(ds[1].transport);
    play(net, ds, 0.5);
    net.drop(ds[2].transport);
    ds[1] = null; ds[2] = null;
    play(net, ds, 2);
    ds[1] = lockstepDriver({ transport: net.connect(), key, version: 't', contentHash: content.hash, mapHash: map.hash, now: () => net.now, makeSim });
    const h2 = [];
    play(net, ds, 4, null, h2);
    check('the rejoined client got its old slot', ds[1].player === back, `${ds[1].player} vs ${back}`);
    check('it caught up to the others (within a few turns)', Math.abs(ds[1].sim.tick - ds[0].sim.tick) <= 10, `${ds[1].sim.tick} vs ${ds[0].sim.tick}`);
    const a = agree([h2[0], h2[1]]);
    check('after catching up it agrees with the others on every common tick', a.compared > 50 && !a.bad, JSON.stringify(a));
    check('the player gone longer than leaveAfterMs has left in every sim', stay.sim.players[goneP].left && ds[1].sim.players[goneP].left, JSON.stringify(stay.sim.players.map(p => p.left)));
    check('the rejoined player has not left', !stay.sim.players[back].left);
    check('no desync through all of it', net.room.desyncs.length === 0);
  }

  // 4. the real relay server: hello gets a welcome
  {
    const req = createRequire(import.meta.url), dir = dirname(req.resolve('@threedog/rts/package.json'));
    const port = 40000 + Math.floor(Math.random() * 20000);
    const proc = spawn(process.execPath, [join(dir, 'net/relay.mjs'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((ok, no) => { proc.stdout.on('data', d => /relay on/.test(d) && ok()); proc.on('exit', c => no(new Error(`relay exited ${c}`))); setTimeout(() => no(new Error('relay did not start')), 5000); });
      const got = await new Promise(ok => {
        const d = lockstepDriver({ transport: webSocketTransport(`ws://127.0.0.1:${port}/test-room`), name: 'x', version: 't', makeSim });
        d.on('lobby', l => { ok(l); d.close(); });
        setTimeout(() => ok(null), 3000);
      });
      check('the WebSocket relay answers a hello with the lobby', got?.slots?.[0]?.name === 'x', JSON.stringify(got));
    } finally { proc.kill(); }
  }
}

function hashOfTurnEnd(d, lastTurn, mk) {
  const sim = mk(d.settings);
  const byTurn = new Map(d.log.map(t => [t.turn, t.cmds]));
  for (let t = 0; t <= lastTurn; t++) for (let i = 0; i < 2; i++) sim.step(i === 0 ? byTurn.get(t) ?? [] : []);
  return sim.hash();
}
