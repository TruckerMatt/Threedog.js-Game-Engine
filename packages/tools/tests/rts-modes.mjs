// RTS game modes and bots: reinforcement drops (zones, budget, delay, arrival, refunds), capture points and score victory, base building
// (placement rules, build time, production, supply, rally, gathering, blocked cells, snapshots) and the bots (two bots finish a match, replay
// to the same hash, never send a refused command, build an army, and never shoot at what their team cannot see).
import { createMatch, loadContent, createMap, fx, TICK_RATE, reinforceSystem, captureSystem, baseSystem, victorySystem } from '@threedog/rts';
import { BASE_CONTENT, exampleMap, reinforceMatch, baseMatch } from '@threedog/rts/examples/content.js';

export const name = 'rts modes: reinforcement drops and refunds, capture points and victory, base building and gathering, snapshots, bots finish, build armies and respect fog (node)';

const RAW = {
  armor: { light: { bullet: 1 } },
  weapons: {},
  units: { pawn: { hp: 100, speed: 3, radius: 0.5, sight: 30, armor: 'light', cost: 20 }, hulk: { hp: 500, speed: 4, radius: 2, sight: 30, armor: 'light', cost: 150 } },
};
const content = loadContent(RAW);
const map = () => createMap({ width: 600, depth: 400 });

/** A test-only system that kills the ids queued in sim.killIds during its step (so mode systems installed after it see the death this tick) */
const killer = () => ({ name: 'test-kill', init(sim) { sim.killIds = []; },
  step(sim) { for (const id of sim.killIds.splice(0)) { const e = sim.get(id); if (e) sim.kill(e); } } });

function reinforce(o = {}) {
  return createMatch({ seed: 3, content, map: map(), players: [{ team: 0 }, { team: 1 }],
    extra: [killer(), reinforceSystem({ budget: 1500, deployDelay: 6, refundDelay: 20, zones: [{ team: 0, x: -260, z: 0, radius: 40 }, { team: 1, x: 260, z: 0, radius: 40 }] }),
      captureSystem({ points: [{ id: 'a', x: 0, z: 100, radius: 15, value: 2 }, { id: 'b', x: 0, z: -100, radius: 15 }] }),
      victorySystem({ scoreLimit: o.scoreLimit ?? 100000 })] });
}

/** Step n ticks (cmds go in on the first one); calls on(event) for every event */
function stepN(sim, n, on, cmds = []) {
  for (let i = 0; i < n; i++) for (const ev of sim.step(i === 0 ? cmds : [])) on?.(ev);
}

const settings2 = bots => ({ seed: 11, players: [{ team: 0, ...(bots ? { bot: { level: 'normal' } } : {}) }, { team: 1, ...(bots ? { bot: { level: 'normal' } } : {}) }] });
const mine = (sim, p, kind) => sim.entities.filter(e => e.owner === p && !e.dead && (!kind || sim.kindOf(e).name === kind));

export async function run({ check }) {
  // ---- 1-3: reinforcement ----
  {
    const sim = reinforce(), drop = (kinds, x, z) => ({ p: 0, t: 'reinforce', kinds, x: fx(x), z: fx(z) });
    const outside = sim.run(drop(['pawn'], 0, 0));
    check('a drop outside the team\'s zones is refused with a zone reason', /zone/.test(outside), outside);
    const enemyZone = sim.run(drop(['pawn'], 260, 0));
    check('a drop inside the ENEMY team\'s zone is refused too', /zone/.test(enemyZone), enemyZone);
    const broke = sim.run(drop(Array(11).fill('hulk'), -260, 0));
    check('a drop costing more than the budget is refused with the costs', /costs 1650/.test(broke), broke);
    check('refused drops cost nothing', sim.players[0].res === 1500, String(sim.players[0].res));

    const kinds = ['hulk', 'pawn', 'pawn'], cost = 190;
    let arrive = null, ordered = null;
    sim.step([drop(kinds, -260, 0)]);
    check('a valid drop lowers res by the summed costs', sim.players[0].res === 1500 - cost, String(sim.players[0].res));
    const at = 0 + 6 * TICK_RATE;
    let early = false;
    while (sim.tick < at) for (const ev of sim.step()) { if (ev.type === 'arrive') early = true; if (ev.type === 'reinforce') ordered = ev; }
    check('no unit arrives before deployDelay', !early && mine(sim, 0).length === 0, `tick ${sim.tick}, units ${mine(sim, 0).length}`);
    for (const ev of sim.step()) if (ev.type === 'arrive') arrive = ev;
    check('units arrive at deployDelay with an arrive event listing their ids', arrive && arrive.tick === at && arrive.ids.length === 3 && arrive.ids.every(id => sim.get(id)), JSON.stringify(arrive));
    const near = mine(sim, 0).every(e => Math.hypot(e.x - fx(-260), e.z) < fx(6));
    check('arrived units stand at the drop point', near && mine(sim, 0).length === 3);

    // refund
    const pawn = mine(sim, 0, 'pawn')[0], before = sim.players[0].res;
    sim.killIds.push(pawn.id);
    let deathTick = -1, rose = -1;
    for (let i = 0; i < 500; i++) {
      for (const ev of sim.step()) if (ev.type === 'death' && ev.id === pawn.id) deathTick = ev.tick;
      if (rose < 0 && sim.players[0].res > before) rose = sim.tick - 1;
    }
    check('a dead unit\'s cost returns after refundDelay, not before', deathTick >= 0 && rose === deathTick + 20 * TICK_RATE && sim.players[0].res === before + 20,
      `died ${deathTick}, res rose at ${rose}, res ${sim.players[0].res} (was ${before})`);
  }

  // ---- 4: capture and victory ----
  {
    const sim = reinforce();
    for (let i = 0; i < 3; i++) sim.spawn('pawn', { owner: 0, x: fx(i), z: fx(100) });
    sim.spawn('pawn', { owner: 1, x: fx(250), z: fx(0) });
    let taken = null;
    stepN(sim, 300, ev => { if (ev.type === 'point-taken') taken = ev; });
    const a = sim.capture.points[0];
    check('three of one team alone in a point bring it to 100% and emit point-taken', a.amount === 100 && a.holder === 0 && taken?.team === 0 && taken.id === 'a', JSON.stringify({ amount: a.amount, holder: a.holder, taken }));
    while (sim.tick % TICK_RATE !== 0) sim.step();
    const s0 = sim.teamScore[0];
    stepN(sim, 100);
    check('team score grows by the point value once a second while held', sim.teamScore[0] - s0 === 5 * 2, `${s0} -> ${sim.teamScore[0]}`);
    check('an unheld team scores nothing', sim.teamScore[1] === 0, String(sim.teamScore[1]));

    const b = sim.capture.points[1];
    for (let i = 0; i < 3; i++) sim.spawn('pawn', { owner: 0, x: fx(i), z: fx(-100) });
    stepN(sim, 40);
    const part = b.amount;
    sim.spawn('pawn', { owner: 1, x: fx(3), z: fx(-100) });
    stepN(sim, 100);
    check('a contested point does not change', part > 0 && part < 100 && b.amount === part && b.contested === 1 && b.holder === 0, `before ${part}, after ${b.amount}, contested ${b.contested}`);
  }
  {
    const sim = reinforce({ scoreLimit: 8 });
    for (let i = 0; i < 3; i++) sim.spawn('pawn', { owner: 0, x: fx(i), z: fx(100) });
    sim.spawn('pawn', { owner: 1, x: fx(250), z: fx(0) });
    let end = null;
    stepN(sim, 800, ev => { if (ev.type === 'end') end = ev; });
    check('victorySystem({ scoreLimit }) ends the match with the scoring team as winner', sim.ended && sim.winner === 0 && end?.winner === 0 && /score limit/.test(end.reason) && sim.teamScore[0] >= 8,
      `ended ${sim.ended}, winner ${sim.winner}, score ${JSON.stringify(sim.teamScore)}, ${JSON.stringify(end)}`);
  }

  // ---- 5-8: base building ----
  const base = () => baseMatch(settings2(false));
  const hqOf = (sim, p) => mine(sim, p, 'hq')[0];
  {
    const sim = base(), hq = hqOf(sim, 0), bd = (kind, x, z) => ({ p: 0, t: 'build', kind, x: fx(x), z: fx(z) });
    const r1 = sim.run(bd('depot', -240, 0)), r2 = sim.run(bd('depot', -150, 0)), r3 = sim.run(bd('factory', -240, 30));
    const keep = sim.players[0].res; sim.players[0].res = 10;
    const r4 = sim.run(bd('depot', -240, 30)); sim.players[0].res = keep;
    check('build is refused on blocked ground', /blocked/.test(r1), r1);
    check('build is refused too far from your structures', /too far/.test(r2), r2);
    check('build is refused without the required structure', /needs barracks/.test(r3), r3);
    check('build is refused without enough res', /costs 100/.test(r4), r4);

    const depot = content_depot(sim), cells = sim.base.cellsOf(depot, fx(-240), fx(30));
    check('footprint cells are open before building', cells.length > 0 && cells.every(c => sim.map.block[c] === 0));
    let built = null, placed = null;
    for (const ev of sim.step([bd('depot', -240, 30)])) if (ev.type === 'placed') placed = ev;
    const d = sim.get(placed?.id);
    check('a valid build costs res, blocks its footprint and starts in phase BUILDING (1)', d && d.phase === 1 && sim.players[0].res === keep - 100 && cells.every(c => sim.map.block[c] === 1) && d.hp < depot.hp,
      `phase ${d?.phase}, res ${sim.players[0].res}`);
    let n = 0;
    while (!built && n++ < 400) for (const ev of sim.step()) if (ev.type === 'built' && ev.id === d.id) built = ev;
    check('the structure becomes ready (phase 0) with full hp after its build time, emitting built', built && d.phase === 0 && d.hp === depot.hp && n >= depot.build.time - 1 && n <= depot.build.time + 1, `after ${n} ticks, build time ${depot.build.time}`);
    void hq;
  }
  {
    const sim = base(), hq = hqOf(sim, 0);
    sim.players[0].res = 500;
    sim.run({ p: 0, t: 'produce', id: hq.id, kind: 'worker', count: 2 });
    check('produce charges the cost up front', sim.players[0].res === 400 && hq.queue.length === 2, `res ${sim.players[0].res}`);
    sim.run({ p: 0, t: 'cancel', id: hq.id });
    check('cancel refunds the last queued unit', sim.players[0].res === 450 && hq.queue.length === 1, `res ${sim.players[0].res}, queue ${hq.queue.length}`);
    check('rally is accepted', sim.run({ p: 0, t: 'rally', id: hq.id, x: fx(-200), z: fx(40) }) === '');
    let prod = null;
    stepN(sim, 260, ev => { if (ev.type === 'produced' && !prod) { prod = ev; const u = sim.get(ev.id); prod.order = u?.orders[0] && { ...u.orders[0] }; } });
    check('a produced unit with a rally point gets a move order there', prod?.kind === 'worker' && prod.order?.t === 'move' && prod.order.x === fx(-200) && prod.order.z === fx(40), JSON.stringify(prod));
  }
  {
    const sim = base(), hq = hqOf(sim, 0);
    for (let i = 0; i < 6; i++) sim.spawn('worker', { owner: 0, x: fx(-225 + i), z: fx(-20) });
    sim.run({ p: 0, t: 'produce', id: hq.id, kind: 'worker' });
    let blocked = null, produced = false;
    stepN(sim, 260, ev => { if (ev.type === 'supply-blocked') blocked = ev; if (ev.type === 'produced') produced = true; });
    check('production stalls with a supply-blocked event when supply is full', blocked && blocked.used === 10 && blocked.cap === 10 && !produced && hq.queue.length === 1, JSON.stringify(blocked));
  }
  {
    const sim = base(), crystal = sim.entities.filter(e => e.owner < 0 && sim.kindOf(e).name === 'crystal').sort((a, b) => Math.hypot(a.x + fx(240), a.z) - Math.hypot(b.x + fx(240), b.z))[0];
    const cells = [...sim.base.blocked.get(crystal.id)];
    crystal.hp = fx(24);
    const workers = mine(sim, 0, 'worker').map(w => w.id), start = sim.players[0].res;
    let total = 0, deposits = 0, depleted = null;
    stepN(sim, 1500, ev => { if (ev.type === 'deposit' && ev.owner === 0) { total += ev.amount; deposits++; } if (ev.type === 'depleted' && ev.id === crystal.id) depleted = ev; }, [{ p: 0, t: 'gather', ids: workers, target: crystal.id }]);
    check('workers on gather bring resources back: res rises with deposit events', deposits >= 3 && total >= 24 && sim.players[0].res === start + total, `${deposits} deposits, ${total} carried, res ${start} -> ${sim.players[0].res}`);
    check('a depleted field emits depleted and disappears', depleted && !sim.get(crystal.id) && !sim.entities.includes(crystal) && cells.every(c => sim.map.block[c] === 0), JSON.stringify(depleted));
  }
  {
    const sim = createMatch({ seed: 2, content: loadContent(BASE_CONTENT), map: exampleMap(), players: [{ team: 0 }, { team: 1 }],
      extra: [killer(), baseSystem({ startRes: 500, start: [{ p: 0, x: -240, z: 0, kinds: ['hq'] }, { p: 1, x: 240, z: 0, kinds: ['hq'] }] })] });
    let placed = null;
    for (const ev of sim.step([{ p: 0, t: 'build', kind: 'depot', x: fx(-240), z: fx(30) }])) if (ev.type === 'placed') placed = ev;
    const cells = [...sim.base.blocked.get(placed.id)];
    const was = cells.every(c => sim.map.block[c] === 1);
    sim.killIds.push(placed.id);
    sim.step();
    check('a destroyed structure unblocks its cells', was && !sim.get(placed.id) && cells.every(c => sim.map.block[c] === 0) && !sim.base.blocked.has(placed.id), `blocked before ${was}`);
  }

  // ---- 9: snapshot mid base match ----
  {
    const a = base(), b = base(), hq = hqOf(a, 0);
    const crystal = a.entities.find(e => e.owner < 0 && a.kindOf(e).name === 'crystal');
    const cmds = { 0: [{ p: 0, t: 'build', kind: 'depot', x: fx(-240), z: fx(30) }, { p: 0, t: 'produce', id: hq.id, kind: 'worker', count: 2 },
      { p: 0, t: 'gather', ids: mine(a, 0, 'worker').map(e => e.id), target: crystal.id }, { p: 1, t: 'build', kind: 'barracks', x: fx(240), z: fx(-30) }], 10: [{ p: 0, t: 'build', kind: 'barracks', x: fx(-240), z: fx(-30) }] };
    for (let t = 0; t < 400; t++) a.step(cmds[t] ?? []);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    b.restore(snap);
    check('a restored base match has the same hash and the same blocked cells', a.hash() === b.hash() && Buffer.compare(Buffer.from(a.map.block), Buffer.from(b.map.block)) === 0 && a.base.blocked.size === b.base.blocked.size, `${a.hash()} vs ${b.hash()}`);
    let diff = -1;
    const more = { 50: [{ p: 0, t: 'build', kind: 'depot', x: fx(-260), z: fx(0) }] };
    for (let t = 0; t < 600 && diff < 0; t++) { a.step(more[t] ?? []); b.step(more[t] ?? []); if (a.hash() !== b.hash()) diff = t; }
    check('the restored match stays equal for 600 more ticks (new structures included)', diff < 0 && a.rejected.length === 0, `first difference ${diff}, rejected ${JSON.stringify(a.rejected.slice(-2))}`);
  }

  // ---- 10: reinforce bots ----
  {
    const play = () => { const sim = reinforceMatch(settings2(true)); let n = 0; while (!sim.ended && n++ < 15 * 60 * TICK_RATE) sim.step(); return { sim, hash: sim.hash() }; };
    const x = play(), y = play();
    check('two normal bots finish a reinforcement match within 15 minutes with a winner', x.sim.ended && x.sim.winner >= 0 && x.sim.tick <= 15 * 60 * TICK_RATE + TICK_RATE, `ended ${x.sim.ended}, winner ${x.sim.winner}, ${x.sim.endReason}, ${(x.sim.tick / TICK_RATE).toFixed(0)} s`);
    check('the same seed gives the same final hash on two runs', x.hash === y.hash && x.sim.tick === y.sim.tick, `${x.hash} vs ${y.hash}`);
    check('reinforcement bots send no refused commands', x.sim.rejected.length === 0, JSON.stringify(x.sim.rejected.slice(0, 3)));
  }

  // ---- 11: base bots ----
  {
    const play = () => {
      const sim = baseMatch(settings2(true)), barracks = [0, 0], army = [0, 0];
      stepN(sim, 10 * 60 * TICK_RATE, ev => {
        if (ev.type === 'placed' && ev.kind === 'barracks') barracks[ev.owner]++;
        if (ev.type === 'produced' && ev.kind !== 'worker') army[ev.owner]++;
      });
      return { sim, barracks, army, hash: sim.hash() };
    };
    const x = play(), y = play();
    check('both base bots build a barracks', x.barracks.every(n => n >= 1), JSON.stringify(x.barracks));
    check('both base bots produce army units', x.army.every(n => n >= 1), JSON.stringify(x.army));
    check('base bots send no refused commands', x.sim.rejected.length === 0, JSON.stringify(x.sim.rejected.slice(0, 3)));
    check('a base match with bots gives the same hash on two runs', x.hash === y.hash, `${x.hash} vs ${y.hash}`);
  }

  // ---- 12: bots only fire at what their team sees ----
  {
    const sim = reinforceMatch(settings2(true));
    let fires = 0, bad = null;
    for (let t = 0; t < 6000 && !sim.ended; t++) for (const ev of sim.step()) {
      if (ev.type !== 'fire') continue;
      const e = sim.byId.get(ev.id);
      if (!e || !sim.players[e.owner].bot) continue;
      fires++;
      const team = sim.teamOf(e), tgt = sim.byId.get(ev.target);
      const ok = sim.vision.visible(team, ev.tx, ev.tz) && (!tgt || sim.vision.seen(team, tgt));
      if (!ok && !bad) bad = `tick ${ev.tick}: unit ${ev.id} (team ${team}) fired at ${ev.target} not seen`;
    }
    check('a bot only targets what its team sees', fires > 20 && !bad, bad ?? `${fires} shots checked`);
  }
}

function content_depot(sim) { return sim.content.kind.depot; }
