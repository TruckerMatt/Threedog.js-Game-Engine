// __NAME__'s base-building units (C&C / StarCraft style): an HQ that trains workers and stores resources, a depot for supply, a barracks
// and a factory, and crystal fields (neutral; hp is the amount left). Plain numbers; loadContent() checks every key.
export default {
  armor: { light: { bullet: 1, shell: 0.7 }, heavy: { bullet: 0.2, shell: 1 }, building: { bullet: 0.3, shell: 0.8 } },
  weapons: {
    rifle: { range: 26, damage: 7, cooldown: 0.8, damageType: 'bullet' },
    cannon: { range: 40, damage: 80, cooldown: 3, damageType: 'shell', projectileSpeed: 100, splash: 2, turret: true },
  },
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
