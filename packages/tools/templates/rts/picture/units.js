// @ts-check
// How __NAME__'s units look, and the shots and explosions. Plain three.js: simple shapes for now, swap in models (assets.js) when you have them.
// A unit's forward is +x (facing 0 looks along +x): bake that into each geometry. White materials take the team tint (TEAM_COLORS) per instance.
import { THREE } from 'threedog';

/** One color per team, tinted onto every unit of that team */
export const TEAM_COLORS = [0x4a7be0, 0xe0574a];

/** look per unit kind for rts({ look }) */
export function unitLooks() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  return {
    rifleman: { geometry: new THREE.CapsuleGeometry(0.35, 0.9, 3, 8).translate(0, 0.8, 0), material: mat },
    scout: { geometry: box(3.2, 1.2, 1.8), material: mat },
    tank: { geometry: (() => { const g = box(5, 1.6, 3); return g; })(), material: mat },
    artillery: { geometry: box(4, 1.4, 2.4), material: mat },
    projectile: { geometry: new THREE.SphereGeometry(0.35, 6, 4), material: new THREE.MeshBasicMaterial({ color: 0xffe9a0 }) },
  };
}

/** Tracers on fire, a flash on death, rings for capture points and deploy zones: a module so it cleans up with engine.unuse
 * @returns {import('threedog').ModuleDef} */
export function createEffects() {
  return {
    name: 'effects', type: 'picture', requires: ['rts'],
    /** @param {any} engine @param {any} ctx */
    install(engine, ctx) {
      const MAX = 256, pos = new Float32Array(MAX * 6), life = new Float32Array(MAX);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.8 }));
      lines.frustumCulled = false;
      engine.scene.add(lines);
      const flashes = [];
      let next = 0;
      // capture points and deploy zones: rings on the ground, a point tinted by the team that holds it
      const sim = engine.rts.sim, F = 65536, rings = [];
      const ring = (x, z, r, color, opacity) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.6, r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
        m.position.set(x, sim.map.heightAt(x * F, z * F) / F + 0.4, z); engine.scene.add(m); rings.push(m); return m;
      };
      for (const zn of sim.reinforce?.zones ?? []) ring(zn.x / F, zn.z / F, zn.radius / F, TEAM_COLORS[zn.team] ?? 0x999999, 0.35);
      const pointRings = (sim.capture?.points ?? []).map(p => ({ p, m: ring(p.x / F, p.z / F, p.radius / F, 0xcccccc, 0.8) }));
      const neutral = new THREE.Color(0xcccccc);
      ctx.track(engine.events.on('rts:fire', f => {
        const i = next++ % MAX;
        pos.set([f.x, 1.2, f.z, f.tx, 1, f.tz], i * 6); life[i] = 0.08;
      }));
      ctx.track(engine.events.on('rts:death', d => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true }));
        m.position.set(d.x, 1, d.z); engine.scene.add(m); flashes.push({ m, t: 0 });
      }));
      ctx.track(engine.onFrame(dt => {
        for (const { p, m } of pointRings) m.material.color.copy(p.holder < 0 ? neutral : new THREE.Color(TEAM_COLORS[p.holder] ?? 0xcccccc)).lerp(neutral, 1 - p.amount / 100);
        for (let i = 0; i < MAX; i++) if (life[i] > 0 && (life[i] -= dt) <= 0) pos.fill(0, i * 6, i * 6 + 6);
        geo.attributes.position.needsUpdate = true;
        for (const f of flashes) { f.t += dt; f.m.scale.setScalar(1 + f.t * 8); f.m.material.opacity = Math.max(0, 1 - f.t * 2.5); }
        for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].t > 0.4) { engine.scene.remove(flashes[i].m); flashes[i].m.geometry.dispose(); flashes[i].m.material.dispose(); flashes.splice(i, 1); }
      }));
      ctx.track({ remove() {
        engine.scene.remove(lines); geo.dispose(); lines.material.dispose();
        for (const f of flashes) engine.scene.remove(f.m);
        for (const m of rings) { engine.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      } });
    },
  };
}
