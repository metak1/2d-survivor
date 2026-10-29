import type { BuildingDef, BuildingId, BuildSlot, HearthLevel } from './types';

// `unlock` is the Hearth level needed to build; each tier upgrade needs its own Hearth level.
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  wall: { name: 'Wood Wall', icon: 204, cost: { wood: 10 }, hp: 220, solid: true, wall: true, unlock: 1,
    desc: 'Cheap barrier. Drag to place a line; walls join up automatically.',
    tiers: [
      { name: 'Stone Wall', cost: { wood: 4, stone: 14 }, hearth: 2, hp: 600 },
      { name: 'Iron Wall', cost: { stone: 20, gold: 8 }, hearth: 3, hp: 1200 },
    ] },
  gate: { name: 'Gate', icon: 23, cost: { wood: 20, stone: 5 }, hp: 350, solid: true, wall: true, gate: true, unlock: 1,
    desc: 'You can walk through it, monsters cannot.',
    tiers: [
      { name: 'Reinforced Gate', cost: { stone: 18 }, hearth: 2, hp: 800 },
      { name: 'Iron Gate', cost: { stone: 25, gold: 10 }, hearth: 3, hp: 1500 },
    ] },
  arrowtower: { name: 'Arrow Tower', icon: 33, cost: { wood: 35, stone: 15 }, hp: 300, solid: true, unlock: 1,
    tower: { kind: 'arrow', range: 290, dmg: 13, cd: 0.75 }, desc: 'Shoots the nearest monster.',
    tiers: [
      { name: 'Longbow Tower', cost: { wood: 40, stone: 30 }, hearth: 2, hp: 420,
        tower: { kind: 'arrow', range: 340, dmg: 18, cd: 0.65 } },
      { name: 'Ballista', cost: { wood: 60, stone: 50, gold: 30 }, hearth: 3, hp: 600,
        tower: { kind: 'arrow', range: 380, dmg: 40, cd: 1.1, pierce: 4 } },
    ] },
  firetower: { name: 'Fire Brazier', icon: 22, cost: { stone: 30, gold: 15 }, hp: 350, solid: true, light: 190, unlock: 2,
    tower: { kind: 'lob', range: 240, dmg: 24, cd: 1.7, splash: 70, burn: 6 }, desc: 'Lobs fireballs that burn groups.',
    tiers: [
      { name: 'Inferno Brazier', cost: { stone: 50, gold: 30 }, hearth: 3, hp: 500, light: 220,
        tower: { kind: 'lob', range: 260, dmg: 34, cd: 1.6, splash: 90, burn: 10 } },
      { name: 'Dragonfire', cost: { stone: 80, gold: 60 }, hearth: 4, hp: 700, light: 260,
        tower: { kind: 'lob', range: 280, dmg: 50, cd: 1.4, splash: 110, burn: 16 } },
    ] },
  frostspire: { name: 'Frost Spire', icon: 1013, cost: { stone: 40, gold: 25 }, hp: 380, solid: true, light: 120, unlock: 3,
    tower: { kind: 'pulse', range: 170, dmg: 8, cd: 2.2, slow: 0.5 }, desc: 'Pulses frost that slows every monster nearby.',
    tiers: [
      { name: 'Glacier Spire', cost: { stone: 60, gold: 45 }, hearth: 4, hp: 550, light: 150,
        tower: { kind: 'pulse', range: 210, dmg: 14, cd: 2, slow: 0.6 } },
    ] },
  stormtotem: { name: 'Storm Totem', icon: 1024, cost: { stone: 50, gold: 50 }, hp: 400, solid: true, light: 140, unlock: 4,
    tower: { kind: 'chain', range: 260, dmg: 30, cd: 1.6, jumps: 4 }, desc: 'Lightning that jumps between monsters.',
    tiers: [
      { name: 'Tempest Totem', cost: { stone: 80, gold: 90 }, hearth: 5, hp: 600, light: 170,
        tower: { kind: 'chain', range: 300, dmg: 45, cd: 1.3, jumps: 7 } },
    ] },
  spikes: { name: 'Spike Trap', icon: 1105, cost: { wood: 15, stone: 5 }, hp: 160, solid: false, unlock: 1,
    trap: { dmg: 10, cd: 0.5, slow: 0.5 }, desc: 'Damages and slows monsters walking over it. Bats fly over.',
    tiers: [
      { name: 'Barbed Spikes', cost: { wood: 15, stone: 15 }, hearth: 2, hp: 260, trap: { dmg: 16, cd: 0.5, slow: 0.6 } },
      { name: 'Razor Field', cost: { stone: 25, gold: 10 }, hearth: 3, hp: 400, trap: { dmg: 26, cd: 0.45, slow: 0.7 } },
    ] },
  torch: { name: 'Torch', icon: 80, cost: { wood: 5 }, hp: 60, solid: false, light: 230, unlock: 1,
    desc: 'Lights up the night.' },
  shrine: { name: 'Healing Shrine', icon: 1072, cost: { stone: 25, gold: 20 }, hp: 300, solid: true, light: 140, unlock: 2,
    aura: { r: 170, heal: 6, repair: 5 }, desc: 'Heals you and repairs nearby buildings.',
    tiers: [
      { name: 'Sanctuary', cost: { stone: 50, gold: 40 }, hearth: 4, hp: 500, light: 180, aura: { r: 230, heal: 10, repair: 10 } },
    ] },
  hearth: { name: 'Hearth', icon: 22, cost: {}, hp: 1500, solid: true, size: 2, light: 360, unlock: 99,
    desc: 'Protect it at all costs. Upgrade it to unlock new buildings.' },
};

export const HEARTH_LEVELS: HearthLevel[] = [
  { name: 'Campfire', hp: 1500, light: 360, burn: 0, cost: {}, desc: '' },
  { name: 'Stone Hearth', hp: 2100, light: 400, burn: 0, cost: { wood: 80, stone: 50 },
    desc: 'Unlocks Fire Brazier, Healing Shrine and tier II upgrades.' },
  { name: 'Great Hearth', hp: 2800, light: 440, burn: 10, cost: { wood: 140, stone: 110, gold: 40 },
    desc: 'Unlocks Frost Spire and tier III upgrades. Scorches monsters that touch it.' },
  { name: 'Beacon', hp: 3600, light: 480, burn: 20, cost: { wood: 200, stone: 180, gold: 100 },
    desc: 'Unlocks Storm Totem, Dragonfire, Glacier Spire and Sanctuary.' },
  { name: 'Eternal Flame', hp: 4500, light: 540, burn: 35, cost: { wood: 280, stone: 260, gold: 180 },
    desc: 'Unlocks Tempest Totem. The Hearth blazes against the dark.' },
];

export const BUILD_SLOTS: BuildSlot[] = ['wall', 'gate', 'arrowtower', 'firetower', 'frostspire', 'stormtotem', 'spikes', 'torch', 'shrine'];
export const BUILD_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

export const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
