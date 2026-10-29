import type { EnemyDef, EnemyId, NodeDef, NodeId, ResKey, IconRef } from './types';

// Wave monsters spend a nightly point budget (`cost`), picked by `weight` once `minNight` is reached.
export const ENEMIES: Record<EnemyId, EnemyDef> = {
  zombie: { name: 'Skeleton', hp: 42, speed: 62, r: 13, dmg: 9, atkCd: 1.0, reach: 6, xp: 4, gold: 1,
    color: '#c8c3b0', cost: 1, weight: 10, minNight: 1, look: { sprite: 'skeleton', scale: 2.4 },
    blurb: 'shambling horde' },
  runner: { name: 'Werewolf', hp: 24, speed: 128, r: 11, dmg: 6, atkCd: 0.7, reach: 6, xp: 3, gold: 1,
    color: '#8a6a4a', cost: 1, weight: 6, minNight: 2, look: { sprite: 'werewolf', scale: 2.3 },
    blurb: 'fast, fragile' },
  bat: { name: 'Hellbat', hp: 18, speed: 150, r: 10, dmg: 5, atkCd: 0.8, reach: 6, xp: 3, gold: 1,
    color: '#b03030', cost: 1, weight: 5, minNight: 2, flying: true, look: { sprite: 'hellbat', scale: 2.2, offsetY: -14 },
    blurb: 'flies over walls, hunts you' },
  spitter: { name: 'Skeleton Archer', hp: 32, speed: 70, r: 12, dmg: 8, atkCd: 2.0, reach: 6, xp: 6, gold: 2,
    color: '#b5c043', cost: 2, weight: 4, minNight: 3, ranged: true, range: 270, projSpeed: 340,
    look: { sprite: 'skeleton_archer', scale: 2.4 }, blurb: 'shoots from range' },
  sapper: { name: 'Lava Slime', hp: 34, speed: 100, r: 12, dmg: 0, atkCd: 1, reach: 4, xp: 5, gold: 2,
    color: '#ff6a2a', cost: 2, weight: 3, minNight: 3, buildingHunter: true, sapper: { dmg: 160, r: 75 },
    look: { sprite: 'lava_slime', scale: 2.4 }, blurb: 'explodes against walls' },
  brute: { name: 'Armored Orc', hp: 210, speed: 46, r: 18, dmg: 26, atkCd: 1.5, reach: 8, xp: 15, gold: 6,
    color: '#6f8a4a', cost: 5, weight: 2, minNight: 4, buildingHunter: true, bldMul: 2.5,
    look: { sprite: 'armored_orc', scale: 3.1 }, blurb: 'smashes buildings' },
  shaman: { name: 'Necromancer', hp: 70, speed: 60, r: 12, dmg: 7, atkCd: 1.2, reach: 6, xp: 12, gold: 4,
    color: '#8a5cc4', cost: 4, weight: 1.5, minNight: 5, shaman: { cd: 4, heal: 0.25, r: 190 },
    look: { sprite: 'necromancer', scale: 2.5 }, blurb: 'heals and shields the horde' },
  siege: { name: 'Black Knight', hp: 120, speed: 45, r: 15, dmg: 14, atkCd: 1.2, reach: 8, xp: 16, gold: 6,
    color: '#55556a', cost: 5, weight: 1.5, minNight: 6, siege: { range: 370, cd: 3.2, dmg: 70, r: 45 },
    look: { sprite: 'black_knight', scale: 2.7 }, blurb: 'shells buildings beyond tower range' },
  // Bosses, one every BOSS_EVERY nights in BOSS_ORDER. The last one guards the final night.
  boss_warlord: { name: 'Minotaur Warlord', hp: 1500, speed: 66, r: 26, dmg: 32, atkCd: 1.6, reach: 12, xp: 150, gold: 50,
    color: '#c0703a', cost: 0, weight: 0, minNight: 99, boss: true, bldMul: 1.5,
    look: { sprite: 'minotaur', scale: 4.2 }, blurb: 'boss: charges through walls, calls wolves' },
  boss_lich: { name: 'Lich Sovereign', hp: 1700, speed: 52, r: 22, dmg: 20, atkCd: 1.6, reach: 8, xp: 220, gold: 70,
    color: '#9a7cff', cost: 0, weight: 0, minNight: 99, boss: true, ranged: true, range: 330, projSpeed: 300,
    shaman: { cd: 6, heal: 0.12, r: 240 },
    look: { sprite: 'necromancer', scale: 3.8 }, blurb: 'boss: raises the dead, frost novas' },
  boss: { name: 'Flame Golem', hp: 2600, speed: 54, r: 30, dmg: 40, atkCd: 2.0, reach: 12, xp: 300, gold: 100,
    color: '#ff7a2a', cost: 0, weight: 0, minNight: 99, boss: true, bldMul: 1.2,
    look: { sprite: 'flame_golem', scale: 4 }, blurb: 'final boss: slams, rains fire' },

  // Elite camp guardians (daytime treasure).
  guard_minotaur: { name: 'Minotaur', hp: 520, speed: 80, r: 18, dmg: 24, atkCd: 1.4, reach: 10, xp: 40, gold: 12,
    color: '#9a5a3a', cost: 0, weight: 0, minNight: 99, guard: true, look: { sprite: 'minotaur', scale: 3 } },
  guard_orc: { name: 'Elite Orc', hp: 300, speed: 95, r: 14, dmg: 16, atkCd: 1.0, reach: 8, xp: 25, gold: 8,
    color: '#5a8a3a', cost: 0, weight: 0, minNight: 99, guard: true, look: { sprite: 'elite_orc', scale: 2.7 } },
  guard_bear: { name: 'Werebear', hp: 420, speed: 90, r: 17, dmg: 20, atkCd: 1.2, reach: 10, xp: 32, gold: 10,
    color: '#7a5a3a', cost: 0, weight: 0, minNight: 99, guard: true, look: { sprite: 'werebear', scale: 2.9 } },
};

export const BOSS_ORDER: EnemyId[] = ['boss_warlord', 'boss_lich', 'boss'];

export const GUARD_TYPES: EnemyId[] = ['guard_minotaur', 'guard_orc', 'guard_bear'];

export const NODES: Record<NodeId, NodeDef> = {
  tree: { res: 'wood', amount: 60, r: 17 },
  rock: { res: 'stone', amount: 50, r: 16 },
  gold: { res: 'gold', amount: 36, r: 15 },
};

export const RES_ICONS: Record<ResKey, IconRef> = { wood: 202, stone: 208, gold: 130 };
/** Used in floating world text, where sheet icons can't be inlined. */
export const RES_EMOJI: Record<ResKey, string> = { wood: '🪵', stone: '🪨', gold: '🪙' };
