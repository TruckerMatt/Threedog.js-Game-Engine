// The simulation's random numbers: integers only, one seeded stream per sim, saved in snapshots. Every machine draws the same values in the
// same order, so a random choice in the sim stays in sync. Drawing code that only wants jitter uses its own randomness, never this one.
//   const r = sim.rng;  r.int(6) → 0..5   r.range(lo, hi) → lo..hi-1   r.chance(fx(0.25))   r.pick(list)

export class Rng {
  /** @param {number} seed any integer */
  constructor(seed = 1) { this.state = seed >>> 0 || 1; }

  /** Next raw 32-bit unsigned integer (mulberry32: Math.imul and shifts only, deterministic everywhere) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** An integer in 0 .. n-1 (n >= 1) */
  int(n) {
    if (!(n >= 1)) throw new RangeError(`rng.int(${n}): n must be >= 1`);
    return this.next() % n;
  }

  /** An integer in lo .. hi-1 */
  range(lo, hi) { return lo + this.int(hi - lo); }

  /** true with probability p, p a fixed value 0..65536 (fx(0.25) = 25%) */
  chance(p) { return (this.next() & 0xffff) < p; }

  /** One item of a non-empty array */
  pick(list) { return list[this.int(list.length)]; }
}
