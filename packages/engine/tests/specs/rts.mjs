// RTS module (recipes/67-rts.md): units draw as instances between ticks, the fog hides what the team cannot see, selection and orders work through the input actions
// and through code, sim events come back as rts:* events in meters, ops drive a match, and unuse takes everything away.
const J = JSON.stringify;
export const specs = [
  {
    name: '[guard] rts: instances, selection, orders, input, fog, events, ops, look and unuse',
    url: '/tests/rts/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.rtsCases());
      if (r.error) throw new Error(r.error.replace(/\n/g, ' | '));
      const D = r.draw;
      check('one InstancedMesh per kind in the scene, tinted per row, only the units the team sees', D.isInstanced && D.inScene && D.hasColor && D.units === 4 && D.count === 2 && D.dummies === 1, J(D));
      check('the shot mesh exists too, empty', D.projectile, J(D));
      check('the rows are the visible units by id (grunts a, b; dummy near)', r.rows[0] === 0 && r.rows[1] === 10 && r.rows[2] === -14 && r.hiddenNotAt, J(r.rows));
      const S = r.select;
      check('select keeps own living units only, in order, frozen', S.own.length === 2 && S.enemy === 0 && S.mixed.length === 1 && S.mixed[0] === S.expectA && S.isFrozen, J(S));
      const M = r.move;
      check('issue returns "" for a good order and the reason for a command of a bad shape', M.why === '' && /must be an integer/.test(M.bad), J(M));
      check('an order moves the unit in the sim and its instance matrix changes (x only)', M.simX < M.was - 1 && M.moved && M.now < M.was - 1 && M.yUnchanged, J(M));
      const F = r.fog;
      check('fog: overlay mesh and DataTexture at vision resolution, uniforms published', F.hasMesh && F.name === 'rts:fog' && F.tex && F.u && F.texW === F.gridCols && F.bounds[2] > 100, J(F));
      check('fog: the far enemy is not seen; a seen cell is clear, an unexplored one mostly opaque', !F.farVisible && F.nearVisible && F.alphaOwn === 0 && F.alphaFar > 0.8, J(F));
      const E = r.describe;
      check('describe: rts entry with driver, tick, selection, units and drawn', E.has && E.selection === 1 && E.units === 4 && E.drawn === 3 && E.driver === 'local' && E.tick > 0 && E.hash === 'string' && E.players === 2, J(E));
      const O = r.ops;
      check('ops: rts.select and rts.order (meters, selection by default) move units; bad ids are refused by can; an off-map point is recorded in describe', O.selOk && O.selValue === 1 && O.ordOk && O.ordValue === 1 && !O.bogOk && O.offOk && O.rejected.some(w => /off the map/.test(w)) && O.bMoved, J(O));
      const U = r.unuse;
      check('unuse removes the minimap, the box, every rts mesh, the uniforms and engine.rts', U.domBefore === 2 && U.sceneBefore > 5 && U.domAfter === 0 && U.sceneAfter === 0 && U.api && U.uniform, J(U));
      const I = r.input;
      check('left click picks the nearest own unit; an enemy click selects nothing; shift adds', J(I.one) === J([I.a]) && I.enemy.length === 0 && J(I.both) === J([I.a, I.b]), J(I));
      check('left drag shows the box and selects the own units inside it', I.boxShown === 'block' && I.boxHidden === 'none' && J(I.boxed) === J([I.a, I.b]), J(I));
      check('right click on the ground orders a move for the selection; on a visible enemy an attack', I.z1 > 1 && I.bx < -10.5 && I.attackIssued, J(I));
      check('control group: Ctrl+1 stores, 1 recalls; S stops', J(I.recalled) === J([I.a]) && I.stopped === 0, J(I));
      const V = r.events;
      check('rts:fire and rts:hit come in meters from where the team sees; the fight can kill', V.fire > 0 && V.hit > 0 && Math.abs(V.firstFire.x) < 128 && V.firstFire.weapon === 'rifle' && V.firstHit.damage === 40, J(V));
      check('rts:spawn only for what the team sees: the unit in sight, not the one in the fog', V.spawn === 1 && V.spawnIds[0] === V.near2, J(V));
      check('selected or hurt units get health bars', V.bars >= 1, J(V));
      check('a selected unit\'s two queued moves draw two path segments and two waypoint dots; deselected, none', r.paths.segs === 2 && r.paths.dots === 2 && r.paths.after === 0, J(r.paths));
      const L = r.look;
      check('look: the game geometry, scale and lift are used; teamColors tint; controls / minimap / fog off build none', L.sameGeometry && L.scale === 2 && L.lift > 2.9 && L.color0[0] === 1 && L.color0[2] === 0 && L.noMinimap && L.noBox && L.noOverlay && L.texture, J(L));
      check('unuse leaves the game\'s geometry alone', L.geometryAlive, J(L));
    },
  },
];
