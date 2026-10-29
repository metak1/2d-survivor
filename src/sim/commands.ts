// Everything a player can ask for besides moving and casting: building, upgrades, talents,
// equipment, the shop. Solo play applies commands directly; in multiplayer the client sends them to the server,
// which applies them to its game. Either way they go through applyCommand.

import { BUILD_SLOTS } from '../data/buildings';
import { SHOP, type ShopEffect } from '../data/events';
import { ITEM_SLOTS, type ItemSlot } from '../data/items';
import { buyItem, equipItem, salvageItem, unequipItem } from './items';
import { craftLegend, empower, reroll, upgrade } from './forge';
import type { BuildSlot } from '../data/types';
import type { Game } from './game';
import type { Player } from './player';

export type Command =
  | { c: 'build'; slot: BuildSlot; x: number; y: number; quiet?: boolean }
  | { c: 'upgrade'; id: number }
  | { c: 'repair'; id: number }
  | { c: 'demolish'; id: number }
  | { c: 'learn'; tree: number; node: string; option: number }
  | { c: 'unlearn'; tree: number; option: string }
  | { c: 'resetTalents' }
  | { c: 'buy'; item: ShopEffect }
  | { c: 'interact' }
  | { c: 'callNight' }
  | { c: 'equip'; bag: number }
  | { c: 'unequip'; slot: ItemSlot }
  | { c: 'salvage'; bag: number }
  | { c: 'buyItem'; index: number }
  /** The Legendary Forge: craft a discovered legendary, or work on an item by id. */
  | { c: 'forge'; op: 'craft'; legend: string }
  | { c: 'forge'; op: 'empower' | 'reroll' | 'upgrade'; item: number };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 40): v is string => typeof v === 'string' && v.length <= max;

/**
 * Checks a command that arrived over the network. Returns it if well-formed, else null, so a
 * broken or hostile client can't feed the game bad data.
 */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.c) {
    case 'build':
      return BUILD_SLOTS.includes(c.slot as BuildSlot) && num(c.x) && num(c.y)
        ? { c: 'build', slot: c.slot as BuildSlot, x: c.x, y: c.y, quiet: !!c.quiet } : null;
    case 'upgrade': case 'repair': case 'demolish':
      return num(c.id) ? { c: c.c, id: c.id } : null;
    case 'learn':
      return num(c.tree) && str(c.node) && num(c.option) ? { c: 'learn', tree: c.tree, node: c.node, option: c.option } : null;
    case 'unlearn':
      return num(c.tree) && str(c.option) ? { c: 'unlearn', tree: c.tree, option: c.option } : null;
    case 'buy':
      return SHOP.some(i => i.id === c.item) ? { c: 'buy', item: c.item as ShopEffect } : null;
    case 'resetTalents': case 'interact': case 'callNight':
      return { c: c.c };
    case 'equip': case 'salvage':
      return num(c.bag) ? { c: c.c, bag: c.bag } : null;
    case 'unequip':
      return ITEM_SLOTS.includes(c.slot as ItemSlot) ? { c: 'unequip', slot: c.slot as ItemSlot } : null;
    case 'buyItem':
      return num(c.index) ? { c: 'buyItem', index: c.index } : null;
    case 'forge':
      if (c.op === 'craft') return str(c.legend) ? { c: 'forge', op: 'craft', legend: c.legend } : null;
      return (c.op === 'empower' || c.op === 'reroll' || c.op === 'upgrade') && num(c.item) ? { c: 'forge', op: c.op, item: c.item } : null;
    default:
      return null;
  }
}

/** Applies a player's command. Returns an error message for the player, or null. */
export function applyCommand(g: Game, p: Player, cmd: Command): string | null {
  const bld = (id: number) => g.world.buildingById(id);
  switch (cmd.c) {
    case 'build': g.build(p, cmd.slot, cmd.x, cmd.y, !cmd.quiet); return null;
    case 'upgrade': { const b = bld(cmd.id); if (b) g.upgrade(p, b); return null; }
    case 'repair': { const b = bld(cmd.id); if (b) g.repair(b); return null; }
    case 'demolish': { const b = bld(cmd.id); if (b) g.demolish(b); return null; }
    case 'learn': p.learnTalent(cmd.tree, cmd.node, cmd.option); return null;
    case 'unlearn': p.unlearnTalent(cmd.tree, cmd.option); return null;
    case 'resetTalents': p.resetTalents(); return null;
    case 'buy': return g.buy(p, cmd.item);
    case 'interact': if (!p.dead) g.interact(p); return null;
    case 'callNight': g.callNight(p); return null;
    case 'equip': return equipItem(p, cmd.bag);
    case 'unequip': return unequipItem(p, cmd.slot) ? null : 'Your bag is full';
    case 'salvage': salvageItem(g, p, cmd.bag); return null;
    case 'buyItem': return buyItem(g, p, cmd.index);
    case 'forge':
      if (cmd.op === 'craft') return craftLegend(g, p, cmd.legend);
      return (cmd.op === 'empower' ? empower : cmd.op === 'reroll' ? reroll : upgrade)(g, p, cmd.item);
  }
}
