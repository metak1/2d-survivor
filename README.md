# Nightfall Bastion

A 2D top-down survival game for the browser, solo or co-op for up to 4 players. Pick a class, gather resources by day, fortify your Hearth, and survive waves of monsters each night.

Built with [Phaser 3](https://phaser.io), TypeScript and Vite.

## Setup

```
npm install
npm run import-assets
npm run dev
```

Then open http://localhost:3000. Click a class to play solo.

`import-assets` copies the sprite sheets and icons the game uses out of the asset-pack zips into `public/assets/`. By default it looks in `~/Downloads`; to use another folder, set `ASSETS_DIR` (PowerShell: `$env:ASSETS_DIR="D:\packs"; npm run import-assets`). It needs:

- `Tiny RPG Character Asset Pack 01 v2.0 -Full 22 Characters.zip`
- `Tiny RPG Character Asset Pack 02 v1.01-Full 20 Characters.zip`
- `Free - Raven Fantasy Icons.zip`

The imported art is git-ignored because the packs aren't redistributable. Without it the game still runs, with placeholder blobs for characters.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload, plus the multiplayer server |
| `npm run build` | Typecheck, build the game into `dist/` and the server into `dist-server/` |
| `npm start` | Run the built game and online server (see [Hosting a server](#hosting-a-server)) |
| `npm run preview` | Serve the built `dist/` locally (solo only) |
| `npm run typecheck` | Typecheck only |
| `npm run import-assets` | (Re)import art from the asset packs |

## Playing online

Anyone who can open your server's address can play: click **Play online**, then either start a room or join one.

- **Public rooms** are listed for everyone on the server. **Private rooms** can only be joined with their 5-letter code or the invite link (**Copy invite link** in the room).
- Each room is one co-op run for up to 4 players. The host (👑) starts the run; people who arrive later can join it while it's going.
- If your connection drops, the game reconnects by itself and gives you back your character. Your place is kept for 60 seconds.
- Your own character moves, swings and casts the moment you press a key, even on a slow connection; the server quietly corrects it. Everything else is drawn about 90 ms behind the server and moves smoothly between updates. Your ping is shown above the minimap.

In co-op, wood, stone, gold and the Hearth are shared, and everyone gets the XP from every kill. Talents, companions and summons are your own. Towers use the best tower talents anyone in the party has. The Cleric's heals and shields (Holy Nova, Mend, Consecration, Holy Ward) and the War Banner work on other players too. Starting the night early is a vote: it begins once every connected player has pressed N (players who dropped don't block it). The run doesn't pause: Esc opens the menu while the game carries on. The run ends when the Hearth falls, or when everyone has left. After a win, the run goes on in endless mode for whoever stays.

For a quick game on your own network, `npm run dev` is enough: friends open the **Network** address it prints.

## Hosting a server

The server is one Node process that serves the game page and runs every room. It needs Node 20+ (or Docker) and one open port.

**With Docker** (build where `public/assets/` already has the imported art):

```
docker build -t nightfall-bastion .
docker run -d --name nightfall -p 3000:3000 -v nightfall-data:/app/data --restart unless-stopped nightfall-bastion
```

**Without Docker:**

```
npm ci
npm run import-assets      # or copy public/assets/ from a machine that has the packs
npm run build
npm start                  # or install deploy/nightfall-bastion.service for systemd
```

**HTTPS and a domain.** Players can connect to `http://your-server:3000` directly, but behind a domain with HTTPS it looks and works better (the game switches to secure WebSockets on its own). Put a reverse proxy in front and run the game with `HOST=127.0.0.1`:

- [deploy/Caddyfile](deploy/Caddyfile): Caddy gets the certificate automatically. Easiest.
- [deploy/nginx.conf](deploy/nginx.conf): nginx with certbot. The `Upgrade` headers are required for the game's WebSocket.

**Leaderboards** are saved in `data/leaderboard.json` in the folder the server runs from (the top 100 runs per party size). The Docker command above keeps them in the `nightfall-data` volume. Online runs are recorded by the server. Solo runs are played in the browser, which reports its own result, so solo scores could be faked by someone determined to.

**Settings** (environment variables):

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on; `127.0.0.1` when behind a proxy |
| `MAX_ROOMS` | `100` | Rooms open at once |
| `MAX_CLIENTS` | `400` | Connections at once |
| `LEADERBOARD_FILE` | `data/leaderboard.json` | Where the leaderboards are saved |
| `SIMULATE_LAG_MS` | `0` | Testing aid: delays every message this much each way, to feel how the game plays from far away |

`GET /health` returns the number of rooms, running games, players and connections as JSON, for uptime monitors. The server logs when rooms open, start a run and close.

Each running room costs some CPU (the full game runs on the server) and upload bandwidth per player: about 25 KB/s measured on the first nights, rising to an estimated 150 KB/s on late nights with a large horde.

The character and icon art comes from your purchased asset packs. Check their licenses before hosting the game publicly.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (ZQSD on AZERTY; keys follow physical position) |
| Left mouse | Basic attack (also chops trees / mines rocks) |
| Right mouse (hold) | Class ability: Shield Block (Warrior), Arcane Beam (Mage), Aimed Shot (Ranger, release to fire), Mend (Cleric). You move slower and can't basic-attack while holding it |
| Q / E / R | Class spells |
| Space | Dodge roll / Blink |
| F | Interact (merchant, travellers, treasure chests) |
| B, or 1–9 | Build menu; drag to paint walls, mouse wheel to switch, click a building to upgrade/repair/demolish |
| T | Talent trees (click to learn, right-click to refund during the day) |
| I | Bag: click an item to wear it, click a worn item to take it off, right-click to salvage for gold |
| N | Start the night early (bonus gold). In co-op this starts a vote: everyone connected must press N within 30s; press again to withdraw |
| Esc / P | Pause (online: menu only, the run keeps going) |

## How a run plays

- **Goal:** survive 15 nights. Night 15 is the final night: it doesn't end until its boss, the Flame Golem, is dead, and the dawn after it wins the run. You can then stop, or keep going in endless mode, where the nights keep getting harder and the bosses come round again.
- **Classes:** Warrior (melee frontline), Mage (fire and frost from range), Ranger (arrows, traps, building) and Cleric (heals companions, repairs and wards the base).

- **Day:** gather by holding attack on trees and rocks, build, and upgrade. Guarded treasure camps sit out in the wilds. Each dawn may bring an event: a merchant, a wounded traveller who joins you as a companion, a supply cart, or a Blood Moon omen.
- **Dusk:** scouts report the coming night: how many of each monster, and from which directions.
- **Night:** waves attack the Hearth. Hellbats fly over walls, Lava Slimes blow walls up, Necromancers heal and shield the horde, and Black Knights shell your buildings from beyond tower range. Every 5th night brings a boss: the Minotaur Warlord on night 5 (charges through walls, calls wolves), the Lich Sovereign on night 10 (raises the dead, frost novas, rings of shadow bolts) and the Flame Golem on night 15 (slams, rains fire on every player). Bosses fight faster below 40% health.
- **Party size:** each extra player makes the nightly horde and the bosses' health 60% bigger (2.8× for four players), and each kill gives a matching share less XP, so every party size levels at about the same pace.
- **Dungeons:** three cave entrances in the wilds, marked on the minimap: the Forgotten Crypt (opens day 5), the Orc Warren (day 10) and the Infernal Depths (day 15). Press F at the entrance to go in. Each holds packs of its monsters and, in the deepest chamber, a boss: the Death Knight, the Werebear Chieftain and the Magma King. Killing the boss reveals one legendary to everyone inside (see the forge below) and gives them Legendary Shards, more for harder dungeons and deeper visits. It also drops an epic and gold. A cleared dungeon reopens three days later, one level deeper and stronger. Dungeons are a daytime trip: they're sealed at night, and anyone still inside at nightfall is cast out at the entrance. Leave early through the portal by the door.
- **The Legendary Forge:** press F at the Hearth. Every boss (the night bosses and the dungeon bosses) reveals one legendary to the players who fought it, the one the fewest of them have, and drops Legendary Shards (💠, shown next to your resources; they're your own, not the party's). At the forge you spend shards to:
  - craft any legendary you've discovered (12 shards), so you can switch to whichever suits how you play;
  - empower a legendary from rank I to V (8, 12, 16 and 20 shards): each rank adds 20% of its own stats and strengthens its effect;
  - reroll any item's random stats, or raise its item level by one, up to the current day.

  Salvaging a legendary gives 6 shards back (an epic gives 1). Your collection lasts for the run. Once you've discovered all ten, bosses give 4 extra shards instead, which go into ranks and reforging.
- **Items:** monsters sometimes drop gear (tougher ones more often, bosses always), treasure chests spill 1–2 items, and the merchant sells three. Walk over loot to pick it up. There are five slots (weapon, helm, armor, boots, ring) and five rarities, from common to legendary. Each rarity rolls more and bigger stats, and items get stronger the later the day they drop on. The ten named legendaries each have a special effect, such as Stormcaller's chain lightning or Phoenix Plume's revive, and you can wear only one legendary at a time. Legendaries never drop: they are crafted at the forge. In co-op, loot belongs to whoever picks it up.
- **The end of a run** shows the party's damage, healing, damage taken, kills, deaths and best find, and where the run placed on the leaderboard.
- **Leaderboards:** one per party size (solo, 2, 3 and 4 players). A run's bracket is the most players it had at once. Runs rank by nights survived, then by whether they won, then by how far into their last night they got (shown as "+64%"), then by kills, then by time. Open them from the main menu, the online room browser or the end screen.
- **Heirlooms:** reaching night 5 with a class unlocks a magic starting weapon for it, night 10 a rare one, and winning an epic one. Progress is kept in your browser, and the class cards show what's next.
- **Progression:** upgrading the Hearth (I to V) unlocks new buildings and building tiers, and each level-up gives a talent point.
- **Talents:** each class has three trees of about 18 nodes. A node opens once a node linked above it is fully learned; rows 4 and 7 also need 5 and 12 points spent higher in the tree. Split nodes are choices between two talents, and each tree ends in a two-way capstone. One choice per class sets solo or party play: *Lone Wolf* (bonuses while alone) or a *Warband*-style option (an extra companion slot and stronger companions). Talent summons (Templar squire, arcane familiar, Hellhound) return at dawn if slain. Right-click a talent to refund it during the day.

## Architecture

```
src/
  data/     Content definitions: classes, talents, buildings, enemies (typed, no logic)
  sim/      Game logic. No Phaser or DOM imports, so it runs headless.
  render/   Phaser scenes and views that draw the sim state
  ui/       DOM HUD, menus, lobby and talent screen
  net/      Multiplayer: wire protocol, snapshots, the browser's connection
  core/     Input, events, math helpers
  app.ts    Which screen is showing, starting games, which player is ours
  profile.ts  Progress kept in the browser between runs (heirloom unlocks)
server/
  server.ts   Connections, sessions and reconnects, rate limits, the room list
  room.ts     One room: its lobby, the Game it runs, snapshots to its players
  leaderboard.ts  Leaderboards: storage, ranking, and the /api/leaderboard endpoint
  main.ts     Production entry: serves dist/, /health, /api, and the game server on one port
deploy/       Reverse proxy (Caddy, nginx) and systemd examples for self-hosting
scripts/import-assets.mjs   Asset pack importer
public/tools/icons.html     Icon browser (find icon indices)
```

How the parts connect:

- **The simulation runs on a fixed timestep** (60 steps/s, `sim/game.ts`). Each step it reads every player's `Intent` (movement, aim, attack, spells cast), which `render/GameScene.ts` builds from keyboard and mouse input. Other actions (build, upgrade, learn a talent, buy) are `Command`s (`sim/commands.ts`).
- **Solo runs the simulation in the browser; online, the server runs it.** Each room (`server/room.ts`) steps its own `Game` from its players' inputs and commands, and sends each browser a snapshot 30 times a second (`net/snapshot.ts`). Inputs and commands from the network are validated first (`parseCommand`, `cleanIntent`). Each browser applies them to a local copy of the game that it never steps, so the renderer and UI work the same way in both modes. Buildings and resource nodes are only resent when they change; terrain comes from a shared seed.
- **Your own character is predicted** (`net/predict.ts`): the browser moves it at once, numbers each input, and when a snapshot says which input the server has applied, replays the moves after it. Everything else is drawn slightly in the past, interpolated between the two snapshots around that moment (`net/interp.ts`), so it moves at a steady speed however unevenly snapshots arrive. Bump `PROTOCOL` in `net/protocol.ts` whenever the messages change, so old tabs are asked to refresh.
- **The simulation never draws.** It reports what happened through typed events (`sim/events.ts`): particles, damage text, attacks, deaths, banners. The renderer and UI subscribe to these.
- **Views mirror state by entity id.** Every frame, `GameScene` syncs a Phaser object for each player, monster, building, node and projectile.
- **Rules live in data.** Stats, costs and talent effects are defined in `src/data`.
- **Everything a player causes knows its player.** Damage takes the attacker (`dealPlayerDamage(g, p, ...)`), and zones and projectiles store their owner's id, so each player's talents apply to their own spells. New spell code should follow the same pattern.

## Adding content

**A new class**
1. Add its sprite to `SPRITES` in `scripts/import-assets.mjs` and re-run `npm run import-assets`.
2. Add the id to `ClassId`, and any new spell ids to `SpellId`, in `src/data/types.ts`.
3. Define the class in `src/data/classes.ts` and its talent trees in `src/data/talents.ts`.
4. Implement new spells in `src/sim/spells.ts`.

**A new monster:** import its sprite, add the id to `EnemyId`, and define it in `src/data/enemies.ts`. `minNight` and `weight` control when and how often it appears in waves. Behaviour flags (`flying`, `sapper`, `shaman`, `siege`, `guard`) are implemented in `src/sim/enemy.ts`.

**A boss:** define it in `src/data/enemies.ts` with `boss: true` and add it to `BOSS_ORDER`, which sets which boss comes on each 5th night. Its abilities go in `bossLogic` in `src/sim/enemy.ts`. The final night and party scaling are set by `FINAL_NIGHT`, `BOSS_EVERY` and `PARTY_SCALE` in `src/config.ts`.

**A new building or upgrade tier:** add it to `src/data/buildings.ts`. `unlock` is the Hearth level needed to build it, and each entry in `tiers` is one upgrade with its own cost and Hearth requirement. Its art is drawn in `src/render/textures.ts`.

**A talent:** add a node to a tree in `src/data/talents.ts` with its `row`, `col` (0–4) and the node ids in `req` that lead to it. `stat(...)` talents only change numbers; `fx(...)` talents set a `flag`. Check `p.stats.flags.has('your_flag')` (and `p.stats.ranks.your_flag` for per-rank effects) where the spell or system runs, usually `src/sim/spells.ts`. `pick(...)` makes a choice node from two talents. Talent rules (gates, prerequisites, refunds) are in `src/sim/stats.ts`.

**An item stat or legendary:** stats that can roll on items are `AFFIXES` in `src/data/items.ts` (any `StatKey`, with the slots it can appear on). Legendaries are `LEGENDARIES`: fixed stats, an optional `flag` (which works like a talent flag) and a `desc(rank)`. To make its effect grow with rank, read `legendBonus(stats, id)` where the effect runs. Forge costs and shard rewards are `FORGE`; the forge itself is `src/sim/forge.ts`. Drop rates, rarity odds and the merchant's stock are in `src/sim/items.ts`.

**A dungeon:** themes are in `src/data/dungeons.ts` (opening day, monster pool, boss, colours). Layouts, entering and leaving, and rewards are in `src/sim/dungeons.ts`. Interiors are carved into a strip of solid rock below the map (`DUNGEON_GAP` and `DUNGEON_ROWS` in `src/config.ts`), one slot per dungeon, from the world seed, so online clients build the same rooms.

**Day events and the shop:** odds, NPCs and merchant stock are in `src/data/events.ts`; behaviour is in `src/sim/daylife.ts`.

**Icons:** run the dev server and open http://localhost:3000/tools/icons.html. Click an icon to copy its index, and use it as `icon: 123` in the data files. Emoji strings still work as placeholders; the talents use them for now.

**Art for the environment:** ground, trees, rocks and buildings are drawn procedurally in `src/render/textures.ts`. To use real art, load an image with the same texture key (e.g. `b_wall`, `tree0`) in `BootScene`.

`legacy/` holds the original single-file canvas version for reference.
