// What the rts module puts on screen from the two views: one InstancedMesh per unit kind, one for shots. Rows hold only the units the local team sees.
// facing is 0..65535 per turn, 0 = +x, 16384 = +z; the model's forward is +x, so a unit's yaw (three's rotation.y, which turns +x toward -z) is minus that angle.
import * as THREE from 'three';
import { neutralMaterial, NEUTRAL } from '../../render/neutral.js';
import { InstancePool, putYaw } from './pool.js';
import { toFloat, ANGLE } from '@threedog/rts/fixed';

const TURN = Math.PI * 2 / ANGLE;
const _at = { x: 0, y: 0, z: 0, facing: 0 };

/** Tint of each team: the game's teamColors, else grays that differ from each other (the engine ships no colors) */
export function teamTints(teamColors, n) {
  const out = [];
  for (let t = 0; t < n; t++) {
    const c = new THREE.Color();
    if (teamColors?.[t] !== undefined) c.set(teamColors[t]); else c.setScalar(Math.max(0.25, 1.1 - 0.3 * t));
    out.push(c);
  }
  return out;
}

export class UnitDraw {
  /**
   * @param {any} e engine
   * @param {any} sim
   * @param {{ look: Record<string, any>, teamColors?: any[] }} o
   */
  constructor(e, sim, o) {
    this.e = e; this.sim = sim; this.look = o.look;
    this.tints = teamTints(o.teamColors, Math.max(1, ...sim.players.map(p => p.team + 1)));
    this.neutral = new THREE.Color(NEUTRAL);
    /** @type {Record<string, THREE.InstancedMesh>} kind name -> its current mesh (replaced when a kind outgrows it) */
    this.meshes = {};
    this.pools = sim.content.kinds.map(k => this._pool(k));
    const shot = o.look.projectile ?? {};
    this.shots = new InstancePool(e, 'rts:projectile', shot.geometry ?? new THREE.SphereGeometry(0.15, 6, 4), shot.material ?? neutralMaterial('rts-projectile'),
      { ownsGeometry: !shot.geometry, ownsMaterial: !shot.material });
    this.shotScale = shot.scale ?? 1; this.shotY = shot.y ?? 1;
    this.sprev = new Map(); this.scur = new Map();   // projectile id -> [x, z] one tick ago / now: shots are drawn between ticks too
    this.drawn = 0;
    this.visible = new Uint8Array(0);
  }

  _pool(k) {
    const l = this.look[k.name] ?? {}, r = toFloat(k.radius);
    // placeholder: a box as long as the unit is wide, a little longer along +x so its facing shows
    const geometry = l.geometry ?? new THREE.BoxGeometry(r * 2.4, r * 1.6, r * 1.8), material = l.material ?? neutralMaterial('rts-unit', { color: 0xffffff });
    const pool = new InstancePool(this.e, `rts:${k.name}`, geometry, material, { tint: true, ownsGeometry: !l.geometry, ownsMaterial: !l.material });
    pool.scale = l.scale ?? 1;
    pool.lift = l.y ?? (l.geometry ? 0 : r * 0.8);
    this.meshes[k.name] = pool.mesh;
    return pool;
  }

  /** Which rows of the current view the local team sees (vision changes only inside sim ticks, so once per tick is enough) */
  refreshVisible(pair, team) {
    const { sim } = this, cur = pair.cur, V = sim.vision;
    if (this.visible.length < cur.n) this.visible = new Uint8Array(Math.max(64, cur.n * 2));
    for (let i = 0; i < cur.n; i++) {
      const en = V ? sim.byId.get(cur.id[i]) : null;
      this.visible[i] = !V || (en && V.seen(team, en)) ? 1 : 0;
    }
  }

  /** Write every visible unit; a of the way from the last tick to this one */
  units(pair, a) {
    const cur = pair.cur, n = cur.n, kinds = this.pools, counts = this._counts ??= new Int32Array(kinds.length);
    counts.fill(0);
    for (let i = 0; i < n; i++) if (this.visible[i]) counts[cur.kind[i]]++;
    kinds.forEach((p, k) => { if (counts[k] > p.capacity) { p.ensure(counts[k]); this.meshes[this.sim.content.kinds[k].name] = p.mesh; } });
    counts.fill(0);
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!this.visible[i]) continue;
      const k = cur.kind[i], p = kinds[k], r = counts[k]++, at = pair.at(i, a, _at), o = cur.owner[i];
      putYaw(p.m, r, at.x, at.y + p.lift, at.z, -at.facing * TURN, p.scale, p.scale, p.scale);
      const col = o >= 0 ? this.tints[this.sim.players[o].team] ?? this.neutral : this.neutral, c = p.c, q = r * 3;
      c[q] = col.r; c[q + 1] = col.g; c[q + 2] = col.b;
      drawn++;
    }
    kinds.forEach((p, k) => p.finish(counts[k]));
    this.drawn = drawn;
  }

  /** Shots in flight that the local team can see, between their last and current tick position */
  projectiles(a, team) {
    const { sim } = this, list = sim.projectiles ?? [], V = sim.vision, pool = this.shots;
    pool.ensure(list.length);
    let r = 0;
    for (const p of list) {
      const x1 = toFloat(p.x), z1 = toFloat(p.z), was = this.sprev.get(p.id);
      if (V && !V.visible(team, p.x, p.z) && sim.players[p.owner]?.team !== team) continue;
      const x = was ? was[0] + (x1 - was[0]) * a : x1, z = was ? was[1] + (z1 - was[1]) * a : z1;
      putYaw(pool.m, r++, x, toFloat(sim.map.heightAt(p.x, p.z)) + this.shotY, z, 0, this.shotScale, this.shotScale, this.shotScale);
    }
    pool.finish(r);
  }

  /** After a tick: what was current becomes the start of the next interpolation */
  rememberShots() {
    [this.sprev, this.scur] = [this.scur, this.sprev];
    this.scur.clear();
    for (const p of this.sim.projectiles ?? []) this.scur.set(p.id, [toFloat(p.x), toFloat(p.z)]);
  }

  dispose() {
    for (const p of this.pools) p.dispose();
    this.shots.dispose();
  }
}
