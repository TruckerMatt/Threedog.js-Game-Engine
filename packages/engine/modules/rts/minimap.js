// The minimap: a canvas in a corner of the UI root, redrawn a few times a second. Heights as grays, the team's units as dots, the fog, and the camera's ground footprint.
// Left click or drag moves the camera there; right click orders the selection to move there. Styling is the CSS class `threedog-rts-minimap` (rules with no specificity, so any game CSS wins).
import { toFloat } from '@threedog/rts/fixed';

const HZ = 4;

export class Minimap {
  /**
   * @param {any} e engine
   * @param {any} ctx module ctx (its signal ends the listeners)
   * @param {any} sim
   * @param {number} team the local team (-1: sees everything)
   * @param {{ size: number, tints: any[], footprint: () => Array<{ x: number, z: number }>, goto: (x: number, z: number) => void, order: (x: number, z: number, queue: boolean) => void }} o
   */
  constructor(e, ctx, sim, team, o) {
    this.e = e; this.sim = sim; this.team = team; this.o = o;
    const m = sim.map, size = o.size;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'threedog-rts-minimap';
    this.canvas.width = this.canvas.height = size;
    this.size = size;
    this.minX = toFloat(m.minX); this.minZ = toFloat(m.minZ);
    this.scale = size / Math.max(toFloat(m.width), toFloat(m.depth));   // pixels per meter; the longer side fills the canvas
    this.ground = this._ground();
    this.fogCanvas = null; this.fogSum = null;
    this.acc = 1;   // draw on the first frame
    const c = this.canvas, sig = { signal: ctx.signal };
    const at = ev => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * size, (ev.clientY - r.top) / r.height * size]; };
    const world = ev => { const [px, py] = at(ev); return [px / this.scale + this.minX, py / this.scale + this.minZ]; };
    let dragging = false;
    c.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const [x, z] = world(ev);
      if (ev.button === 0) { dragging = true; c.setPointerCapture(ev.pointerId); o.goto(x, z); } else if (ev.button === 2) o.order(x, z, ev.shiftKey);
    }, sig);
    c.addEventListener('pointermove', ev => { if (dragging) { const [x, z] = world(ev); o.goto(x, z); } }, sig);
    const end = () => { dragging = false; };
    c.addEventListener('pointerup', end, sig); c.addEventListener('pointercancel', end, sig);
    c.addEventListener('contextmenu', ev => ev.preventDefault(), sig);
    e.uiRoot.appendChild(c);
    ctx.track({ remove: () => c.remove() });
  }

  /** The map's heights as grays, drawn once (the map never changes during a match) */
  _ground() {
    const m = this.sim.map, size = this.size, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d'), img = g.createImageData(size, size);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.height.length; i++) { lo = Math.min(lo, m.height[i]); hi = Math.max(hi, m.height[i]); }
    const w = toFloat(m.width) * this.scale, d = toFloat(m.depth) * this.scale;
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 4;
      if (px >= w || py >= d) { img.data[o + 3] = 0; continue; }
      const cx = Math.min(m.cols - 1, Math.floor(px / w * m.cols)), cz = Math.min(m.rows - 1, Math.floor(py / d * m.rows)), i = cz * m.cols + cx;
      const v = 70 + (hi > lo ? (m.height[i] - lo) / (hi - lo) : 0) * 110, blocked = m.block[i];
      img.data[o] = img.data[o + 1] = img.data[o + 2] = blocked ? v * 0.5 : v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /** One small canvas of the fog grid, scaled up when drawn */
  _fog() {
    const V = this.sim.vision;
    if (!V || this.team < 0) return null;
    const sum = V.teams[this.team].sum;
    if (sum === this.fogSum && this.fogCanvas) return this.fogCanvas;
    const g = V.grid(this.team), cv = this.fogCanvas ??= Object.assign(document.createElement('canvas'), { width: g.cols, height: g.rows });
    const ctx = cv.getContext('2d'), img = ctx.createImageData(g.cols, g.rows);
    for (let i = 0; i < g.cols * g.rows; i++) img.data[i * 4 + 3] = g.visible[i] ? 0 : g.explored[i] ? 110 : 200;
    ctx.putImageData(img, 0, 0);
    this.fogSum = sum;
    return cv;
  }

  /**
   * Redraw when due. pair: the views; visible: rows of pair.cur the team sees
   * @param {number} dt seconds since the last call
   */
  draw(dt, pair, visible) {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    const ctx = this.canvas.getContext('2d'), s = this.scale, size = this.size, cur = pair.cur, m = this.sim.map;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.ground, 0, 0);
    const fog = this._fog();
    if (fog) { ctx.imageSmoothingEnabled = false; ctx.drawImage(fog, 0, 0, toFloat(m.width) * s, toFloat(m.depth) * s); }
    for (let i = 0; i < cur.n; i++) {
      if (!visible[i]) continue;
      const o = cur.owner[i], c = o >= 0 ? this.o.tints[this.sim.players[o].team] : null;
      ctx.fillStyle = c ? `#${c.getHexString()}` : '#808080';
      const r = this.sim.content.kinds[cur.kind[i]].structure ? 3 : 2;
      ctx.fillRect((cur.x[i] - this.minX) * s - r / 2, (cur.z[i] - this.minZ) * s - r / 2, r, r);
    }
    const footprint = this.o.footprint();
    if (footprint.length === 4) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath();
      footprint.forEach((p, k) => { const x = (p.x - this.minX) * s, y = (p.z - this.minZ) * s; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
    }
  }
}
