// Combat: picking targets, weapon cooldowns, instant hits and flying projectiles, armor multipliers and splash. Only what the attacker's
// team sees can be picked (vision system), so fog of war is a rule, not just a picture.
//
// Who looks for targets on their own (every ACQUIRE ticks, staggered by id):
//   no orders or hold     → enemies within weapon range (they turn, they do not chase)
//   attack-move, patrol   → enemies within sight (then the units system chases them into range)
//   move                  → nobody: a plain move ignores enemies (that is what attack-move is for)
// Events for drawing and sound: { type: 'fire', id, target, weapon, x, z, tx, tz }, { type: 'hit', id (target), by, damage, x, z }, death.
import { mul, len, len2, atan2, angleDiff, clamp, div, ONE, ANGLE } from './fixed.js';
import { armorFactor } from './content.js';
import { ENGAGING } from './units.js';

export const ACQUIRE = 4;            // ticks between target searches per unit
const AIM = 2048;                     // a fixed (non-turret) weapon fires within ~11 degrees of facing

export function combatSystem() {
  return {
    name: 'combat',
    init(sim) {
      sim.field('cd', null);       // per-weapon cooldowns (ticks), set on spawn
      sim.field('fired', -1);      // tick of the last shot
      sim.projectiles = [];
      sim.nextShot = 1;
    },
    spawned(sim, e) { e.cd = sim.kindOf(e).weapons.map(() => 0); },
    step(sim) {
      for (const e of sim.entities) {
        if (e.dead) continue;
        const k = sim.kindOf(e);
        if (!k.weapons.length) continue;
        for (let i = 0; i < e.cd.length; i++) if (e.cd[i] > 0) e.cd[i]--;
        const team = sim.teamOf(e), ord = e.orders[0]?.t;
        let t = e.target ? sim.get(e.target) : null;
        if (t && !sim.vision?.seen(team, t)) t = null;     // lost from sight: drop it (the order may pick another)
        if (!t) {
          e.target = 0;
          const auto = ord === undefined || ord === 'hold' ? k.range : ord === 'amove' || ord === 'patrol' ? Math.max(k.sight, k.range) : 0;
          if (auto && (sim.tick + e.id) % ACQUIRE === 0) t = acquire(sim, e, k, team, auto);
          if (t) e.target = t.id;
        }
        if (!t) continue;
        const dx = t.x - e.x, dz = t.z - e.z, kt = sim.kindOf(t), d2 = len2(dx, dz);
        // stationary units (holding, idle, or in range) turn toward their target
        if (e.vx === 0 && e.vz === 0) {
          const want = atan2(dz, dx);
          e.facing = (e.facing + clamp(angleDiff(e.facing, want), -k.turnRate, k.turnRate)) & (ANGLE - 1);
        }
        // idle and holding units let a target go once it walks out of range
        if ((ord === undefined || ord === 'hold') && d2 > (k.range + kt.radius) * (k.range + kt.radius)) { e.target = 0; continue; }
        k.weapons.forEach((w, i) => {
          if (e.cd[i] > 0 || !canHit(w, kt)) return;
          const reach = w.range + kt.radius;
          if (d2 > reach * reach || d2 < w.minRange * w.minRange) return;
          if (!w.turret && Math.abs(angleDiff(e.facing, atan2(dz, dx))) > AIM) return;
          e.cd[i] = w.cooldown; e.fired = sim.tick; e.state = ENGAGING;
          sim.emit({ type: 'fire', id: e.id, target: t.id, weapon: w.name, x: e.x, z: e.z, tx: t.x, tz: t.z });
          if (w.projectileSpeed > 0) sim.projectiles.push({ id: sim.nextShot++, by: e.id, owner: e.owner, w: w.name, x: e.x, z: e.z, tx: t.x, tz: t.z, target: w.arc ? 0 : t.id });
          else hit(sim, e.owner, e.id, w, t.x, t.z, t);
        });
      }
      flyProjectiles(sim);
    },
    hash(sim, h) {
      h.int(sim.nextShot).int(sim.projectiles.length);
      for (const p of sim.projectiles) h.int(p.id).int(p.by).int(p.x).int(p.z).int(p.tx).int(p.tz).int(p.target);
    },
    save: sim => ({ projectiles: sim.projectiles.map(p => ({ ...p })), nextShot: sim.nextShot }),
    load(sim, d) { sim.projectiles = d.projectiles.map(p => ({ ...p })); sim.nextShot = d.nextShot; },
    describe: sim => ({ projectiles: sim.projectiles.length }),
  };
}

const canHit = (w, kt) => w.targets.includes(kt.air ? 'air' : 'ground');

/** Nearest seen enemy within r that some weapon can hit; ties go to the lower id */
function acquire(sim, e, k, team, r) {
  let best = null, bestD = Infinity;
  sim.spatial.nearEnemies(team, e.x, e.z, r, o => {
    if (o.owner < 0) return;
    const ko = sim.kindOf(o);
    if (!k.weapons.some(w => canHit(w, ko))) return;
    if (sim.vision && !sim.vision.seen(team, o)) return;
    const d = len2(o.x - e.x, o.z - e.z);
    if (d < bestD || (d === bestD && o.id < best.id)) { best = o; bestD = d; }
  });
  return best;
}

function flyProjectiles(sim) {
  const keep = [];
  for (const p of sim.projectiles) {
    const w = sim.content.weapons[p.w];
    const t = p.target ? sim.get(p.target) : null;
    if (t) { p.tx = t.x; p.tz = t.z; }                 // homing: follow the target while it lives
    const dx = p.tx - p.x, dz = p.tz - p.z, d = len(dx, dz);
    if (d <= w.projectileSpeed) { hit(sim, p.owner, p.by, w, p.tx, p.tz, t); continue; }
    p.x += mul(div(dx, d), w.projectileSpeed); p.z += mul(div(dz, d), w.projectileSpeed);
    keep.push(p);
  }
  sim.projectiles = keep;
}

/** Apply one shot at (x, z): full damage to `t` (if given and alive), splash to other enemies of `owner` around the point */
function hit(sim, owner, by, w, x, z, t) {
  const team = owner < 0 ? -1 : sim.players[owner].team;
  if (t && !t.dead) damage(sim, t, w, w.damage, by, owner);
  if (w.splash > 0) {
    sim.spatial.nearEnemies(team, x, z, w.splash, o => {
      if (o === t || o.dead || o.owner < 0) return;
      const falloff = ONE - clamp(Math.floor((len(o.x - x, o.z - z) * ONE) / w.splash), 0, ONE);
      if (falloff > 0) damage(sim, o, w, mul(w.damage, falloff), by, owner);
    });
  }
}

function damage(sim, t, w, amount, by, owner) {
  const kt = sim.kindOf(t);
  const dmg = Math.max(1, mul(amount, armorFactor(sim.content, kt.armor, w.damageType)));
  t.hp -= dmg;
  sim.emit({ type: 'hit', id: t.id, by, damage: dmg, x: t.x, z: t.z });
  if (t.hp <= 0) {
    sim.kill(t, by);
    if (owner >= 0 && sim.players[owner]) sim.players[owner].score += kt.cost;
  }
}
