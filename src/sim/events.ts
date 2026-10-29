// Everything the simulation tells the outside world. The renderer and UI subscribe to these;
// the simulation never calls into Phaser or the DOM directly.

export type Vfx =
  | { kind: 'ring'; x: number; y: number; r: number; color: string; life: number }
  | { kind: 'blast'; x: number; y: number; r: number; color: string }
  | { kind: 'swing'; x: number; y: number; angle: number; range: number; arc: number }
  | { kind: 'scorch'; x: number; y: number; r: number }
  | { kind: 'chain'; points: { x: number; y: number }[]; color: string };

/** What the scouts saw coming for the next night. */
export interface ScoutReport {
  night: number;
  /** The night that decides the run. */
  final: boolean;
  directions: string;
  bloodMoon: boolean;
  groups: { name: string; count: number; blurb: string }[];
}

export interface GameEvents {
  particles: { x: number; y: number; n: number; color: string; speed: number; life: number; size: number };
  text: { x: number; y: number; text: string; color: string; size: number; life?: number };
  /** `to`: only this player's screen. */
  shake: { n: number; to?: number };
  toast: { msg: string; to?: number };
  banner: { title: string; sub: string; danger?: boolean };
  vfx: Vfx;
  /** An actor started an attack or cast (renderer plays the attack animation). */
  anim: { id: number; anim: 'attack' | 'attack2' };
  /** An enemy or the player died (renderer plays the death animation). */
  died: { id: number };
  levelUp: { level: number; to: number };
  /** Dusk: the coming night's composition is known. */
  scout: ScoutReport;
  /** A player asked the merchant to trade. */
  shop: { to: number };
  /** A player opened the Legendary Forge at the Hearth. */
  forge: { to: number };
  /** Buildings or resource nodes changed (minimap, static layers). */
  worldChanged: undefined;
  gameOver: undefined;
  /** The final night was survived: the run is won (it can go on, endless). */
  victory: undefined;
}
