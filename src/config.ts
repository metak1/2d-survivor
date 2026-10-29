// World and tuning constants shared by the simulation and the renderer.

export const TILE = 40;                 // world pixels per grid tile
export const ART_SCALE = 2;             // procedural art is drawn at half resolution and scaled up (pixel look)
export const MAP_W = 80;
export const MAP_H = 80;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export const STEP = 1 / 60;             // fixed simulation timestep (seconds)

export const FIRST_DAY_LEN = 150;       // extra prep time on day 1
export const DAY_LEN = 100;
export const NIGHT_BASE_LEN = 56;
export const DARKNESS_MAX = 0.84;

export const BUILD_RANGE = 520;         // max distance from the player to place a building

export const FRAME_SIZE = 100;          // Tiny RPG sprite sheets use 100x100 frames
export const MAX_PLAYERS = 4;           // co-op party size
export const FINAL_NIGHT = 15;          // surviving this night and slaying its boss wins the run
export const BOSS_EVERY = 5;            // a boss comes every this many nights
export const PARTY_SCALE = 0.6;         // nights get this much bigger per extra player
