// The rts module's mouse and keys: selection (click, box, double click, control groups) and orders (right click, A / S / H / P). It reads actions the module declared
// (names in ACTIONS; the game binds keys, presets.bindings.rts has a set) in the frame hook, because this is UI, not gameplay timing.
import { fx, toFloat } from '@threedog/rts/fixed';
import { screenToGround } from '../../core/scene/screenToGround.js';

/** Action name -> text key. A preset (presets.bindings.rts) binds them to keys */
export const ACTIONS = {
  'rts.select': 'rts.action.select', 'rts.order': 'rts.action.order', 'rts.attackMove': 'rts.action.attackMove', 'rts.stop': 'rts.action.stop',
  'rts.hold': 'rts.action.hold', 'rts.patrol': 'rts.action.patrol', 'rts.queue': 'rts.action.queue', 'rts.groupSet': 'rts.action.groupSet',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`rts.group${i + 1}`, 'rts.action.group'])),
};

const CLICK_PX = 20, DRAG_PX = 5, DOUBLE_S = 0.35, GROUP_TWICE_S = 0.4, MAX_IDS = 500;

export class Controls {
  /**
   * @param {any} e engine
   * @param {any} rts the module's public object (select, issue, selection)
   * @param {any} ctx module ctx
   * @param {{ pair: import('./views.js').ViewPair, picker: import('./pick.js').Picker, visible: () => Uint8Array, alpha: () => number }} o
   */
  constructor(e, rts, ctx, o) {
    this.e = e; this.rts = rts; this.sim = rts.sim; this.o = o;
    this.mode = null;        // 'amove' | 'patrol' while waiting for the target click
    this.drag = null;        // { x, y, px, py, box } while the left button is held
    this.last = { t: -1, kind: -1 };
    this.groups = Array.from({ length: 9 }, () => []);
    this.recall = { n: 0, t: -1 };
    const box = this.box = document.createElement('div');
    box.className = 'threedog-rts-box';
    box.style.cssText = 'position:absolute;display:none;pointer-events:none;box-sizing:border-box';
    e.uiRoot.appendChild(box);
    ctx.track({ remove: () => box.remove() });
    for (const [name, label] of Object.entries(ACTIONS)) ctx.input.define(name, { label, optional: true });
  }

  get player() { return this.rts.driver.player; }
  /** rows of the current view the local player owns */
  _own = i => this.o.pair.cur.owner[i] === this.player && this.o.pair.cur.owner[i] >= 0;

  frame() {
    const { e } = this, inp = e.input, p = inp.pointer, o = this.o;
    const now = e.time.now('real'), shift = inp.down('rts.queue');
    // hotkeys
    if (inp.pressed('rts.stop')) this.order('stop');
    if (inp.pressed('rts.hold')) this.order('hold');
    if (inp.pressed('rts.attackMove')) this.mode = 'amove';
    if (inp.pressed('rts.patrol')) this.mode = 'patrol';
    for (let n = 1; n <= 9; n++) if (inp.pressed(`rts.group${n}`)) this.group(n, inp.down('rts.groupSet'), now);
    // the pointer: units are projected once, and only when a click needs them
    if (inp.pressed('rts.order') || inp.released('rts.select')) o.picker.project(o.alpha());
    if (inp.pressed('rts.order')) { if (this.mode) this.mode = null; else this.rightClick(p, shift); }
    if (inp.pressed('rts.select')) {
      if (this.mode) { if (this.pointTo(this.mode, p, shift)) this.mode = null; } else this.drag = { x: p.ndcX, y: p.ndcY, px: p.x, py: p.y, box: false };
    }
    const d = this.drag;
    if (d && inp.down('rts.select')) {
      if (!d.box && Math.hypot(p.x - d.px, p.y - d.py) > DRAG_PX) d.box = true;
      if (d.box) {
        const s = this.box.style;
        s.display = 'block'; s.left = `${Math.min(p.x, d.px)}px`; s.top = `${Math.min(p.y, d.py)}px`; s.width = `${Math.abs(p.x - d.px)}px`; s.height = `${Math.abs(p.y - d.py)}px`;
      }
    }
    if (d && inp.released('rts.select')) {
      this.drag = null; this.box.style.display = 'none';
      if (d.box) this.boxSelect(d, p, shift); else this.click(p, shift, now);
    }
  }

  ids(rows) { return rows.map(i => this.o.pair.cur.id[i]); }

  click(p, shift, now) {
    const { pair, picker } = this.o, cur = pair.cur;
    const i = picker.nearest(p.ndcX, p.ndcY, CLICK_PX, this._own);
    if (i < 0) { if (!shift) this.rts.select([]); return; }
    const kind = cur.kind[i], double = this.last.kind === kind && now - this.last.t <= DOUBLE_S;
    this.last = { t: now, kind };
    if (double) {
      const rows = picker.inside(-1, -1, 1, 1, j => this._own(j) && cur.kind[j] === kind);
      this.rts.select(shift ? [...this.rts.selection, ...this.ids(rows)] : this.ids(rows));
      return;
    }
    const id = cur.id[i], sel = this.rts.selection;
    if (!shift) this.rts.select([id]);
    else this.rts.select(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  }

  boxSelect(d, p, shift) {
    const rows = this.o.picker.inside(d.x, d.y, p.ndcX, p.ndcY, this._own), ids = this.ids(rows);
    this.rts.select(shift ? [...this.rts.selection, ...ids] : ids);
  }

  /** Remember (set) or bring back (recall) a control group; the same group twice in a row sends the camera to it */
  group(n, set, now) {
    if (set) { this.groups[n - 1] = this.rts.selection.slice(); return; }
    const ids = this.groups[n - 1].filter(id => this.sim.get(id));
    this.groups[n - 1] = ids;
    if (!ids.length) return;
    this.rts.select(ids);
    if (this.recall.n === n && now - this.recall.t <= GROUP_TWICE_S) {
      let x = 0, z = 0;
      for (const id of ids) { const u = this.sim.get(id); x += u.x; z += u.z; }
      this.e.cameraRig?.moveTo?.({ x: toFloat(x / ids.length), z: toFloat(z / ids.length) });
    }
    this.recall = { n, t: now };
  }

  /** Orders with no point: stop, hold */
  order(t) { if (this.rts.selection.length) this.send({ t }); }

  /** amove / patrol at the ground under the pointer; false when the pointer is not over the ground */
  pointTo(t, p, shift) {
    const g = screenToGround(this.e, p.ndcX, p.ndcY);
    if (!g) return false;
    if (this.rts.selection.length) this.send({ t, x: fx(g.x), z: fx(g.z) }, shift);
    return true;
  }

  rightClick(p, shift) {
    if (!this.rts.selection.length) return;
    const { pair, picker } = this.o, cur = pair.cur, vis = this.o.visible(), me = this.mine();
    const i = picker.nearest(p.ndcX, p.ndcY, CLICK_PX, j => vis[j] && cur.owner[j] >= 0 && this.sim.players[cur.owner[j]].team !== me);
    if (i >= 0) { this.send({ t: 'attack', target: cur.id[i] }, shift); return; }
    this.pointTo('move', p, shift);
  }

  /** The local player's team (-1 for an observer) */
  mine() { return this.sim.players[this.player]?.team ?? -1; }

  /** Send a command for the selection, at most MAX_IDS units per command */
  send(cmd, queue = false) {
    const ids = this.rts.selection;
    for (let k = 0; k < ids.length; k += MAX_IDS) this.rts.issue({ ...cmd, ids: ids.slice(k, k + MAX_IDS), ...(queue ? { queue: 1 } : {}) });
  }
}
