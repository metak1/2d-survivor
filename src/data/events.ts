// Daytime content: NPCs, the merchant's stock, and how often each day event happens.

import type { Cost, IconRef, SpriteRef } from './types';

export type NpcKind = 'merchant' | 'traveller';
export type DayEvent = 'merchant' | 'traveller' | 'supplies' | 'bloodmoon';

export const NPC_LOOKS: Record<NpcKind | 'ally', SpriteRef> = {
  merchant: { sprite: 'swordsman', scale: 2.5 },
  traveller: { sprite: 'soldier', scale: 2.5 },
  ally: { sprite: 'soldier', scale: 2.5 },
};

/** Relative odds of each event at dawn, and the first day it can happen. */
export const DAY_EVENTS: { id: DayEvent; weight: number; minDay: number }[] = [
  { id: 'merchant', weight: 35, minDay: 2 },
  { id: 'traveller', weight: 25, minDay: 2 },
  { id: 'supplies', weight: 20, minDay: 2 },
  { id: 'bloodmoon', weight: 20, minDay: 3 },
];
/** Chance that a dawn brings any event at all. */
export const DAY_EVENT_CHANCE = 0.75;

export type ShopEffect = 'heal' | 'repairAll' | 'wood' | 'stone' | 'talent' | 'ally';

export interface ShopItem {
  id: ShopEffect;
  name: string;
  icon: IconRef;
  cost: Cost;
  desc: string;
  /** Can only be bought once per merchant visit. */
  once?: boolean;
}

export const SHOP: ShopItem[] = [
  { id: 'heal', name: 'Healing Draught', icon: 264, cost: { gold: 15 }, desc: 'Restore all your health.' },
  { id: 'repairAll', name: "Mason's Kit", icon: 124, cost: { gold: 40 }, desc: 'Repair every building by 50%.' },
  { id: 'wood', name: 'Timber Bundle', icon: 202, cost: { gold: 25 }, desc: '+60 wood.' },
  { id: 'stone', name: 'Quarried Stone', icon: 208, cost: { gold: 30 }, desc: '+50 stone.' },
  { id: 'talent', name: 'Tome of Insight', icon: 288, cost: { gold: 120 }, desc: '+1 talent point.', once: true },
  { id: 'ally', name: 'Hire a Sellsword', icon: 1440, cost: { gold: 80 }, desc: 'A soldier joins you and fights at your side.', once: true },
];

/** Camps of elite guardians with a treasure chest, out in the wilds. */
export const CAMPS = {
  initial: 4,
  max: 6,
  /** A new camp appears every N dawns. */
  every: 2,
  minDist: 22,
  maxDist: 34,
};
