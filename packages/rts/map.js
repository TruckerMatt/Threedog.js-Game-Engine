// The sim's map: a grid of cells, each with a ground height (fixed) and a blocked flag. It is data, identical on every machine: a map that
// was sampled from float terrain must be baked (quantized) once and shipped, never re-sampled per client, or one rounding can desync a match.
//
//   const map = createMap({ width: 512, depth: 512, cell: 2,
//     height: (x, z) => 0,                 // meters at a cell center; quantized to 1/16 m here
//     blocked: (x, z) => false });         // true = ground units cannot enter (cliffs, water, buildings placed in the editor)
//   map.hash                               // part of the match settings; every player must have the same
//
// Coordinates: world x / z in meters, centered on 0 by default (originX = -width / 2). Cell (cx, cz) covers [originX + cx * cell, + cell).
import { fx, ONE, floorInt } from './fixed.js';
import { Hasher } from './hash.js';

const QUANT = 16;   // heights are rounded to 1/16 m before they become fixed

/**
 * @param {{ width: number, depth: number, cell?: number, originX?: number, originZ?: number,
 *   height?: (x: number, z: number) => number, blocked?: (x: number, z: number) => boolean,
 *   heights?: ArrayLike<number>, blocks?: ArrayLike<number> }} o heights / blocks: baked arrays (cols * rows, row-major), instead of the functions
 */
export function createMap(o) {
  const cell = o.cell ?? 2;
  if (!(o.width > 0 && o.depth > 0)) throw new Error('createMap: width and depth (meters) are required, e.g. createMap({ width: 512, depth: 512 })');
  if (!(cell >= 0.5) || !Number.isInteger(cell * 2)) throw new Error(`createMap: cell must be a multiple of 0.5 m >= 0.5, got ${cell}`);
  const cols = Math.ceil(o.width / cell), rows = Math.ceil(o.depth / cell);
  if (cols * rows > 4_000_000) throw new Error(`createMap: ${cols} x ${rows} cells is too many; use a larger cell`);
  const originX = o.originX ?? -o.width / 2, originZ = o.originZ ?? -o.depth / 2;
  const height = new Int32Array(cols * rows), block = new Uint8Array(cols * rows);
  for (let cz = 0; cz < rows; cz++) for (let cx = 0; cx < cols; cx++) {
    const i = cz * cols + cx, x = originX + (cx + 0.5) * cell, z = originZ + (cz + 0.5) * cell;
    const h = o.heights ? o.heights[i] : o.height ? o.height(x, z) : 0;
    height[i] = fx(Math.round(h * QUANT) / QUANT);
    block[i] = (o.blocks ? o.blocks[i] : o.blocked ? o.blocked(x, z) : 0) ? 1 : 0;
  }
  return finish({ cell: fx(cell), cellM: cell, cols, rows, originX: fx(originX), originZ: fx(originZ), height, block });
}

/** Rebuild a map from its plain form (map.toJSON()), e.g. from a baked file or a replay */
export function mapFromJSON(j) {
  return finish({ cell: j.cell, cellM: j.cell / ONE, cols: j.cols, rows: j.rows, originX: j.originX, originZ: j.originZ,
    height: Int32Array.from(j.height), block: Uint8Array.from(j.block) });
}

function finish(m) {
  const h = new Hasher().int(m.cell).int(m.cols).int(m.rows).int(m.originX).int(m.originZ);
  for (let i = 0; i < m.height.length; i++) h.int(m.height[i]).int(m.block[i]);
  m.hash = h.value;
  m.width = m.cols * m.cell; m.depth = m.rows * m.cell;
  m.minX = m.originX; m.minZ = m.originZ; m.maxX = m.originX + m.width; m.maxZ = m.originZ + m.depth;
  /** Cell column of a fixed x (clamped to the map) */
  m.cellX = x => Math.min(m.cols - 1, Math.max(0, floorInt(divCell(x - m.originX, m.cell))));
  /** Cell row of a fixed z (clamped) */
  m.cellZ = z => Math.min(m.rows - 1, Math.max(0, floorInt(divCell(z - m.originZ, m.cell))));
  /** Cell index of a fixed position */
  m.cellAt = (x, z) => m.cellZ(z) * m.cols + m.cellX(x);
  /** Fixed world x of a cell column's center */
  m.centerX = cx => m.originX + cx * m.cell + (m.cell >> 1);
  m.centerZ = cz => m.originZ + cz * m.cell + (m.cell >> 1);
  /** Ground height (fixed) under a fixed position: the cell's height (cells are small; drawing code can smooth) */
  m.heightAt = (x, z) => m.height[m.cellAt(x, z)];
  /** true when the fixed position is on the map */
  m.inside = (x, z) => x >= m.minX && z >= m.minZ && x < m.maxX && z < m.maxZ;
  m.isBlocked = (cx, cz) => cx < 0 || cz < 0 || cx >= m.cols || cz >= m.rows || m.block[cz * m.cols + cx] === 1;
  m.toJSON = () => ({ cell: m.cell, cols: m.cols, rows: m.rows, originX: m.originX, originZ: m.originZ, height: Array.from(m.height), block: Array.from(m.block) });
  return m;
}

// x / cell for two fixed values, result fixed (Math.floor of an exact double quotient times ONE)
const divCell = (a, cell) => Math.floor((a * ONE) / cell);
