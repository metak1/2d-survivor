// Equipment: slots, rarities, the stat affixes items roll, base names and icons, and the named
// legendaries. Items add to a player's Stats exactly like talents do (see sim/stats.ts).

import type { ClassId, StatKey } from './types';

export type ItemSlot = 'weapon' | 'helm' | 'armor' | 'boots' | 'ring';
export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary';

export const ITEM_SLOTS: ItemSlot[] = ['weapon', 'helm', 'armor', 'boots', 'ring'];
export const SLOT_NAMES: Record<ItemSlot, string> = { weapon: 'Weapon', helm: 'Helm', armor: 'Armor', boots: 'Boots', ring: 'Ring' };
export const BAG_SIZE = 12;

export interface RarityDef {
  name: string;
  color: string;
  /** Random affixes rolled. */
  affixes: number;
  /** Multiplier on affix values. */
  power: number;
  /** Drop weight before luck. */
  weight: number;
  /** Gold from salvaging, and the merchant's price, before item level. */
  salvage: number;
  price: number;
}

export const RARITIES: Record<Rarity, RarityDef> = {
  common: { name: 'Common', color: '#d2d2d2', affixes: 1, power: 0.7, weight: 52, salvage: 3, price: 25 },
  magic: { name: 'Magic', color: '#6fe06f', affixes: 1, power: 1, weight: 31, salvage: 8, price: 45 },
  rare: { name: 'Rare', color: '#5aa8ff', affixes: 2, power: 1.15, weight: 12.5, salvage: 20, price: 95 },
  epic: { name: 'Epic', color: '#c07aff', affixes: 3, power: 1.3, weight: 4, salvage: 50, price: 210 },
  legendary: { name: 'Legendary', color: '#ff9a3a', affixes: 1, power: 1.5, weight: 0.5, salvage: 120, price: 480 },
};
export const RARITY_ORDER: Rarity[] = ['common', 'magic', 'rare', 'epic', 'legendary'];

export interface AffixDef {
  stat: StatKey;
  /** Value at item level 1, rarity power 1 (rolled between 60% and 100%). */
  per: number;
  /** Slots it can roll on. */
  slots: ItemSlot[];
  prefix: string;
  suffix: string;
  /** How to show it: a percentage, or a plain number. */
  pct: boolean;
  label: string;
  /** Only rolls when someone in the party plays this class (it does nothing for the others). */
  needs?: ClassId;
}

const ALL: ItemSlot[] = ['weapon', 'helm', 'armor', 'boots', 'ring'];

export const AFFIXES: AffixDef[] = [
  { stat: 'dmgMul', per: 0.05, slots: ['weapon', 'ring', 'helm'], prefix: 'Brutal', suffix: 'of Slaying', pct: true, label: 'damage' },
  { stat: 'crit', per: 0.035, slots: ['weapon', 'helm', 'ring'], prefix: 'Keen', suffix: 'of Precision', pct: true, label: 'critical strike chance' },
  { stat: 'atkSpeed', per: 0.06, slots: ['weapon', 'ring'], prefix: 'Swift', suffix: 'of Haste', pct: true, label: 'attack speed' },
  { stat: 'maxHp', per: 14, slots: ['armor', 'helm', 'boots', 'ring'], prefix: 'Sturdy', suffix: 'of the Bear', pct: false, label: 'maximum health' },
  { stat: 'regen', per: 0.7, slots: ['armor', 'helm', 'ring'], prefix: 'Mending', suffix: 'of the Troll', pct: false, label: 'health regeneration per second' },
  { stat: 'armor', per: 0.035, slots: ['armor', 'helm', 'boots'], prefix: 'Warded', suffix: 'of the Tortoise', pct: true, label: 'less damage taken' },
  { stat: 'moveMul', per: 0.045, slots: ['boots'], prefix: 'Fleet', suffix: 'of the Wind', pct: true, label: 'movement speed' },
  { stat: 'cdr', per: 0.035, slots: ['helm', 'ring', 'weapon'], prefix: 'Focused', suffix: 'of the Owl', pct: true, label: 'faster spell recharge' },
  { stat: 'lifesteal', per: 0.015, slots: ['weapon', 'ring'], prefix: 'Vampiric', suffix: 'of the Leech', pct: true, label: 'of damage dealt healed' },
  { stat: 'aoe', per: 0.06, slots: ['weapon', 'helm'], prefix: 'Sweeping', suffix: 'of the Storm', pct: true, label: 'area of effect' },
  { stat: 'healMul', per: 0.07, slots: ['weapon', 'helm', 'ring'], prefix: 'Blessed', suffix: 'of Mercy', pct: true, label: 'stronger heals', needs: 'cleric' },
  { stat: 'thorns', per: 6, slots: ['armor'], prefix: 'Spiked', suffix: 'of Thorns', pct: false, label: 'damage to attackers' },
  { stat: 'gather', per: 0.15, slots: ['boots', 'ring'], prefix: "Woodsman's", suffix: 'of Plenty', pct: true, label: 'resources gathered' },
  { stat: 'towerDmg', per: 0.07, slots: ['helm', 'ring'], prefix: "Engineer's", suffix: 'of the Bastion', pct: true, label: 'tower damage' },
  { stat: 'buildCost', per: -0.04, slots: ['boots', 'ring', 'armor'], prefix: "Mason's", suffix: 'of Thrift', pct: true, label: 'building cost' },
  { stat: 'goldMul', per: 0.1, slots: ALL, prefix: 'Gilded', suffix: 'of Fortune', pct: true, label: 'gold from monsters' },
];

/** Base names per slot; weapons depend on who's holding them. */
export const BASES: Record<ItemSlot, Partial<Record<ClassId, string[]>> & { any?: string[] }> = {
  weapon: { warrior: ['Sword', 'Axe', 'Greatsword'], mage: ['Staff', 'Wand', 'Rod'], ranger: ['Bow', 'Longbow', 'Recurve'], cleric: ['Mace', 'Scepter', 'Flail'] },
  helm: { any: ['Helm', 'Hood', 'Circlet', 'Coif'] },
  armor: { any: ['Mail', 'Robe', 'Jerkin', 'Breastplate'] },
  boots: { any: ['Boots', 'Greaves', 'Treads'] },
  ring: { any: ['Ring', 'Band', 'Signet'] },
};

/** Raven icon indices per slot (and per class for weapons). */
export const SLOT_ICONS: Record<ItemSlot, Partial<Record<ClassId, number[]>> & { any?: number[] }> = {
  weapon: {
    warrior: [1440, 1445, 1447, 1504, 1509, 1600, 1607],
    mage: [1488, 1489, 1491, 1568, 1570, 1648, 1650],
    ranger: [1482, 1483, 1513, 1515, 1594, 1595, 1674],
    cleric: [1472, 1474, 1475, 1552, 1555, 1632, 1635],
  },
  helm: { any: [1904, 1905, 1908, 1910, 1914, 1915, 1917] },
  armor: { any: [1856, 1862, 1866, 1880, 1920, 1926, 1931] },
  boots: { any: [1936, 1940, 1942, 1945, 1948, 1984, 1994] },
  ring: { any: [1842, 1843, 1844, 1845, 1846, 1847] },
};

export interface LegendaryDef {
  id: string;
  name: string;
  slot: ItemSlot;
  icon: number;
  mods: Partial<Record<StatKey, number>>;
  /** Behaviour switch, read like a talent flag. */
  flag?: string;
  desc: string;
}

export const LEGENDARIES: LegendaryDef[] = [
  { id: 'bloodfang', name: 'Bloodfang', slot: 'weapon', icon: 1588, mods: { dmgMul: 0.1, lifesteal: 0.04 }, flag: 'reaper',
    desc: 'Every kill heals you for 4% of your maximum health.' },
  { id: 'stormcaller', name: 'Stormcaller', slot: 'weapon', icon: 1602, mods: { atkSpeed: 0.12 }, flag: 'item_chain',
    desc: 'Your hits have a 15% chance to fork lightning into 3 more enemies.' },
  { id: 'phoenix', name: 'Phoenix Plume', slot: 'helm', icon: 1915, mods: { maxHp: 30 }, flag: 'phoenix',
    desc: 'Once per night, instead of falling you explode in flame and rise at 50% health.' },
  { id: 'crown', name: 'Crown of Ages', slot: 'helm', icon: 1910, mods: { cdr: 0.12 }, flag: 'chrono',
    desc: 'Each kill takes 0.2s off all your spell cooldowns.' },
  { id: 'aegis', name: 'Aegis of Dawn', slot: 'armor', icon: 1931, mods: { armor: 0.08, maxHp: 40 }, flag: 'item_dawn',
    desc: 'Every 12s you gain a shield worth 15% of your maximum health.' },
  { id: 'bastion', name: 'Heart of the Bastion', slot: 'armor', icon: 1866, mods: { thorns: 20, wallHp: 0.25, towerDmg: 0.15 },
    desc: 'Your walls have 25% more health and your towers deal 15% more damage.' },
  { id: 'windwalkers', name: 'Windwalkers', slot: 'boots', icon: 1942, mods: { moveMul: 0.15 }, flag: 'evasion',
    desc: '8% chance to dodge an attack entirely.' },
  { id: 'warband', name: 'Ring of the Warband', slot: 'ring', icon: 1845, mods: { allyMax: 1, allyPow: 0.3 },
    desc: '+1 companion slot, and companions have 30% more health and damage.' },
  { id: 'frostbite', name: 'Frostbite Band', slot: 'ring', icon: 1846, mods: { crit: 0.05 }, flag: 'item_frost',
    desc: 'Your hits have a 10% chance to freeze enemies for 0.8s.' },
  { id: 'signet', name: 'Gilded Signet', slot: 'ring', icon: 1843, mods: { goldMul: 0.4, gather: 0.3 },
    desc: 'Monsters drop 40% more gold and you gather 30% more resources.' },
];

/** Labels for stats that only legendaries give. */
export const EXTRA_STAT_LABELS: Partial<Record<StatKey, { label: string; pct: boolean }>> = {
  allyMax: { label: 'companion slot', pct: false },
  allyPow: { label: 'companion health and damage', pct: true },
  wallHp: { label: 'wall health', pct: true },
};
