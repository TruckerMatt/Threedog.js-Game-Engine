// __NAME__'s units, weapons and armor: plain numbers (meters, seconds, degrees). loadContent() checks every key and names the fix.
// Guide: node_modules/@threedog/rts/docs/RTS.md "Content". Change freely: the bots and the UI read this list.
export default {
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
