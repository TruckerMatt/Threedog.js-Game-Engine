// @ts-check
// skirmish's HUD: budget, call-in buttons, arriving drops, capture points, score, the end of the match, and (online) the lobby and net status.
// Plain DOM; restyle or replace it. It only reads the sim and sends commands through engine.rts.issue, like any UI should.
const css = `
.hud { position: fixed; top: 12px; right: 12px; width: 230px; font: 13px/1.4 system-ui, sans-serif; color: #e8e8e8; background: rgba(20, 22, 26, 0.82);
  border-radius: 8px; padding: 10px 12px; user-select: none; }
.hud h3 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9aa3ad; }
.hud button { font: inherit; margin: 2px 4px 2px 0; padding: 3px 8px; border: 1px solid #555; border-radius: 4px; background: #2c3036; color: inherit; cursor: pointer; }
.hud button:disabled { opacity: 0.4; cursor: default; }
.hud .row { display: flex; justify-content: space-between; }
.hud .end { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 42px; font-weight: 700; background: rgba(0, 0, 0, 0.45); }
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** @param {any} driver @returns {import('threedog').ModuleDef} */
export function createHud(driver) {
  return {
    name: 'hud-rts', type: 'ui', requires: ['rts'],
    /** @param {any} engine @param {any} ctx */
    install(engine, ctx) {
      const sim = driver.sim, me = driver.player, team = me >= 0 ? sim.players[me].team : -1;
      const style = el('style', '', css), root = el('div', 'hud');
      document.head.append(style); document.body.append(root);
      ctx.track({ remove() { style.remove(); root.remove(); } });
      const cart = [];
      const kinds = sim.content.kinds.filter(k => !k.structure);
      const budget = el('div', 'row'), buttons = el('div'), cartLine = el('div'), drops = el('div'), points = el('div'), status = el('div');
      root.append(budget, el('h3', '', 'Call in'), buttons, cartLine, el('h3', '', 'Objectives'), points, drops, status);
      for (const k of kinds) {
        const b = el('button', '', `${k.name} ${k.cost}`);
        b.onclick = () => { cart.push(k.name); refresh(); };
        b.dataset.kind = k.name;
        buttons.append(b);
      }
      const send = el('button', '', 'Deploy'), clear = el('button', '', 'Clear');
      send.onclick = () => {
        const zone = sim.reinforce?.zonesOf(team)[0];
        if (!zone || !cart.length) return;
        const why = engine.rts.issue({ t: 'reinforce', kinds: cart.slice(0, 12), x: zone.x, z: zone.z });
        status.textContent = why;
        if (!why) cart.length = 0;
        refresh();
      };
      clear.onclick = () => { cart.length = 0; refresh(); };
      let ended = null;
      const refresh = () => {
        const P = me >= 0 ? sim.players[me] : null, cost = cart.reduce((s, n) => s + sim.content.kind[n].cost, 0);
        budget.textContent = P ? `Points ${P.res}` : 'Observer';
        cartLine.replaceChildren(document.createTextNode(cart.length ? `${cart.length} unit(s), ${cost} pts ` : 'Pick units, then Deploy '), send, clear);
        send.disabled = !P || !cart.length || cost > P.res;
        for (const b of buttons.children) /** @type {HTMLButtonElement} */ (b).disabled = !P || sim.content.kind[/** @type {HTMLElement} */ (b).dataset.kind].cost > P.res - cost;
        const score = sim.teamScore ?? {};
        points.replaceChildren(...(sim.capture?.points ?? []).map(p => el('div', 'row', `${p.id}`)).map((row, i) => {
          const p = sim.capture.points[i];
          row.append(el('span', '', p.holder < 0 ? 'neutral' : `${p.holder === team ? 'ours' : 'theirs'} ${p.amount}%${p.contested ? ' ⚔' : ''}`));
          return row;
        }), el('div', 'row', `Score: us ${score[team] ?? 0} · them ${Object.entries(score).filter(([t]) => Number(t) !== team).reduce((s, [, v]) => s + v, 0)}`));
        drops.textContent = (sim.reinforce?.pending ?? []).filter(d => d.p === me).map(d => `${d.kinds.length} arriving in ${Math.ceil((d.at - sim.tick) / sim.tickRate)} s`).join(' · ');
        const net = driver.describe();
        if (net.driver === 'lockstep') status.textContent = net.status === 'waiting' ? 'waiting for the network…' : driver.desyncs.length ? `DESYNC at turn ${driver.desyncs[0].turn}` : '';
        if (sim.ended && !ended) {
          ended = el('div', 'end', sim.winner === team ? 'Victory' : sim.winner === -1 ? 'Draw' : 'Defeat');
          document.body.append(ended);
          ctx.track({ remove() { ended.remove(); } });
        }
      };
      refresh();
      let acc = 0;
      ctx.track(engine.onFrame(dt => { if ((acc += dt) >= 0.25) { acc = 0; refresh(); } }));
    },
  };
}

/** The online lobby: who is in, ready, and (host) start. Returns the element; remove it once the match starts. */
createHud.lobby = (/** @type {any} */ driver) => {
  const style = el('style', '', css), root = el('div', 'hud');
  document.head.append(style); document.body.append(root);
  const list = el('div'), ready = el('button', '', 'Ready'), start = el('button', '', 'Start (host)'), msg = el('div');
  root.append(el('h3', '', 'Lobby'), list, ready, start, msg);
  let isReady = false;
  ready.onclick = () => { isReady = !isReady; driver.ready(isReady); ready.textContent = isReady ? 'Not ready' : 'Ready'; };
  start.onclick = () => driver.start({});
  driver.on('lobby', l => {
    list.replaceChildren(...l.slots.map((s, i) => el('div', 'row', `${s.name} · team ${s.team + 1}${s.ready || i === l.host ? ' ✓' : ''}${i === l.host ? ' (host)' : ''}`)));
    start.style.display = driver.player === l.host ? '' : 'none';
    ready.style.display = driver.player === l.host ? 'none' : '';
  });
  driver.on('error', m => { msg.textContent = m.msg; });
  return { remove() { style.remove(); root.remove(); } };
};
