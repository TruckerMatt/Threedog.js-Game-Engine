// @ts-check
// __NAME__'s base-building HUD (mode 'base'): resources and supply, a build menu with a placement ghost (green: can build, red: says why
// not), and production buttons for the selected buildings. Right click with workers on a crystal field gathers, with a building sets its
// rally point (the engine rts module does both). It only reads the sim and sends commands through engine.rts.issue, like any UI should.
import { THREE } from 'threedog';
import { fx } from '@threedog/rts';

const css = `
.bhud { position: fixed; top: 12px; right: 12px; width: 240px; font: 13px/1.4 system-ui, sans-serif; color: #e8e8e8; background: rgba(20, 22, 26, 0.82);
  border-radius: 8px; padding: 10px 12px; user-select: none; }
.bhud h3 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9aa3ad; }
.bhud button { font: inherit; margin: 2px 4px 2px 0; padding: 3px 8px; border: 1px solid #555; border-radius: 4px; background: #2c3036; color: inherit; cursor: pointer; }
.bhud button:disabled { opacity: 0.4; cursor: default; }
.bhud .why { color: #f0a080; min-height: 1.4em; }
`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** @param {any} driver @returns {import('threedog').ModuleDef} */
export function createBaseHud(driver) {
  return {
    name: 'hud-base', type: 'ui', requires: ['rts'],
    /** @param {any} engine @param {any} ctx */
    install(engine, ctx) {
      const sim = driver.sim, me = driver.player, F = 65536;
      const style = el('style', '', css), root = el('div', 'bhud');
      document.head.append(style); document.body.append(root);
      const top = el('div'), buildBox = el('div'), prodTitle = el('h3', '', 'Train'), prodBox = el('div'), why = el('div', 'why');
      root.append(top, el('h3', '', 'Build'), buildBox, prodTitle, prodBox, why);
      const buildable = sim.content.kinds.filter(k => k.structure && k.build && !k.tags.includes('resource'));
      for (const k of buildable) {
        const b = el('button', '', `${k.name} ${k.cost}`);
        b.dataset.kind = k.name;
        b.onclick = () => startPlacing(k);
        buildBox.append(b);
      }

      // placement: a ghost box that follows the pointer on the ground, snapped to the map grid
      let placing = null;
      const ghostMat = new THREE.MeshBasicMaterial({ color: 0x40d060, transparent: true, opacity: 0.35, depthWrite: false });
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), ghostMat);
      ghost.visible = false; engine.scene.add(ghost);
      const startPlacing = k => {
        stopPlacing();
        const [w, d] = k.footprint ?? [4, 4];
        ghost.scale.set(w, 3, d); ghost.visible = true;
        placing = { k, hold: engine.rts.takePointer(`place ${k.name}`), at: null };
      };
      const stopPlacing = () => { if (placing) { placing.hold.remove(); placing = null; } ghost.visible = false; };
      const cell = sim.map.cell / F;
      ctx.track(engine.onFrame(() => {
        if (!placing) return;
        const p = engine.input.pointer, g = engine.cameraRig?.screenToGround?.(p.ndcX, p.ndcY);
        if (engine.input.pressed('rts.order')) { stopPlacing(); return; }   // right click cancels
        if (!g) return;
        const x = Math.round(g.x / cell) * cell, z = Math.round(g.z / cell) * cell;
        const reason = sim.base.canPlace(me, placing.k.name, fx(x), fx(z));
        ghost.position.set(x, sim.map.heightAt(fx(x), fx(z)) / F, z);
        ghostMat.color.set(reason ? 0xe05040 : 0x40d060);
        why.textContent = reason;
        if (engine.input.pressed('rts.select') && !reason) {
          engine.rts.issue({ t: 'build', kind: placing.k.name, x: fx(x), z: fx(z) });
          if (!engine.input.down('rts.queue')) stopPlacing();   // shift keeps placing more of the same
        }
      }));
      ctx.track({ remove() { stopPlacing(); engine.scene.remove(ghost); ghost.geometry.dispose(); ghostMat.dispose(); style.remove(); root.remove(); } });

      let ended = null;
      const refresh = () => {
        const P = sim.players[me], sup = sim.base.supply(me);
        top.textContent = `Crystal ${P.res} · Supply ${sup.used}/${sup.cap}`;
        for (const b of buildBox.children) {
          const k = sim.content.kind[/** @type {HTMLElement} */ (b).dataset.kind];
          /** @type {HTMLButtonElement} */ (b).disabled = k.cost > P.res || sim.base.missing(me, k).length > 0;
        }
        // production: the selected, finished buildings that train something
        const makers = engine.rts.selection.map(id => sim.get(id)).filter(e => e && sim.kindOf(e).produces.length && e.phase === 0);
        prodTitle.style.display = makers.length ? '' : 'none';
        const kinds = [...new Set(makers.flatMap(e => sim.kindOf(e).produces))];
        prodBox.replaceChildren(...kinds.map(n => {
          const k = sim.content.kind[n], queued = makers.reduce((s, e) => s + e.queue.filter(q => q === k.index).length, 0);
          const b = el('button', '', `${n} ${k.cost}${queued ? ` (${queued})` : ''}`);
          b.disabled = k.cost > P.res || sim.base.missing(me, k).length > 0;
          b.onclick = () => {   // the least busy building that makes it
            const by = makers.filter(e => sim.kindOf(e).produces.includes(n)).sort((a, c) => a.queue.length - c.queue.length)[0];
            why.textContent = engine.rts.issue({ t: 'produce', id: by.id, kind: n });
          };
          return b;
        }));
        if (sim.ended && !ended) {
          ended = el('div', '', sim.winner === sim.players[me].team ? 'Victory' : sim.winner === -1 ? 'Draw' : 'Defeat');
          ended.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:700;background:rgba(0,0,0,.45)';
          document.body.append(ended); ctx.track({ remove() { ended.remove(); } });
        }
      };
      refresh();
      let acc = 0;
      ctx.track(engine.onFrame(dt => { if ((acc += dt) >= 0.25) { acc = 0; refresh(); } }));
    },
  };
}
