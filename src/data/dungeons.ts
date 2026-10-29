// Dungeons: one entrance per theme out in the wilds. Each opens on a given day, holds packs of
// its monsters and a boss in the deepest chamber, and reopens deeper a few days after it's cleared.

import type { EnemyId } from './types';

export type DungeonTheme = 'crypt' | 'warren' | 'depths';

export interface DungeonDef {
  name: string;
  /** First day it can be entered. */
  opens: number;
  /** Monster levels above the current day (0 = as strong as tonight's horde). */
  bonus: number;
  /** Monsters in its packs, picked by weight. */
  pool: [EnemyId, number][];
  boss: EnemyId;
  /** Rune and torch colour. */
  color: string;
  /** Floor tile variant (worldgen GROUND.floor index). */
  floor: number;
}

export const DUNGEONS: Record<DungeonTheme, DungeonDef> = {
  crypt: {
    name: 'Forgotten Crypt', opens: 5, bonus: 0, boss: 'dboss_knight', color: '#9ad8ff', floor: 0,
    pool: [['zombie', 6], ['spitter', 3], ['shaman', 1]],
  },
  warren: {
    name: 'Orc Warren', opens: 10, bonus: 1, boss: 'dboss_bear', color: '#9be36b', floor: 1,
    pool: [['runner', 4], ['brute', 2], ['guard_orc', 1.5], ['spitter', 1]],
  },
  depths: {
    name: 'Infernal Depths', opens: 15, bonus: 2, boss: 'dboss_slime', color: '#ff8a3a', floor: 2,
    pool: [['brute', 2], ['shaman', 1.5], ['guard_minotaur', 1], ['guard_bear', 1], ['spitter', 2]],
  },
};

export const DUNGEON_ORDER: DungeonTheme[] = ['crypt', 'warren', 'depths'];

/** Days a cleared dungeon stays empty before it reopens, one level deeper. */
export const DUNGEON_REOPEN = 3;
