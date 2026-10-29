// Copies the sprite sheets and icons the game uses out of the purchased asset-pack zips
// into public/assets/, and writes public/assets/sprites/manifest.json with frame counts.
//
//   npm run import-assets                  (looks in ~/Downloads)
//   ASSETS_DIR="D:/packs" npm run import-assets
//
// To use a new character, add an entry to SPRITES below and re-run.

import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.ASSETS_DIR || path.join(os.homedir(), 'Downloads');
const OUT = path.join(ROOT, 'public', 'assets');

const PACKS = {
  tiny1: /^Tiny RPG Character Asset Pack 01.*Full.*\.zip$/i,
  tiny2: /^Tiny RPG Character Asset Pack 02.*Full.*\.zip$/i,
  raven: /^Free - Raven Fantasy Icons\.zip$/i,
};

// key: id used by the game. folder: character folder inside "Characters(100x100 split)".
// anims: game animation name -> file suffix in the pack (e.g. Knight_Attack01.png).
const SPRITES = [
  { key: 'knight', pack: 'tiny1', folder: 'Knight', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Attack02', block: 'Block', hurt: 'Hurt', death: 'Death' } },
  { key: 'wizard', pack: 'tiny1', folder: 'Wizard', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Attack02', hurt: 'Hurt', death: 'Death' } },
  { key: 'archer', pack: 'tiny1', folder: 'Archer', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Attack02', hurt: 'Hurt', death: 'Death' } },
  { key: 'skeleton', pack: 'tiny1', folder: 'Skeleton', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'werewolf', pack: 'tiny1', folder: 'Werewolf', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'skeleton_archer', pack: 'tiny1', folder: 'Skeleton Archer', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack', hurt: 'Hurt', death: 'Death' } },
  { key: 'armored_orc', pack: 'tiny1', folder: 'Armored Orc', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'flame_golem', pack: 'tiny2', folder: 'Flame Golem', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Attack02', hurt: 'Hurt', death: 'Death' } },
  // Night monsters that pressure defenses
  { key: 'lava_slime', pack: 'tiny2', folder: 'Lava Slime', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'hellbat', pack: 'tiny2', folder: 'Hellbat', anims: { idle: 'Flying', walk: 'Flying', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'necromancer', pack: 'tiny1', folder: 'Necromancer', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Summon', hurt: 'Hurt', death: 'Death' } },
  { key: 'black_knight', pack: 'tiny2', folder: 'Black Knight_B', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack03', hurt: 'Hurt', death: 'Death' } },
  // Elite camp guards
  { key: 'minotaur', pack: 'tiny2', folder: 'Minotaur', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', attack2: 'Attack02', hurt: 'Hurt', death: 'Death' } },
  { key: 'elite_orc', pack: 'tiny1', folder: 'Elite Orc', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'werebear', pack: 'tiny1', folder: 'Werebear', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  // Friendly NPCs
  { key: 'soldier', pack: 'tiny1', folder: 'Soldier', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'priest', pack: 'tiny1', folder: 'Priest', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack(With magic effects)', attack2: 'Heal(With magic effects)', hurt: 'Hurt', death: 'Death' } },
  { key: 'swordsman', pack: 'tiny1', folder: 'Swordsman', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  // Talent summons
  { key: 'templar', pack: 'tiny1', folder: 'Knight Templar', anims: { idle: 'Idle', walk: 'Walk01', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'ghostfire', pack: 'tiny2', folder: 'Ghostfire', anims: { idle: 'Flying', walk: 'Flying', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
  { key: 'hellhound', pack: 'tiny2', folder: 'Hellhound', anims: { idle: 'Idle', walk: 'Walk', attack: 'Attack01', hurt: 'Hurt', death: 'Death' } },
];

// Single images: output path (relative to public/assets) -> [pack, path suffix inside the zip].
const FILES = {
  'sprites/projectiles/arrow.png': ['tiny1', 'Arrow(Projectile)/Arrow01(32x32).png'],
  'sprites/projectiles/cannonball.png': ['tiny2', 'Projectile/Cannonball_Black Knight_B_Attack03(32x32).png'],
  'icons/raven32.png': ['raven', 'Full Spritesheet/32x32.png'],
};

const FRAME = 100;

function openPacks() {
  if (!fs.existsSync(SRC)) throw new Error(`Asset folder not found: ${SRC} (set ASSETS_DIR)`);
  const names = fs.readdirSync(SRC);
  const zips = {};
  for (const [id, re] of Object.entries(PACKS)) {
    const name = names.find(n => re.test(n));
    if (!name) throw new Error(`Missing pack in ${SRC}: ${re}`);
    zips[id] = new AdmZip(path.join(SRC, name));
  }
  return zips;
}

function findEntry(zip, suffix) {
  const s = suffix.replace(/\\/g, '/').toLowerCase();
  return zip.getEntries().find(e => !e.isDirectory && e.entryName.toLowerCase().endsWith(s));
}

function pngSize(buf) {
  if (buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('Not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function write(rel, buf) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

const zips = openPacks();
const manifest = { frameSize: FRAME, sprites: {} };

for (const sp of SPRITES) {
  const entry = { anims: {} };
  for (const [anim, suffix] of Object.entries(sp.anims)) {
    // Prefer the "with shadows" variant; it grounds the characters on the map.
    const base = `${sp.folder}/${sp.folder} with shadows/${sp.folder}_${suffix}.png`;
    const e = findEntry(zips[sp.pack], base) || findEntry(zips[sp.pack], `${sp.folder}/${sp.folder}/${sp.folder}_${suffix}.png`);
    if (!e) throw new Error(`Missing ${sp.folder}_${suffix}.png in ${sp.pack}`);
    const buf = e.getData();
    const { w, h } = pngSize(buf);
    if (h !== FRAME || w % FRAME) throw new Error(`${e.entryName}: unexpected size ${w}x${h}`);
    write(`sprites/${sp.key}/${anim}.png`, buf);
    entry.anims[anim] = { file: `sprites/${sp.key}/${anim}.png`, frames: w / FRAME };
  }
  manifest.sprites[sp.key] = entry;
  console.log(`  ${sp.key.padEnd(16)} ${Object.entries(entry.anims).map(([a, v]) => `${a}:${v.frames}`).join(' ')}`);
}

for (const [rel, [pack, suffix]] of Object.entries(FILES)) {
  const e = findEntry(zips[pack], suffix);
  if (!e) throw new Error(`Missing ${suffix} in ${pack}`);
  write(rel, e.getData());
  console.log(`  ${rel}`);
}

write('sprites/manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
console.log(`Imported ${SPRITES.length} characters into ${path.relative(ROOT, OUT)}`);
