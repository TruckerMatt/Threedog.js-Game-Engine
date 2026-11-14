// [guard] content uses only the inventory's public API (review 0.4 E: a module read and wrote inventory._containers and container _save / _load).
// Why a browser test as well as the static rules R25 / R46: a rule sees the patterns it knows; a replaced provider sees every call. The game's own
// bag (provides: ['inventory']) has the public methods and nothing else, no _containers, no _refresh, no container _load, so any reach into the
// built-in inventory's insides throws or reads undefined, and what content loads comes out wrong.
// The static half (core / render / ui name no module; no module touches another's _fields or files) is packages/tools/tests/module-boundaries.mjs.
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] module boundaries: content works against a replaced inventory provider (public API only)',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, all: { world, content } } = threedogThreads;
        // a game's bag: the public inventory methods content calls, over plain maps; it brings the content sections it reads, as any replacement does
        const bag = name => ({
          name, type: 'rules', provides: ['inventory'],
          content: {
            items: { commit(d, { engine: e }) { for (const [id, x] of Object.entries(d)) e.inventory.define(id, x); } },
            startItems: { commit(d, { engine: e }) { for (const [id, n] of Object.entries(d)) e.inventory.add(id, n); } },
            containers: { commit(d, { engine: e }) { for (const [id, x] of Object.entries(d)) e.inventory.container(id, x); } },
          },
          install(e) {
            const boxes = new Map(), defs = new Map();
            const box = id => boxes.get(id) ?? boxes.set(id, {
              id, items: new Map(),
              add(item, n = 1) { this.items.set(item, (this.items.get(item) ?? 0) + n); return true; },
              count(item) { return this.items.get(item) ?? 0; },
              has(item, n = 1) { return this.count(item) >= n; },
              list() { return [...this.items].map(([item, count]) => ({ id: item, count })); },
            }).get(id);
            return {
              define(id, d) { defs.set(id, d); },
              item: id => defs.get(id) ?? { name: id },
              container(id, opts) { const c = box(id); if (opts?.items && !c.items.size) for (const [k, n] of Object.entries(opts.items)) c.add(k, n); return c; },
              of: actor => box(actor),
              add: (id, n) => box('player').add(id, n),
              count: id => box('player').count(id),
              has: (id, n) => box('player').has(id, n),
              renameIds() {},
              contents() { const out = {}; for (const [id, c] of boxes) out[id] = [...c.items]; return out; },
              setContents(data, { only = false } = {}) {
                for (const id in data) { if (data[id] || boxes.has(id)) box(id).items = new Map(data[id] ?? []); }
                if (only) for (const [id, c] of boxes) if (!(id in data)) c.items = new Map();
              },
            };
          },
        });
        const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'mb-' + Math.random() });
        e.use(world(), bag('mbBag'), content());
        await e.start();
        const out = {};
        try {
          e.content.load({ items: { apple: { name: 'Apple' } }, startItems: { apple: 2 }, containers: { chest: { items: { apple: 3 } } } });
          out.hostProvider = e.inventory === e.mbBag;
          out.hostLoaded = { player: e.inventory.count('apple'), chest: e.inventory.container('chest').count('apple'), item: e.inventory.item('apple').name };
          out.errors = [e.error].map(x => x ? String(x.message ?? x) : null);
        } finally { e.dispose(); }
        return out;
      });
      const J = JSON.stringify(r);
      check('content loads items, start items and a container into the game\'s own inventory provider (engine.inventory is that module)',
        r.hostProvider && r.hostLoaded.player === 2 && r.hostLoaded.chest === 3 && r.hostLoaded.item === 'Apple', J);
      check('no error was raised on the engine', r.errors.every(x => x === null), J);
    },
  },
];
