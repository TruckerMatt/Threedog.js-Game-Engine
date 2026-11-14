// @ts-check
// The ground drawn from the sim map: one mesh whose heights are the sim's (so what you see is what blocks sight), blocked cells darker.
// Replace freely (a textured terrain, a glTF level): keep the heights matching sim/map.js, since the sim decides sight and movement from it.
import { THREE } from 'threedog';

/** @param {any} engine @param {any} map the sim map (fixed-point fields: divide by 65536 for meters) */
export function createGround(engine, map) {
  const F = 65536, step = 2;   // one vertex every 2 cells
  const cols = Math.floor(map.cols / step), rows = Math.floor(map.rows / step);
  const geo = new THREE.PlaneGeometry(map.width / F, map.depth / F, cols, rows);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0x56664a), high = new THREE.Color(0x8a8a6a), water = new THREE.Color(0x2d4a5c), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const cx = Math.min(map.cols - 1, Math.max(0, Math.floor((x * F - map.originX) / map.cell)));
    const cz = Math.min(map.rows - 1, Math.max(0, Math.floor((z * F - map.originZ) / map.cell)));
    const cell = cz * map.cols + cx, h = map.height[cell] / F;   // presentation: reads the sim's own height grid to draw it (hint-off)
    pos.setY(i, h);
    c.copy(map.block[cell] ? water : low.clone().lerp(high, Math.min(1, h / 14)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
}
