// State hashing: a running FNV-1a over 32-bit integers. Two machines in sync compute the same hash every tick; the first tick they differ is
// where a desync started. Only integers go in (fixed values, ids, counters); a string is hashed by its char codes.

const OFFSET = 0x811c9dc5, PRIME = 0x01000193;

export class Hasher {
  constructor() { this.h = OFFSET; }
  /** Mix one integer (anything outside int32 is cut to int32 first) */
  int(v) {
    v |= 0;
    let h = this.h;
    h = Math.imul(h ^ (v & 0xff), PRIME);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), PRIME);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), PRIME);
    h = Math.imul(h ^ (v >>> 24), PRIME);
    this.h = h;
    return this;
  }
  /** Mix a string */
  str(s) { for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i)); return this.int(s.length); }
  /** The hash as an unsigned 32-bit integer */
  get value() { return this.h >>> 0; }
}

/** One string's hash, e.g. to turn a kind name into a stable number */
export const hashString = s => new Hasher().str(s).value;

/** A hash as 8 hex digits, for logs and describe() */
export const hex = h => (h >>> 0).toString(16).padStart(8, '0');
