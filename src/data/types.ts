// Shapes of all game content. Adding a class, enemy or building starts by extending these unions.

export type ResKey = 'wood' | 'stone' | 'gold';
export type Cost = Partial<Record<ResKey, number>>;

/** Raven icon sheet index (see /tools/icons.html), or an emoji used as a placeholder. */
export type IconRef = number | string;

export type ClassId = 'warrior' | 'mage' | 'ranger' | 'cleric';
export type SpellId =
  | 'roll' | 'blink'
  | 'charge' | 'whirlwind' | 'battlecry'
  | 'fireball' | 'frostnova' | 'meteor'
  | 'volley' | 'snare' | 'rain'
  | 'stride' | 'holynova' | 'consecrate' | 'holyward';
export type BuildingId = 'wall' | 'gate' | 'arrowtower' | 'firetower' | 'frostspire' | 'stormtotem' | 'spikes' | 'torch' | 'shrine' | 'hearth';
export type BuildSlot = Exclude<BuildingId, 'hearth'>;
export type EnemyId =
  | 'zombie' | 'runner' | 'bat' | 'spitter' | 'sapper' | 'brute' | 'shaman' | 'siege' | 'boss' | 'boss_warlord' | 'boss_lich'
  | 'guard_minotaur' | 'guard_orc' | 'guard_bear';
export type NodeId = 'tree' | 'rock' | 'gold';

/** Which sprite sheet a character uses (keys from scripts/import-assets.mjs) and how big to draw it. */
export interface SpriteRef {
  sprite: string;
  scale: number;
  /** Vertical offset in world pixels so the feet line up with the collision circle. */
  offsetY?: number;
}

export interface BasicAttackDef {
  name: string;
  icon: IconRef;
  type: 'melee' | 'bolt' | 'arrow' | 'smite';
  dmg: number;
  cd: number;
  range?: number;
  arc?: number;
  speed?: number;
  desc: string;
}

export interface SpellDef {
  id: SpellId;
  name: string;
  icon: IconRef;
  cd: number;
  desc: string;
}

export interface ClassSpell extends SpellDef {
  /** Physical key (KeyboardEvent.code). */
  key: string;
}

/**
 * The class's held right-click ability. block: guard against frontal hits; beam: channel damage
 * along a line; aimed: draw a shot and release it; mend: channel healing on what's under the cursor.
 */
export type AltKind = 'block' | 'beam' | 'aimed' | 'mend';
export interface AltDef {
  kind: AltKind;
  name: string;
  icon: IconRef;
  /** Movement speed multiplier while held. */
  move: number;
  /** Shield Block: share of frontal damage stopped. */
  reduce?: number;
  desc: string;
}

export interface ClassDef {
  name: string;
  color: string;
  accent: string;
  hp: number;
  speed: number;
  regen: number;
  /** Share of damage the class shrugs off before talents (frontline classes). */
  armor?: number;
  /** Monsters that hunt buildings fight this class instead when it comes this close. */
  provoke?: number;
  tagline: string;
  desc: string;
  light: number;
  look: SpriteRef;
  basic: BasicAttackDef;
  mobility: SpellDef;
  spells: ClassSpell[];
  alt: AltDef;
}

export interface Stats {
  maxHp: number; regen: number; dmgMul: number; moveMul: number; cdr: number; crit: number;
  atkSpeed: number; buildCost: number; wallHp: number; towerDmg: number; towerSpeed: number;
  aoe: number; pierce: number; extraProj: number; lifesteal: number; armor: number; thorns: number;
  gather: number; freezeBonus: number; arcMul: number; rangeMul: number;
  /** Extra companion slots, and a multiplier on companion health and damage. */
  allyMax: number; allyPow: number;
  goldMul: number; towerHp: number; towerRange: number;
  /** Multiplier on healing the player's spells do. */
  healMul: number;
  flags: Set<string>;
  /** Rank learned in each flag talent, for flags that scale per rank. */
  ranks: Record<string, number>;
  /** The legendary being worn (one at a time) and its rank (0 when none). */
  legend?: string;
  legendRank: number;
}
export type StatKey = Exclude<keyof Stats, 'flags' | 'ranks' | 'legend' | 'legendRank'>;

export interface TalentDef {
  id: string;
  name: string;
  icon: IconRef;
  max: number;
  mods?: Partial<Record<StatKey, number>>;
  /** Behaviour switch read by spells and systems (e.g. 'split_fireball'). */
  flag?: string;
  desc: string;
}

/** A spot in a talent tree: one talent, or a choice between two (only one can be learned). */
export interface TalentNode {
  id: string;
  row: number;
  /** 0..4, left to right. */
  col: number;
  /** Nodes above that lead here; learning any one of them fully opens this node. */
  req: string[];
  options: TalentDef[];
}

export interface TalentTree {
  name: string;
  color: string;
  /** One line on what the tree is for. */
  role: string;
  nodes: TalentNode[];
}

// ----------------------------- Buildings -------------------------------------

export interface TowerDef {
  range: number;
  dmg: number;
  cd: number;
  /** arrow: single shot; lob: arcing splash; pulse: frost ring around the tower; chain: lightning that jumps. */
  kind: 'arrow' | 'lob' | 'pulse' | 'chain';
  splash?: number;
  pierce?: number;
  burn?: number;
  slow?: number;
  jumps?: number;
}
export interface TrapDef { dmg: number; cd: number; slow: number }
export interface AuraDef { r: number; heal: number; repair: number }

/** Stats that change when a building is upgraded. */
export interface TierStats {
  name: string;
  hp: number;
  light?: number;
  tower?: TowerDef;
  trap?: TrapDef;
  aura?: AuraDef;
}

export interface TierDef extends TierStats {
  cost: Cost;
  /** Hearth level needed for this upgrade. */
  hearth: number;
}

export interface BuildingDef {
  name: string;
  icon: IconRef;
  cost: Cost;
  hp: number;
  solid: boolean;
  desc: string;
  /** Hearth level needed to build it. */
  unlock: number;
  size?: number;
  wall?: boolean;
  gate?: boolean;
  light?: number;
  tower?: TowerDef;
  trap?: TrapDef;
  aura?: AuraDef;
  /** Upgrades after the base tier. */
  tiers?: TierDef[];
}

export interface HearthLevel {
  name: string;
  hp: number;
  light: number;
  cost: Cost;
  /** Damage per second to monsters next to the Hearth. */
  burn: number;
  desc: string;
}

// ----------------------------- Monsters --------------------------------------

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  r: number;
  dmg: number;
  atkCd: number;
  reach: number;
  xp: number;
  gold: number;
  color: string;
  /** Wave budget cost; 0 = never picked for waves. */
  cost: number;
  weight: number;
  minNight: number;
  look: SpriteRef;
  /** Short line for the scout report. */
  blurb?: string;
  ranged?: boolean;
  range?: number;
  projSpeed?: number;
  buildingHunter?: boolean;
  bldMul?: number;
  boss?: boolean;
  /** Flies over walls and traps, straight at its target. */
  flying?: boolean;
  /** Blows up on reaching a building. */
  sapper?: { dmg: number; r: number };
  /** Periodically heals and shields nearby monsters. */
  shaman?: { cd: number; heal: number; r: number };
  /** Bombards buildings from outside tower range. */
  siege?: { range: number; cd: number; dmg: number; r: number };
  /** Elite that guards a treasure camp; ignores the Hearth and the sun. */
  guard?: boolean;
}

export interface NodeDef { res: ResKey; amount: number; r: number }
