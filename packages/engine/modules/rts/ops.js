// Ops for tools and tests: `threedog op rts.order t=move x=10 z=4` drives a match like a player would.
import { fx } from '@threedog/rts/fixed';

/**
 * @param {any} ctx module ctx
 * @param {any} api the module's public object
 */
export function defineOps(ctx, api) {
  ctx.ops.define('rts.select', {
    desc: 'Select the local player\'s own units by entity id (others are ignored)',
    args: { ids: 'any' },
    can: (e, { ids }) => (Array.isArray(ids) ? true : 'idsNotArray'),
    run: (e, { ids }) => api.select(ids).length,
    reasons: { idsNotArray: 'ids must be an array of entity ids' },
  });
  ctx.ops.define('rts.order', {
    desc: 'Order units: t is move | amove | patrol (with x, z in meters), attack (with target), stop | hold; ids default to the selection; queue 1 appends',
    args: { t: 'string', ids: 'any?', x: 'number?', z: 'number?', target: 'int?', queue: 'int?' },
    can: (e, { ids }) => (ids === undefined || Array.isArray(ids) ? true : 'idsNotArray'),
    run(e, { t, ids, x, z, target, queue }) {
      const cmd = { t, ids: ids ?? [...api.selection] };
      if (x !== undefined) cmd.x = fx(x);
      if (z !== undefined) cmd.z = fx(z);
      if (target !== undefined) cmd.target = target;
      if (queue !== undefined) cmd.queue = queue;
      const why = api.issue(cmd);
      return why ? { ok: false, code: 'refused', facts: { why } } : cmd.ids.length;
    },
    reasons: { idsNotArray: 'ids must be an array of entity ids', refused: 'the match refused the command; facts.why says why' },
  });
}
