// Example content and match builders used by the tests, the CLI (threedog rts match) and the docs. Plain data: copy and change it.
import { createMatch, loadContent, createMap, captureSystem, reinforceSystem, baseSystem, victorySystem, botSystem } from '../index.js';

/** Reinforcement-style content: infantry, a fast car, a tank, artillery */
export const REINFORCE_CONTENT = {
  armor: { light: { bullet: 1, shell: 0.7, he: 1.2 }, heavy: { bullet: 0.15, shell: 1, he: 0.5 } },
  weapons: {
    rifle: { range: 28, damage: 7, cooldown: 0.8, damageType: 'bullet' },
    mg: { range: 32, damage: 5, cooldown: 0.25, damageType: 'bullet', turret: true },
    cannon: { range: 45, damage: 95, cooldown: 3.5, damageType: 'shell', projectileSpeed: 120, splash: 2.5, turret: true },
    howitzer: { range: 120, minRange: 30, damage: 70, cooldown: 6, damageType: 'he', projectileSpeed: 60, splash: 8, arc: true },
  },
  units: {
    rifleman: { hp: 100, speed: 3.2, radius: 0.5, sight: 40, armor: 'light', weapons: ['rifle'], cost: 20 },
    scout: { hp: 220, speed: 14, radius: 1.5, sight: 70, armor: 'light', weapons: ['mg'], cost: 60, turnRate: 200 },
    tank: { hp: 900, speed: 8, radius: 2.5, sight: 50, armor: 'heavy', weapons: ['cannon'], cost: 150, turnRate: 90 },
    artillery: { hp: 300, speed: 6, radius: 2, sight: 30, armor: 'light', weapons: ['howitzer'], cost: 120, turnRate: 90 },
  },
};

/** Base-building content: an HQ that makes workers, a depot for supply, a barracks and a factory, one resource field kind */
export const BASE_CONTENT = {
  armor: { light: { bullet: 1, shell: 0.7 }, heavy: { bullet: 0.2, shell: 1 }, building: { bullet: 0.3, shell: 0.8 } },
  weapons: { rifle: { range: 26, damage: 7, cooldown: 0.8, damageType: 'bullet' }, cannon: { range: 40, damage: 80, cooldown: 3, damageType: 'shell', projectileSpeed: 100, splash: 2 } },
  units: {
    hq: { structure: true, hp: 3000, radius: 6, footprint: [12, 12], sight: 40, armor: 'building', produces: ['worker'], supply: 10, tags: ['dropoff'], cost: 400, capture: false },
    depot: { structure: true, hp: 800, radius: 3, footprint: [6, 6], sight: 20, armor: 'building', supply: 8, cost: 100, build: { time: 15 } },
    barracks: { structure: true, hp: 1200, radius: 4, footprint: [8, 8], sight: 25, armor: 'building', produces: ['rifleman'], cost: 150, build: { time: 25 } },
    factory: { structure: true, hp: 1600, radius: 5, footprint: [10, 10], sight: 25, armor: 'building', produces: ['tank'], cost: 200, build: { time: 35, requires: ['barracks'] } },
    crystal: { structure: true, hp: 1500, radius: 2, footprint: [4, 4], sight: 0, tags: ['resource'], capture: false },
    worker: { hp: 60, speed: 4, radius: 0.5, sight: 20, armor: 'light', cost: 50, supply: 1, gather: { amount: 8, time: 2 }, build: { time: 10 } },
    rifleman: { hp: 100, speed: 3.2, radius: 0.5, sight: 35, armor: 'light', weapons: ['rifle'], cost: 50, supply: 1, build: { time: 12 } },
    tank: { hp: 700, speed: 7, radius: 2.5, sight: 45, armor: 'heavy', weapons: ['cannon'], cost: 150, supply: 3, build: { time: 25, requires: ['factory'] } },
  },
};

/** A 600 x 400 m map: two hills and a river with two fords */
export function exampleMap() {
  return createMap({ width: 600, depth: 400, cell: 2,
    height: (x, z) => Math.max(0, 14 - Math.sqrt((x + 60) * (x + 60) + (z - 90) * (z - 90)) / 3) + Math.max(0, 10 - Math.sqrt((x - 80) * (x - 80) + (z + 100) * (z + 100)) / 3),
    blocked: (x, z) => Math.abs(x) < 4 && Math.abs(z) > 30 && Math.abs(Math.abs(z) - 120) > 15 });
}

/**
 * A reinforcement match (World in Conflict style) on the example map. settings: { seed, players: [{ team, bot? }] } (what the relay sends).
 * Teams 0 and 1 deploy on the west and east edges; four capture points; first to 300 score or 15 minutes.
 */
export function reinforceMatch(settings, o = {}) {
  const content = o.content ?? loadContent(REINFORCE_CONTENT);
  return createMatch({ seed: settings.seed, content, map: o.map ?? exampleMap(), players: settings.players,
    extra: [
      reinforceSystem({ budget: 1500, deployDelay: 6, refundDelay: 20, zones: [{ team: 0, x: -260, z: 0, radius: 40 }, { team: 1, x: 260, z: 0, radius: 40 }],
        start: settings.players.map((_, p) => ({ p, kinds: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'tank'] })) }),
      captureSystem({ points: [{ id: 'north-ford', x: 0, z: 120 }, { id: 'south-ford', x: 0, z: -120 }, { id: 'west-hill', x: -60, z: 90, value: 2 }, { id: 'east-hill', x: 80, z: -100, value: 2 }] }),
      victorySystem({ scoreLimit: 300, timeLimit: 15 * 60 }),
      botSystem(),
    ] });
}

/** A base-building match (C&C / StarCraft style) on the example map: HQs on the west and east, crystal fields beside each and in the middle */
export function baseMatch(settings, o = {}) {
  const content = o.content ?? loadContent(BASE_CONTENT);
  const starts = [{ x: -240, z: 0 }, { x: 240, z: 0 }, { x: -240, z: 150 }, { x: 240, z: -150 }];
  return createMatch({ seed: settings.seed, content, map: o.map ?? exampleMap(), players: settings.players,
    extra: [
      baseSystem({ startRes: 500, start: settings.players.map((_, p) => ({ p, ...starts[p], kinds: ['hq', 'worker', 'worker', 'worker', 'worker'] })),
        resources: starts.slice(0, settings.players.length).flatMap(s => [{ kind: 'crystal', x: s.x + (s.x < 0 ? 30 : -30), z: s.z + 20 }, { kind: 'crystal', x: s.x + (s.x < 0 ? 30 : -30), z: s.z - 20 }])
          .concat([{ kind: 'crystal', x: 0, z: 0 }]) }),
      victorySystem({ timeLimit: 30 * 60 }),
      botSystem(),
    ] });
}
