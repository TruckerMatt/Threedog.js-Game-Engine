// __NAME__'s battlefield as sim data. Heights block sight (take the hills!); blocked cells are impassable for ground units.
// This map is computed from formulas with deterministic math (+ - * / and Math.sqrt only). A map made in an editor or sampled from terrain is
// baked once to JSON (map.toJSON()) and loaded with mapFromJSON(): never re-sample float terrain on each player's machine.
import { createMap } from '@threedog/rts';

const hill = (x, z, cx, cz, h, r) => Math.max(0, h - Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz)) * (h / r));

export const map = createMap({
  width: 600, depth: 400, cell: 2,
  height: (x, z) => hill(x, z, -70, 90, 14, 45) + hill(x, z, 70, -90, 14, 45) + hill(x, z, 0, 0, 6, 30),
  // a river down the middle with fords in the north and south
  blocked: (x, z) => Math.abs(x) < 4 && Math.abs(Math.abs(z) - 120) > 15 && Math.abs(z) > 35,
});

/** Deploy zones (one per team) and capture points, in meters */
export const zones = [{ team: 0, x: -260, z: 0, radius: 40 }, { team: 1, x: 260, z: 0, radius: 40 }];
export const points = [
  { id: 'north-ford', x: 0, z: 120 }, { id: 'south-ford', x: 0, z: -120 },
  { id: 'west-hill', x: -70, z: 90, value: 2 }, { id: 'east-hill', x: 70, z: -90, value: 2 },
];
/** Base-building starts (mode 'base'), one per player in order */
export const bases = [{ x: -240, z: 0 }, { x: 240, z: 0 }, { x: -240, z: 150 }, { x: 240, z: -150 }];
