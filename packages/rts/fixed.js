// Fixed-point math for the RTS simulation. Every simulation number is an integer: a "fixed" value is a real number times 65536 (Q16.16),
// an angle is a whole turn split into 65536 steps. Why: the sim must give the same bits on every browser and machine, and only integer
// arithmetic plus IEEE + - * / and Math.sqrt are guaranteed identical everywhere. Math.sin, Math.atan2, Math.pow and friends are NOT
// (each engine approximates them its own way), so the trig here is built from + - * / only. Rule R72 bans the others in packages/rts.
//
//   import { fx, mul, div, toFloat, sin, cos, atan2, len, ANGLE } from '@threedog/rts/fixed';
//   const speed = fx(8);                    // 8 m/s as fixed (8 * 65536)
//   const step = mul(speed, fx(0.05));      // 8 m/s over one 1/20 s tick = 0.4 m
//   const a = atan2(dz, dx);                // angle 0..65535 (0 = +x, 16384 = +z)
//   x += mul(cos(a), step);                 // move along the angle
//   mesh.position.x = toFloat(x);           // drawing code converts back to meters
//
// Range: a fixed value fits in a signed 32-bit integer, so -32768 .. 32767.99998 meters with 1/65536 m precision. Results are cut to int32.

export const SHIFT = 16;
/** 1.0 as fixed */
export const ONE = 65536;
/** 0.5 as fixed */
export const HALF = 32768;
/** One full turn in angle units; 0 = +x, ANGLE / 4 = +z, ANGLE / 2 = -x */
export const ANGLE = 65536;

/**
 * A plain number (meters, seconds, a ratio) as fixed. Deterministic for any finite input: scaling by a power of two is exact and Math.round is
 * exact. Use it when content is loaded or a command is built, never on a value that came out of non-deterministic math.
 * @param {number} n
 * @returns {number}
 */
export function fx(n) {
  if (!Number.isFinite(n)) throw new TypeError(`fx(${n}): needs a finite number, e.g. fx(1.5)`);
  return Math.round(n * ONE) | 0;
}

/** A fixed value as a plain number, for drawing, UI and logs only (never feed it back into the sim) */
export const toFloat = f => f / ONE;

/** A whole number as fixed (exact) */
export const fromInt = n => (n << SHIFT) | 0;

/** The integer part of a fixed value, rounded toward minus infinity */
export const floorInt = f => f >> SHIFT;

/**
 * a * b for two fixed values, exact for any int32 inputs (the product is split so no step leaves the 2^53 range where doubles are exact).
 * @param {number} a fixed
 * @param {number} b fixed
 * @returns {number} fixed
 */
export function mul(a, b) {
  const hi = a >> SHIFT, lo = a & 0xffff;   // a = hi * 65536 + lo, lo in 0..65535
  return (hi * b + Math.floor((lo * b) / ONE)) | 0;
}

/**
 * a / b for two fixed values, rounded toward minus infinity. Throws on b = 0 (a sim bug, never a value to carry on with).
 * @param {number} a fixed
 * @param {number} b fixed
 * @returns {number} fixed
 */
export function div(a, b) {
  if (b === 0) throw new RangeError('fixed div by zero');
  return Math.floor((a * ONE) / b) | 0;
}

/** Square root of a fixed value (negative → 0). Math.sqrt is exactly rounded by the spec, so this is deterministic. */
export function sqrt(a) {
  return a <= 0 ? 0 : Math.floor(Math.sqrt(a * ONE)) | 0;
}

/**
 * Length of the vector (dx, dz), both fixed. dx * dx can pass 2^53 for long vectors; the double result is then rounded, but rounded the same way
 * on every machine, so the answer is still deterministic.
 * @returns {number} fixed
 */
export function len(dx, dz) {
  return Math.floor(Math.sqrt(dx * dx + dz * dz)) | 0;
}

/** Squared length as a plain (possibly large) number: compare it with dist2Of(range) to avoid the square root */
export const len2 = (dx, dz) => dx * dx + dz * dz;

/** r * r for a fixed distance r, comparable with len2 */
export const dist2Of = r => r * r;

/** Clamp v into [lo, hi] */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear blend a + (b - a) * t, t fixed in 0..ONE */
export const lerp = (a, b, t) => (a + mul(b - a, t)) | 0;

// ---- trig: a quarter-wave sine table built from + - * / only (a Taylor series in doubles is deterministic: no Math.sin) ----

const TABLE_BITS = 12;                      // 4096 entries per quarter turn
const QUARTER = ANGLE >> 2;                 // 16384 angle units
const TABLE_STEP = QUARTER >> TABLE_BITS;   // 4 angle units per entry
const PI = 3.141592653589793;

function taylorSin(x) {
  // x in [0, pi/2]; 11 terms reach well below 1/65536
  let term = x, sum = x;
  const x2 = x * x;
  for (let n = 1; n < 12; n++) { term = -term * x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}

const SIN = new Int32Array((1 << TABLE_BITS) + 1);
for (let i = 0; i <= 1 << TABLE_BITS; i++) SIN[i] = Math.round(taylorSin((i / (1 << TABLE_BITS)) * (PI / 2)) * ONE);

/** Wrap any integer angle into 0..65535 */
export const wrapAngle = a => a & (ANGLE - 1);

/**
 * sin of an angle (0..65535 for one turn), as fixed in -ONE..ONE.
 * @param {number} a angle units
 * @returns {number} fixed
 */
export function sin(a) {
  a &= ANGLE - 1;
  const quad = a >> 14, r = a & (QUARTER - 1);
  const t = quad & 1 ? QUARTER - r : r;          // mirror in quadrants 1 and 3
  const i = t >> 2, f = t & 3;                   // table index and the remainder (0..3 of TABLE_STEP)
  const v = SIN[i] + (((SIN[Math.min(i + 1, 1 << TABLE_BITS)] - SIN[i]) * f) >> 2);
  return quad & 2 ? -v : v;
}

/** cos of an angle, as fixed */
export const cos = a => sin(a + QUARTER);

/**
 * The angle of the vector (x, z) (any common unit, e.g. two fixed values): 0 = +x, 16384 = +z. (0, 0) gives 0.
 * Built from + - * / only: an octant reduction plus an odd polynomial for atan on [0, 1] (error under 0.0001 rad, below one angle unit).
 * @returns {number} angle 0..65535
 */
export function atan2(z, x) {
  if (x === 0 && z === 0) return 0;
  const ax = x < 0 ? -x : x, az = z < 0 ? -z : z;
  const swap = az > ax;
  const t = swap ? ax / az : az / ax;            // 0..1
  const t2 = t * t;
  // atan(t) on [0, 1]: minimax odd polynomial (Abramowitz & Stegun 4.4.49 style), coefficients as literals
  const r = t * (0.9998660 + t2 * (-0.3302995 + t2 * (0.1801410 + t2 * (-0.0851330 + t2 * 0.0208351))));
  let ang = swap ? PI / 2 - r : r;                 // 0..pi/2
  if (x < 0) ang = PI - ang;
  if (z < 0) ang = 2 * PI - ang;
  return Math.round(ang * (ANGLE / (2 * PI))) & (ANGLE - 1);
}

/** Smallest signed difference b - a between two angles, in -32768..32767 */
export function angleDiff(a, b) {
  return (((b - a) & (ANGLE - 1)) << 16) >> 16;
}

/** An angle as radians, for drawing only */
export const angleToRadians = a => (a & (ANGLE - 1)) * (2 * PI / ANGLE);
