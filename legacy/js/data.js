'use strict';
// ---------------------------------------------------------------------------
// Static game data: world constants, classes, talents, buildings, enemies.
// ---------------------------------------------------------------------------

const TILE = 40;
const MAP_W = 80, MAP_H = 80;
const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;

const FIRST_DAY_LEN = 150;   // seconds of the first day (extra prep time)
const DAY_LEN = 100;
const NIGHT_BASE_LEN = 70;
const BUILD_RANGE = 520;     // max distance from the player to place a building
const TALENT_TIER_REQ = 2;   // points needed in a tree per talent row

const CLASSES = {
  warrior: {
    name: 'Warrior', color: '#c94f4f', accent: '#f2c879', hp: 170, speed: 185, regen: 1,
    tagline: 'Unbreakable frontline brawler',
    desc: 'Cleaves through the horde up close. High health and strong area control.',
    light: 230,
    basic: { name: 'Cleave', icon: '🗡️', type: 'melee', dmg: 24, cd: 0.45, range: 74, arc: 1.9,
      desc: 'Swing your sword in a wide arc. Also chops trees and mines rocks.' },
    mobility: { id: 'roll', name: 'Roll', icon: '💨', cd: 3,
      desc: 'Dodge-roll in your movement direction. Briefly invulnerable.' },
    spells: [
      { id: 'charge', key: 'KeyQ', name: 'Charge', icon: '⚡', cd: 7,
        desc: 'Dash toward the cursor, damaging and stunning enemies in your path.' },
      { id: 'whirlwind', key: 'KeyE', name: 'Whirlwind', icon: '🌀', cd: 10,
        desc: 'Spin for 1.6s, repeatedly striking everything around you.' },
      { id: 'battlecry', key: 'KeyR', name: 'Battle Cry', icon: '📯', cd: 30,
        desc: 'Heal 30% HP, gain +40% damage for 8s and blast nearby foes away.' },
    ],
  },
  mage: {
    name: 'Mage', color: '#5b6ee1', accent: '#9fe7ff', hp: 95, speed: 195, regen: 0.6,
    tagline: 'Master of fire and frost',
    desc: 'Fragile but devastating. Huge area damage and crowd control from range.',
    light: 260,
    basic: { name: 'Arcane Bolt', icon: '✨', type: 'bolt', dmg: 17, cd: 0.36, speed: 620,
      desc: 'Fire a bolt of arcane energy. Also harvests resources.' },
    mobility: { id: 'blink', name: 'Blink', icon: '🌌', cd: 4,
      desc: 'Teleport a short distance toward the cursor.' },
    spells: [
      { id: 'fireball', key: 'KeyQ', name: 'Fireball', icon: '🔥', cd: 5,
        desc: 'Hurl a fireball that explodes and sets enemies ablaze.' },
      { id: 'frostnova', key: 'KeyE', name: 'Frost Nova', icon: '❄️', cd: 11,
        desc: 'Freeze all nearby enemies solid for 2s.' },
      { id: 'meteor', key: 'KeyR', name: 'Meteor', icon: '☄️', cd: 32,
        desc: 'Call down a meteor at the cursor for massive damage.' },
    ],
  },
  ranger: {
    name: 'Ranger', color: '#3f9d5a', accent: '#d9e86a', hp: 120, speed: 215, regen: 0.8,
    tagline: 'Swift hunter and trapper',
    desc: 'Fast and precise. Rapid arrows, traps, and the best builder of the three.',
    light: 240,
    basic: { name: 'Arrow', icon: '🏹', type: 'arrow', dmg: 15, cd: 0.28, speed: 880,
      desc: 'Loose a fast arrow. Also harvests resources.' },
    mobility: { id: 'roll', name: 'Roll', icon: '💨', cd: 2.5,
      desc: 'Dodge-roll in your movement direction. Briefly invulnerable.' },
    spells: [
      { id: 'volley', key: 'KeyQ', name: 'Volley', icon: '🎯', cd: 6,
        desc: 'Fire a fan of 7 arrows toward the cursor.' },
      { id: 'snare', key: 'KeyE', name: 'Venom Snare', icon: '🕸️', cd: 8,
        desc: 'Place a trap at the cursor. When triggered it roots enemies and releases a poison cloud.' },
      { id: 'rain', key: 'KeyR', name: 'Rain of Arrows', icon: '🌧️', cd: 28,
        desc: 'Arrows rain on the target area for 4s.' },
    ],
  },
};

// Every stat a talent can modify. Values are the base for all classes.
const BASE_STATS = {
  maxHp: 0, regen: 0, dmgMul: 1, moveMul: 1, cdr: 0, crit: 0.05, atkSpeed: 1,
  buildCost: 1, wallHp: 1, towerDmg: 1, towerSpeed: 1, aoe: 1, pierce: 0, extraProj: 0,
  lifesteal: 0, armor: 0, thorns: 0, gather: 1, freezeBonus: 0, arcMul: 1, rangeMul: 1,
};

// Three trees per class, four talents per tree. Row i needs i*TALENT_TIER_REQ points in the tree.
const TALENTS = {
  warrior: [
    { name: 'Arms', color: '#e0735f', talents: [
      { id: 'w_heavy', name: 'Heavy Blows', icon: '🔨', max: 5, mods: { dmgMul: 0.08 }, desc: '+8% damage per rank.' },
      { id: 'w_cleave', name: 'Wide Cleave', icon: '🌙', max: 3, mods: { arcMul: 0.15, rangeMul: 0.1 }, desc: '+15% swing arc and +10% reach per rank.' },
      { id: 'w_exec', name: 'Executioner', icon: '💀', max: 3, mods: { crit: 0.06 }, desc: '+6% critical strike chance per rank.' },
      { id: 'w_seismic', name: 'Seismic Charge', icon: '🌋', max: 1, flag: 'seismic', desc: 'Charge ends with a shockwave that deals heavy area damage.' },
    ] },
    { name: 'Protection', color: '#d9b45a', talents: [
      { id: 'w_tough', name: 'Toughness', icon: '🛡️', max: 5, mods: { maxHp: 20 }, desc: '+20 maximum health per rank.' },
      { id: 'w_regen', name: 'Second Wind', icon: '💗', max: 3, mods: { regen: 1.2 }, desc: '+1.2 health regeneration per second per rank.' },
      { id: 'w_thorns', name: 'Thorns', icon: '🌵', max: 3, mods: { thorns: 8 }, desc: 'Enemies that hit you take 8 damage per rank.' },
      { id: 'w_unbreak', name: 'Unbreakable', icon: '🗿', max: 1, flag: 'unbreakable', desc: 'Battle Cry also halves all damage you take while active.' },
    ] },
    { name: 'Warlord', color: '#8fb0d9', talents: [
      { id: 'w_builder', name: 'Master Builder', icon: '🏗️', max: 3, mods: { buildCost: -0.1 }, desc: 'Buildings cost 10% less per rank.' },
      { id: 'w_fortify', name: 'Fortify', icon: '🧱', max: 3, mods: { wallHp: 0.25 }, desc: 'New walls and gates have +25% health per rank.' },
      { id: 'w_tempo', name: 'Battle Tempo', icon: '⏱️', max: 3, mods: { cdr: 0.06 }, desc: 'Spells recharge 6% faster per rank.' },
      { id: 'w_endless', name: 'Endless Whirlwind', icon: '🌪️', max: 1, flag: 'endless', desc: 'Whirlwind lasts 60% longer and has a larger radius.' },
    ] },
  ],
  mage: [
    { name: 'Fire', color: '#f07a3a', talents: [
      { id: 'm_pyro', name: 'Pyromania', icon: '🔥', max: 5, mods: { dmgMul: 0.08 }, desc: '+8% damage per rank.' },
      { id: 'm_wild', name: 'Wildfire', icon: '💥', max: 3, mods: { aoe: 0.12 }, desc: '+12% area of effect per rank.' },
      { id: 'm_comb', name: 'Combustion', icon: '✴️', max: 3, mods: { crit: 0.06 }, desc: '+6% critical strike chance per rank.' },
      { id: 'm_twin', name: 'Meteor Shower', icon: '☄️', max: 1, flag: 'twin', desc: 'Meteor calls down two additional meteors nearby.' },
    ] },
    { name: 'Frost', color: '#7fd3f5', talents: [
      { id: 'm_armor', name: 'Ice Armor', icon: '🧊', max: 4, mods: { armor: 0.06 }, desc: 'Take 6% less damage per rank.' },
      { id: 'm_vigor', name: 'Arcane Vigor', icon: '💠', max: 3, mods: { maxHp: 15, regen: 0.4 }, desc: '+15 maximum health and +0.4 regeneration per rank.' },
      { id: 'm_deep', name: 'Deep Freeze', icon: '❄️', max: 3, mods: { freezeBonus: 0.5 }, desc: 'Freeze effects last 0.5s longer per rank.' },
      { id: 'm_shatter', name: 'Shatter', icon: '🔷', max: 1, flag: 'shatter', desc: 'Frozen enemies take 50% more damage.' },
    ] },
    { name: 'Arcane', color: '#b58cff', talents: [
      { id: 'm_quick', name: 'Quickening', icon: '⏳', max: 4, mods: { cdr: 0.06 }, desc: 'Spells recharge 6% faster per rank.' },
      { id: 'm_flow', name: 'Mana Flow', icon: '🌀', max: 3, mods: { atkSpeed: 0.1 }, desc: '+10% attack speed per rank.' },
      { id: 'm_split', name: 'Split Bolt', icon: '🔱', max: 2, mods: { extraProj: 1 }, desc: 'Arcane Bolt fires one extra bolt per rank.' },
      { id: 'm_runic', name: 'Runic Towers', icon: '🗼', max: 1, flag: 'sentry', mods: { towerDmg: 0.3 }, desc: 'Your towers deal 30% more damage and fire 30% faster.' },
    ] },
  ],
  ranger: [
    { name: 'Marksman', color: '#d9e86a', talents: [
      { id: 'r_sharp', name: 'Sharpshooter', icon: '🎯', max: 5, mods: { dmgMul: 0.08 }, desc: '+8% damage per rank.' },
      { id: 'r_rapid', name: 'Rapid Fire', icon: '⚡', max: 3, mods: { atkSpeed: 0.1 }, desc: '+10% attack speed per rank.' },
      { id: 'r_pierce', name: 'Piercing Arrows', icon: '➶', max: 2, mods: { pierce: 1, crit: 0.04 }, desc: 'Arrows pierce one more enemy and +4% crit chance per rank.' },
      { id: 'r_barrage', name: 'Barrage', icon: '🏹', max: 1, flag: 'barrage', desc: 'Volley fires 13 arrows that pierce.' },
    ] },
    { name: 'Survival', color: '#6fcf86', talents: [
      { id: 'r_hardy', name: 'Hardy', icon: '🛡️', max: 4, mods: { maxHp: 15 }, desc: '+15 maximum health per rank.' },
      { id: 'r_fleet', name: 'Fleet Foot', icon: '🦌', max: 3, mods: { moveMul: 0.06 }, desc: '+6% movement speed per rank.' },
      { id: 'r_blood', name: 'Bloodthirst', icon: '🩸', max: 3, mods: { lifesteal: 0.02 }, desc: 'Heal for 2% of damage dealt per rank.' },
      { id: 'r_toxic', name: 'Toxic Snare', icon: '☠️', max: 1, flag: 'bigtrap', desc: 'Venom Snare clouds are 50% larger and last twice as long.' },
    ] },
    { name: 'Frontier', color: '#c9a36b', talents: [
      { id: 'r_carp', name: 'Carpentry', icon: '🪚', max: 3, mods: { buildCost: -0.1 }, desc: 'Buildings cost 10% less per rank.' },
      { id: 'r_lumber', name: 'Lumberjack', icon: '🪓', max: 3, mods: { gather: 0.3 }, desc: 'Gather 30% more resources per rank.' },
      { id: 'r_ballist', name: 'Ballistics', icon: '🏰', max: 3, mods: { towerDmg: 0.15 }, desc: 'Your towers deal 15% more damage per rank.' },
      { id: 'r_sentry', name: 'Sentry Instinct', icon: '👁️', max: 1, flag: 'sentry', desc: 'Your towers fire 30% faster.' },
    ] },
  ],
};

// Resource nodes scattered around the map. Attacking them yields resources.
const NODES = {
  tree: { res: 'wood', amount: 45, r: 17 },
  rock: { res: 'stone', amount: 40, r: 16 },
  gold: { res: 'gold', amount: 30, r: 15 },
};

const RES_ICONS = { wood: '🪵', stone: '🪨', gold: '🪙' };

const BUILDINGS = {
  wall: { name: 'Wood Wall', icon: '🪵', cost: { wood: 10 }, hp: 220, solid: true, wall: true,
    desc: 'Cheap barrier. Drag to place a line.' },
  stonewall: { name: 'Stone Wall', icon: '🧱', cost: { wood: 4, stone: 12 }, hp: 600, solid: true, wall: true,
    desc: 'Sturdy barrier that holds back brutes.' },
  gate: { name: 'Gate', icon: '🚪', cost: { wood: 20, stone: 5 }, hp: 350, solid: true, wall: true, gate: true,
    desc: 'You can walk through it, monsters cannot.' },
  arrowtower: { name: 'Arrow Tower', icon: '🏹', cost: { wood: 35, stone: 15 }, hp: 300, solid: true,
    tower: { range: 290, dmg: 13, cd: 0.75, proj: 'arrow' }, desc: 'Shoots the nearest monster.' },
  firetower: { name: 'Fire Brazier', icon: '🔥', cost: { stone: 30, gold: 15 }, hp: 350, solid: true, light: 190,
    tower: { range: 240, dmg: 24, cd: 1.7, splash: 70, proj: 'lob' }, desc: 'Lobs fireballs that burn groups.' },
  spikes: { name: 'Spike Trap', icon: '📌', cost: { wood: 15, stone: 5 }, hp: 160, solid: false,
    trap: { dmg: 10, cd: 0.5, slow: 0.5 }, desc: 'Damages and slows monsters walking over it.' },
  torch: { name: 'Torch', icon: '🕯️', cost: { wood: 5 }, hp: 60, solid: false, light: 230,
    desc: 'Lights up the night.' },
  shrine: { name: 'Healing Shrine', icon: '💚', cost: { stone: 25, gold: 20 }, hp: 300, solid: true, light: 140,
    aura: { r: 170, heal: 6, repair: 5 }, desc: 'Heals you and repairs nearby buildings.' },
  hearth: { name: 'Hearth', icon: '🔥', cost: {}, hp: 1500, solid: true, size: 2, light: 360, hidden: true },
};
const BUILD_ORDER = ['wall', 'stonewall', 'gate', 'arrowtower', 'firetower', 'spikes', 'torch', 'shrine'];
const BUILD_TOOLS = {
  repair: { name: 'Repair', icon: '🔧', desc: 'Click a damaged building to repair it (costs wood).' },
  demolish: { name: 'Demolish', icon: '💣', desc: 'Click a building to remove it (50% refund).' },
};
const BUILD_SLOTS = [...BUILD_ORDER, 'repair', 'demolish'];
const BUILD_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

const ENEMIES = {
  zombie: { name: 'Ghoul', hp: 42, speed: 62, r: 13, dmg: 9, atkCd: 1.0, reach: 6, xp: 4, gold: 1,
    color: '#6b8f4e', cost: 1, weight: 10, minNight: 1 },
  runner: { name: 'Stalker', hp: 24, speed: 128, r: 10, dmg: 6, atkCd: 0.7, reach: 6, xp: 3, gold: 1,
    color: '#9a5cc4', cost: 1, weight: 6, minNight: 2 },
  spitter: { name: 'Spitter', hp: 32, speed: 70, r: 12, dmg: 8, atkCd: 2.0, reach: 6, xp: 6, gold: 2,
    color: '#b5c043', cost: 2, weight: 4, minNight: 3, ranged: true, range: 270, projSpeed: 320 },
  brute: { name: 'Brute', hp: 210, speed: 46, r: 20, dmg: 26, atkCd: 1.5, reach: 8, xp: 15, gold: 6,
    color: '#8a5a3c', cost: 5, weight: 2, minNight: 4, buildingHunter: true, bldMul: 2.5 },
  boss: { name: 'Night Horror', hp: 1600, speed: 54, r: 34, dmg: 38, atkCd: 2.0, reach: 12, xp: 150, gold: 50,
    color: '#6a2448', cost: 0, weight: 0, minNight: 99, boss: true, bldMul: 2 },
};
