// DOM UI: class select, co-op lobby, HUD and party list, spell bar, build bar and building menu,
// scout report, shop, talents, pause and game over. Reads game state every frame (always for our
// own player, see app.me) and listens to sim events. Actions go out through app.command.

import { CLASSES, CLASS_IDS } from '../data/classes';
import { BUILDINGS, BUILD_KEYS, BUILD_SLOTS, HEARTH_LEVELS, ROMAN } from '../data/buildings';
import { RES_ICONS } from '../data/enemies';
import { SHOP } from '../data/events';
import type { AltDef, BasicAttackDef, BuildSlot, ClassId, Cost, ResKey, SpellDef } from '../data/types';
import { Input } from '../core/input';
import { App, continueRun, saveRun, closeForge, closeInventory, closeShop, closeTalents, command, me, openInventory, openTalents, resume, setBuildMode, startGame, toMenu } from '../app';
import { InventoryScreen, itemTipHtml } from './inventory';
import { RARITIES } from '../data/items';
import { itemIcon, itemName, itemPrice } from '../sim/items';
import { NetClient } from '../net/client';
import { TILE } from '../config';
import type { Game } from '../sim/game';
import type { ScoutReport } from '../sim/events';
import { nearestInteractable } from '../sim/daylife';
import type { Building } from '../sim/world';
import { iconHtml } from './icons';
import { Minimap } from './minimap';
import { TalentScreen } from './talents';
import { ForgeScreen } from './forge';
import { BoardScreen, heirloomHtml, rankHtml, resultsHtml, runResult } from './results';
import { heirloomFor, loadBest, mergeGuestProgress, nextHeirloom, recordRun, saveBest } from '../profile';
import { account, onAccount, pushSettings, restoreSession, signedIn } from '../net/account';
import { AuthScreen } from './auth';
import { submitSolo } from '../net/scores';
import { continueList, deleteSolo, describeSave, moveGuestSaves } from './saves';
import type { Rarity } from '../data/items';
import { FINAL_NIGHT } from '../config';
import { nightProgress } from '../sim/cycle';

const $ = (id: string) => document.getElementById(id)!;
/** Solo autosave interval. */
const AUTOSAVE_MS = 15_000;

type Cached = HTMLElement & { _v?: string; _h?: string; _s?: Record<string, string> };
const setText = (el: HTMLElement, v: string) => { const c = el as Cached; if (c._v !== v) { c._v = v; el.textContent = v; } };
const setHtml = (el: HTMLElement, v: string) => { const c = el as Cached; if (c._h !== v) { c._h = v; el.innerHTML = v; } };
const setStyle = (el: HTMLElement, k: 'width' | 'height' | 'left' | 'top', v: string) => {
  const c = el as Cached;
  c._s ??= {};
  if (c._s[k] !== v) { c._s[k] = v; el.style[k] = v; }
};

const costHtml = (cost: Cost, g?: Game) =>
  (Object.keys(cost) as ResKey[]).map(k => {
    const short = g && g.res[k] < cost[k]! ? ' class="short"' : '';
    return `<span${short}>${cost[k]}${iconHtml(RES_ICONS[k], 14)}</span>`;
  }).join('');

type SlotKind = 'basic' | 'alt' | 'spell';
interface SpellSlot { el: HTMLElement; sp: SpellDef | BasicAttackDef | AltDef; kind: SlotKind; cd: HTMLElement; cdt: HTMLElement }
interface BuildSlotEl { el: HTMLElement; id: BuildSlot; cost: HTMLElement; lock: HTMLElement }

class UIController {
  private frame = 0;
  private slots: SpellSlot[] = [];
  private bslots: BuildSlotEl[] = [];
  private minimap!: Minimap;
  private bannerTimer = 0;
  private game: Game | null = null;
  private scout: ScoutReport | null = null;
  private talents = new TalentScreen();
  private inventory = new InventoryScreen();
  private inventoryKey = '';
  /** Bag size when the bag screen was last looked at, for the "new items" badge. */
  private seenBag = 0;
  /** What the talent screen and shop last showed, to redraw them when a snapshot changes it. */
  private talentKey = '';
  private shopKey = '';
  private forge = new ForgeScreen();
  private forgeKey = '';
  private savedAt = 0;
  private board = new BoardScreen();
  /** This run on the leaderboard: our solo submission, and the rank it got (solo or from the server). */
  private rank: { size: number; rank: number | null; id: string } | null = null;
  private rankPending = false;
  /** Heirloom this run unlocked, and whether the player chose to end a won run. */
  private unlocked: Rarity | null = null;
  private endedByChoice = false;

  readonly auth = new AuthScreen();

  init(): void {
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement);
    this.auth.init();
    // Signing in brings this browser's guest progress and saves along, and redraws the menu.
    let was = signedIn();
    onAccount(() => {
      const now = signedIn();
      if (now && !was) { mergeGuestProgress(); void moveGuestSaves().then(() => { if (App.mode === 'menu') this.renderSoloSaves(); }); }
      was = now;
      if (App.mode === 'menu') this.buildMenu();
    });
    void restoreSession();
    this.talents.init();
    this.inventory.init();
    $('btn-open-inventory').onclick = () => openInventory();
    $('btn-inventory-close').onclick = () => closeInventory();
    this.forge.init();
    $('btn-forge-close').onclick = () => closeForge();
    $('btn-resume').onclick = () => resume();
    $('btn-restart').onclick = () => startGame(App.cls);
    $('btn-menu').onclick = () => toMenu();
    $('btn-again').onclick = () => (App.net ? toMenu() : startGame(App.cls));
    $('btn-over-menu').onclick = () => toMenu();
    $('btn-endless').onclick = () => this.keepGoing();
    $('btn-victory-end').onclick = () => this.endWonRun();
    this.board.init();
    $('btn-over-board').onclick = () => void this.board.show(this.game ? Math.max(1, this.game.peakParty) : 1, this.rank?.id ?? null);
    $('btn-board-menu').onclick = () => void this.board.show(1);
    $('btn-board-hub').onclick = () => void this.board.show(2);
    $('btn-talents-close').onclick = () => closeTalents();
    $('btn-shop-close').onclick = () => closeShop();
    $('btn-open-talents').onclick = () => openTalents();
    $('talent-alert').onclick = () => openTalents();
    $('btn-hearth-up').onclick = () => { const g = this.game; if (g) command({ c: 'upgrade', id: g.world.hearth.id }); };
    this.initOnline();
    addEventListener('beforeunload', () => { if (App.game && !App.net) saveRun(); });
    // mousedown rather than click: the menu re-renders as HP changes, which would eat a click.
    $('ctx').addEventListener('mousedown', e => { e.stopPropagation(); this.onContextClick(e); });
    for (const k of ['wood', 'stone', 'gold'] as ResKey[]) $(`res-ico-${k}`).innerHTML = iconHtml(RES_ICONS[k], 22);
    Input.onLayout(() => this.refreshKeyLabels());
  }

  // ----------------------------- Screens ----------------------------------

  hideScreens(): void {
    for (const id of ['menu', 'hub', 'lobby', 'pause', 'talents', 'inventory', 'shop', 'forge', 'gameover', 'board', 'loading']) $(id).classList.add('hidden');
    this.talents.hideTip();
    this.inventory.hideTip();
  }

  showMenu(): void {
    this.hideScreens();
    $('hud').classList.add('hidden');
    this.buildMenu();
    $('menu').classList.remove('hidden');
    // Opened from an invite link: go straight to that room.
    if (this.inviteCode && !App.net) void this.goOnline();
  }

  showPause(): void {
    $('controls-pause').innerHTML = this.controlsHtml();
    // Online the run doesn't stop for one player's menu.
    setText($('pause-title'), App.net ? 'Menu' : 'Paused');
    setText($('pause-note'), App.net ? 'The run keeps going while this is open.' : '');
    $('btn-restart').classList.toggle('hidden', !!App.net);
    setText($('btn-menu'), App.net ? 'Leave run' : 'Save & quit');
    setText($('pause-note'), App.net ? 'The run keeps going while this is open. It\'s saved on the server: leave and come back to it later from the room.'
      : 'Your run is saved automatically. Pick it up from the main menu.');
    $('pause').classList.remove('hidden');
  }

  showTalents(): void {
    this.talents.render(this.game!);
    this.talentKey = this.talentState();
    $('talents').classList.remove('hidden');
  }

  showInventory(): void {
    this.inventory.render(this.game!);
    this.inventoryKey = this.inventory.state();
    this.seenBag = me().bag.length;
    $('inventory').classList.remove('hidden');
  }

  showForge(): void {
    this.forge.render(this.game!);
    this.forgeKey = this.forge.state(this.game!);
    $('forge').classList.remove('hidden');
  }

  showShop(): void {
    this.renderShop();
    $('shop').classList.remove('hidden');
  }

  private buildMenu(): void {
    const wrap = $('class-cards');
    wrap.innerHTML = '';
    for (const id of CLASS_IDS) {
      const c = CLASSES[id];
      const card = document.createElement('button');
      card.className = 'class-card';
      card.style.setProperty('--cc', c.color);
      const spells = [{ ...c.basic, key: 'LMB' }, { ...c.alt, key: 'RMB' }, { ...c.mobility, key: 'Space' }, ...c.spells];
      card.innerHTML = `
        <div class="cc-portrait">${this.portraitHtml(id)}</div>
        <h3>${c.name}</h3>
        <div class="cc-tag">${c.tagline}</div>
        <p>${c.desc}</p>
        <div class="cc-stats"><span>❤ ${c.hp}</span><span>👟 ${c.speed}</span></div>
        ${this.heirloomLine(id)}
        <ul class="cc-spells">
          ${spells.map(s => `<li title="${s.desc}">${iconHtml(s.icon, 22)}<b>${s.name}</b><kbd data-code="${s.key}">${Input.label(s.key)}</kbd></li>`).join('')}
        </ul>`;
      card.onclick = () => startGame(id);
      wrap.appendChild(card);
    }
    const best = loadBest();
    $('best').textContent = best.nights
      ? `Best: survived ${best.nights} night${best.nights === 1 ? '' : 's'} as ${best.cls} (${best.kills} kills)` : '';
    $('controls-menu').innerHTML = this.controlsHtml();
    $('assets-warning').classList.toggle('hidden', App.missingSprites.length === 0);
    this.auth.renderBar();
    this.renderName();
    this.renderSoloSaves();
  }

  /** The name field: the account's display name when signed in, this browser's otherwise. */
  private renderName(): void {
    const input = $('player-name') as HTMLInputElement, a = account();
    if (document.activeElement !== input) input.value = a ? a.settings.name : App.name;
  }

  /** "Continue": solo runs saved in this browser and on the account (the newer copy of each). */
  private renderSoloSaves(): void {
    const wrap = $('saves'), ask = ++this.savesAsk;
    void continueList().then(list => {
      if (ask !== this.savesAsk) return;
      this.showSoloSaves(wrap, list);
    });
  }

  private savesAsk = 0;

  private showSoloSaves(wrap: HTMLElement, list: Awaited<ReturnType<typeof continueList>>): void {
    wrap.classList.toggle('hidden', !list.length);
    wrap.innerHTML = list.length ? `<h3>Continue a run${signedIn() ? '' : ' <span class="muted">(saved in this browser: sign in to keep runs on any device)</span>'}</h3>` : '';
    for (const s of list) {
      const p = s.meta.players[0], c = CLASSES[p.cls], row = document.createElement('div');
      row.className = 'save-row';
      row.style.setProperty('--cc', c.color);
      row.innerHTML = `<div><b>${escapeHtml(p.name)}</b> <span style="color:${c.color}">${c.name}</span> <span class="muted">Lv ${p.level}</span>
        <span class="save-when">${describeSave(s.meta)}</span></div>`;
      const go = document.createElement('button'), del = document.createElement('button');
      go.className = 'primary'; go.textContent = 'Continue'; go.onclick = () => void continueRun(s);
      del.className = 'del'; del.textContent = '✕'; del.title = 'Delete this save';
      del.onclick = () => { if (confirm('Delete this saved run? It can\'t be undone.')) void deleteSolo(s.id).then(() => this.renderSoloSaves()); };
      row.append(go, del);
      wrap.appendChild(row);
    }
  }

  /** What starting weapon a class has unlocked, and what unlocks the next one. */
  private heirloomLine(cls: ClassId): string {
    const has = heirloomFor(cls), next = nextHeirloom(cls);
    const now = has ? `Starts with a <b style="color:${RARITIES[has].color}">${RARITIES[has].name}</b> weapon` : 'No heirloom yet';
    const then = next ? ` · <span title="Unlocks a ${RARITIES[next.rarity].name} starting weapon">Next: ${next.need}</span>` : '';
    return `<div class="cc-heir">🗡 ${now}${then}</div>`;
  }

  /** Animated idle sprite, done in CSS by stepping through the sheet's frames. */
  private portraitHtml(cls: ClassId): string {
    const sprite = CLASSES[cls].look.sprite, frames = App.spriteFrames[sprite]?.idle;
    if (!frames) return `<div class="cc-blob" style="background:${CLASSES[cls].color}"></div>`;
    const url = `${import.meta.env.BASE_URL}assets/sprites/${sprite}/idle.png`;
    return `<div class="cc-sprite" style="--n:${frames};background-image:url('${url}')"></div>`;
  }

  private controlsHtml(): string {
    const k = (c: string) => `<kbd>${Input.label(c)}</kbd>`;
    return `
      <div>${k('KeyW')}${k('KeyA')}${k('KeyS')}${k('KeyD')} Move</div>
      <div><kbd>LMB</kbd> Attack / harvest</div>
      <div><kbd>RMB</kbd> Class ability (hold)</div>
      <div>${k('KeyQ')}${k('KeyE')}${k('KeyR')} Spells</div>
      <div><kbd>Space</kbd> Dodge</div>
      <div>${k('KeyF')} Interact</div>
      <div>${k('KeyB')} Build · <kbd>1</kbd>–<kbd>9</kbd> pick · click a building to upgrade</div>
      <div>${k('KeyT')} Talents · ${k('KeyI')} Bag</div>
      <div>${k('KeyN')} Call the night early</div>
      <div><kbd>Esc</kbd> Pause</div>`;
  }

  private refreshKeyLabels(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-code]')) el.textContent = Input.label(el.dataset.code!);
    $('controls-menu').innerHTML = this.controlsHtml();
  }

  // ----------------------------- Game start -------------------------------

  startGame(g: Game): void {
    this.game = g;
    this.scout = null;
    this.rank = null;
    this.rankPending = false;
    this.unlocked = null;
    this.endedByChoice = false;
    this.hideScreens();
    $('hud').classList.remove('hidden');
    $('toasts').innerHTML = '';
    $('banner').classList.add('hidden');
    const c = CLASSES[me().cls];
    setText($('hud-class'), c.name);
    $('hud-player').style.setProperty('--cc', c.color);
    this.buildSpellbar(g);
    this.buildBuildbar();
    this.minimap.dirty = true;

    const mine = (to?: number) => to === undefined || to === App.me;
    g.events.on('toast', m => { if (mine(m.to)) this.toast(m.msg); });
    g.events.on('banner', b => this.banner(b.title, b.sub, b.danger));
    g.events.on('levelUp', e => {
      if (!mine(e.to)) return;
      this.toast(e.point ? `Level ${e.level}! Talent point available — press ${Input.label('KeyT')}` : `Level ${e.level}!`);
    });
    g.events.on('worldChanged', () => { this.minimap.dirty = true; });
    g.events.on('scout', r => { this.scout = r; this.renderScout(); });
    g.events.on('gameOver', () => { App.mode = 'over'; this.gameOver(g); });
    g.events.on('victory', () => this.victory(g));
    if (g.day === 1 && g.phase === 'day') this.banner('Day 1', 'Gather wood and stone, then fortify the Hearth before nightfall.');
    else this.banner(`${g.phase === 'night' ? 'Night' : 'Day'} ${g.day}`, 'You joined the defense of the Hearth.');
  }

  private buildSpellbar(_g: Game): void {
    const c = CLASSES[me().cls], bar = $('spellbar');
    bar.innerHTML = '';
    this.slots = [];
    const all: { sp: SpellDef | BasicAttackDef | AltDef; key: string; kind: SlotKind }[] = [
      { sp: c.basic, key: 'LMB', kind: 'basic' },
      { sp: c.alt, key: 'RMB', kind: 'alt' },
      { sp: c.mobility, key: 'Space', kind: 'spell' },
      ...c.spells.map(s => ({ sp: s, key: s.key, kind: 'spell' as const })),
    ];
    for (const { sp, key, kind } of all) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `${iconHtml(sp.icon, 40)}<div class="cd"></div><div class="cdt"></div>
        <kbd data-code="${key}">${Input.label(key)}</kbd>
        <div class="tip"><b>${sp.name}</b>${kind === 'spell' ? ` <i>${(sp as SpellDef).cd}s</i>` : kind === 'alt' ? ' <i>hold</i>' : ''}<br>${sp.desc}</div>`;
      bar.appendChild(el);
      this.slots.push({ el, sp, kind, cd: el.querySelector('.cd')!, cdt: el.querySelector('.cdt')! });
    }
  }

  private buildBuildbar(): void {
    const bar = $('buildbar');
    bar.innerHTML = '';
    this.bslots = [];
    BUILD_SLOTS.forEach((id, i) => {
      const def = BUILDINGS[id];
      const tiers = def.tiers?.length ? `<br><i class="tiers">Upgrades: ${def.tiers.map(t => t.name).join(' → ')}</i>` : '';
      const el = document.createElement('button');
      el.className = 'bslot';
      el.innerHTML = `<kbd>${BUILD_KEYS[i].replace('Digit', '')}</kbd>${iconHtml(def.icon, 28)}
        <div class="bname">${def.name}</div><div class="bcost"></div><div class="block"></div>
        <div class="tip"><b>${def.name}</b> <i>${def.hp} HP</i><br>${def.desc}${tiers}</div>`;
      el.onmousedown = e => { e.stopPropagation(); App.build.sel = id; App.build.selected = null; };
      bar.appendChild(el);
      this.bslots.push({ el, id, cost: el.querySelector('.bcost')!, lock: el.querySelector('.block')! });
    });
  }

  // ----------------------------- Per-frame HUD ----------------------------

  update(g: Game, cam: { x: number; y: number; w: number; h: number }): void {
    this.frame++;
    // Solo autosave (also on pause, quitting and closing the tab).
    if (!App.net && App.mode === 'playing' && performance.now() - this.savedAt > AUTOSAVE_MS) {
      this.savedAt = performance.now();
      saveRun();
    }
    const p = me(), s = p.stats;
    this.updateParty(g);
    this.refreshLiveScreens(g);
    this.updateNetStatus();

    setText($('hud-level'), `Lv ${p.level}`);
    setStyle($('hp-fill'), 'width', `${((100 * Math.max(0, p.hp)) / s.maxHp).toFixed(1)}%`);
    setText($('hp-text'), `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(s.maxHp)}`);
    setStyle($('xp-fill'), 'width', `${((100 * p.xp) / p.xpNext).toFixed(1)}%`);
    setText($('xp-text'), `${p.xp} / ${p.xpNext} XP`);
    $('talent-alert').classList.toggle('hidden', p.points <= 0);
    setText($('talent-count'), String(p.points));
    for (const k of ['wood', 'stone', 'gold'] as ResKey[]) setText($('res-' + k), String(Math.floor(g.res[k])));
    setText($('res-shards'), String(me().shards));

    const night = g.phase === 'night', rem = Math.max(0, g.phaseLen - g.phaseTime);
    const of = g.won ? ' · Endless' : ` / ${FINAL_NIGHT}`;
    setText($('cycle-label'), (night ? (g.bloodMoon ? `🩸 Blood Moon · Night ${g.day}` : `🌙 Night ${g.day}`) : `☀️ Day ${g.day}`) + of);
    setStyle($('cycle-fill'), 'width', `${((100 * g.phaseTime) / g.phaseLen).toFixed(1)}%`);
    $('hud-cycle').classList.toggle('night', night);
    $('hud-cycle').classList.toggle('blood', night && g.bloodMoon);
    const left = g.waveRemaining;
    setText($('cycle-sub'), night
      ? `Dawn in ${Math.ceil(rem)}s · ${left} monster${left === 1 ? '' : 's'}`
      : this.nightCallText(g, rem));
    $('hud-cycle').classList.toggle('vote', !night && g.nightVotes.size > 0);

    this.updateHearthPanel(g);
    $('scout').classList.toggle('hidden', !this.scout || !g.nightPlan && !night);

    for (const sl of this.slots) {
      let frac: number, remCd = 0;
      if (sl.kind === 'alt') {
        sl.el.classList.toggle('active', p.altHeld);
        frac = 0;
      } else if (sl.kind === 'basic') frac = Math.max(0, p.atkTimer) / ((sl.sp as BasicAttackDef).cd / s.atkSpeed);
      else { frac = p.cooldownFrac(sl.sp as SpellDef); remCd = p.cds[(sl.sp as SpellDef).id] || 0; }
      setStyle(sl.cd, 'height', `${(Math.min(1, frac) * 100).toFixed(0)}%`);
      setText(sl.cdt, remCd > 0.05 ? (remCd >= 1 ? String(Math.ceil(remCd)) : remCd.toFixed(1)) : '');
      sl.el.classList.toggle('ready', frac <= 0);
    }

    $('buildbar').classList.toggle('hidden', !App.build.active);
    if (App.build.active) {
      for (const b of this.bslots) {
        const def = BUILDINGS[b.id], locked = def.unlock > g.hearthLevel, c = g.world.buildCost(b.id, p);
        b.el.classList.toggle('sel', App.build.sel === b.id);
        b.el.classList.toggle('locked', locked);
        setHtml(b.cost, locked ? '' : costHtml(c));
        setText(b.lock, locked ? `Hearth ${ROMAN[def.unlock - 1]}` : '');
        b.el.classList.toggle('poor', !locked && !g.canAfford(c));
      }
    }
    this.updateContext(g, cam);

    let hint = '';
    if (App.mode === 'playing') {
      const it = nearestInteractable(g, p);
      if (p.dead) hint = `Reviving at the Hearth in ${Math.ceil(p.respawn)}s…`;
      else if (it) hint = it.locked ? it.locked : `${Input.label('KeyF')}: ${it.label}`;
      else if (App.build.active) hint = `LMB place · drag for walls · click a building to upgrade it · RMB or ${Input.label('KeyB')} to close`;
      else if (g.day === 1 && g.phase === 'day' && g.stats.gathered < 40) hint = 'Hold LMB on trees and rocks to gather resources';
      else if (g.day === 1 && g.phase === 'day' && g.stats.built === 0) hint = `Press ${Input.label('KeyB')} to build walls and towers around the Hearth`;
    }
    setText($('hint'), hint);
    $('hint').classList.toggle('hidden', !hint);
    $('death').classList.toggle('hidden', !p.dead || App.mode !== 'playing');
    if (p.dead) setText($('death'), `You have fallen — reviving in ${Math.ceil(p.respawn)}s`);

    if (this.frame % 4 === 0) this.minimap.draw(g, cam);
  }

  /** Day subtitle: when night falls, and how to start it early (a vote with others). */
  private nightCallText(g: Game, rem: number): string {
    const key = Input.label('KeyN'), voters = g.voters.length;
    if (voters <= 1) return `Nightfall in ${Math.ceil(rem)}s · ${key} to start now`;
    const n = g.voters.filter(p => g.nightVotes.has(p.id)).length;
    if (!n) return `Nightfall in ${Math.ceil(rem)}s · ${key} to vote to start now`;
    const mine = g.nightVotes.has(App.me);
    return `Vote to start the night: ${n}/${voters} · ${key} to ${mine ? 'withdraw' : 'agree'} (${g.voteT}s)`;
  }

  private updateHearthPanel(g: Game): void {
    const h = g.world.hearth, lvl = h.tier;
    setStyle($('hearth-fill'), 'width', `${((100 * Math.max(0, h.hp)) / h.maxHp).toFixed(1)}%`);
    setText($('hearth-text'), `${Math.ceil(Math.max(0, h.hp))} / ${h.maxHp}`);
    setText($('hearth-name'), `Hearth ${ROMAN[lvl]}`);
    $('hearth-panel').classList.toggle('danger', h.hp / h.maxHp < 0.35);
    const btn = $('btn-hearth-up') as HTMLButtonElement, next = HEARTH_LEVELS[lvl + 1];
    btn.classList.toggle('hidden', !next);
    if (!next) return;
    const up = g.world.nextUpgrade(h, me())!;
    setHtml(btn, `⬆ ${ROMAN[lvl + 1]} ${costHtml(up.cost, g)}`);
    btn.title = `${next.name}: ${next.desc}`;
    btn.classList.toggle('poor', !g.canAfford(up.cost));
  }

  // ----------------------------- Building menu ----------------------------

  private updateContext(g: Game, cam: { x: number; y: number }): void {
    const el = $('ctx'), id = App.build.selected, b = id !== null && App.build.active ? g.world.buildingById(id) : undefined;
    el.classList.toggle('hidden', !b);
    if (!b) return;
    setHtml(el, this.contextHtml(g, b));
    // Above the building, or below it when that would run into the top of the screen.
    const above = b.ty * TILE - cam.y - 8, below = (b.ty + b.size) * TILE - cam.y + 8;
    const flip = above - el.offsetHeight < 170;
    el.classList.toggle('below', flip);
    const half = el.offsetWidth / 2;
    setStyle(el, 'left', `${Math.round(Math.min(window.innerWidth - half - 8, Math.max(half + 8, b.x - cam.x)))}px`);
    setStyle(el, 'top', `${Math.round(flip ? below : above)}px`);
  }

  private contextHtml(g: Game, b: Building): string {
    const w = g.world, up = w.nextUpgrade(b, me()), err = w.upgradeError(me(), b);
    const tierLabel = b.type === 'hearth' ? `Level ${ROMAN[b.tier]}` : b.def.tiers ? `Tier ${ROMAN[b.tier]}` : '';
    let upgrade = '';
    if (up) {
      const blocked = !!err && err !== 'Not enough resources';
      upgrade = `<button data-action="upgrade" ${err ? 'disabled' : ''}>⬆ ${up.name}
        <span class="cost">${blocked ? err : costHtml(up.cost, g)}</span></button>`;
    } else if (b.def.tiers || b.type === 'hearth') {
      upgrade = '<div class="ctx-max">Fully upgraded</div>';
    }
    let rest = '';
    if (b.type !== 'hearth') {
      const rc = w.repairCost(b), intact = b.hp >= b.maxHp;
      rest = `<button data-action="repair" ${intact || !g.canAfford(rc) ? 'disabled' : ''}>🔧 Repair
          <span class="cost">${intact ? 'Intact' : costHtml(rc, g)}</span></button>
        <button data-action="demolish" class="danger">💣 Demolish <span class="cost">${costHtml(w.demolishRefund(b)) || 'no refund'}</span></button>`;
    }
    return `<div class="ctx-head"><b>${b.stats.name}</b><span>${tierLabel}</span></div>
      <div class="ctx-hp">${Math.ceil(b.hp)} / ${b.maxHp} HP</div>${upgrade}${rest}`;
  }

  private onContextClick(e: MouseEvent): void {
    const action = (e.target as HTMLElement).closest('button')?.dataset.action, g = this.game;
    const b = g && App.build.selected !== null ? g.world.buildingById(App.build.selected) : undefined;
    if (!action || !g || !b) return;
    if (action === 'upgrade') command({ c: 'upgrade', id: b.id });
    else if (action === 'repair') command({ c: 'repair', id: b.id });
    else if (action === 'demolish') { command({ c: 'demolish', id: b.id }); App.build.selected = null; }
  }

  // ----------------------------- Scout report & shop ----------------------

  private renderScout(): void {
    const r = this.scout;
    if (!r) return;
    $('scout').innerHTML = `
      <div class="scout-head">${r.final ? '👑 Final night — ' : ''}${r.bloodMoon ? '🩸 Blood Moon — ' : ''}Scouts: night ${r.night}</div>
      <div class="scout-dir">From the ${r.directions}</div>
      ${r.power > 1 ? `<div class="scout-row"><b>×${r.power}</b> stronger monsters <span>(the horde is too big to come all at once)</span></div>` : ''}
      ${r.champions ? `<div class="scout-row"><b>${r.champions}</b> champions <span>shielded, splitting, vampiric, explosive or swift</span></div>` : ''}
      ${r.groups.map(gr => `<div class="scout-row"><b>${gr.count}×</b> ${gr.name} <span>${gr.blurb}</span></div>`).join('')}`;
  }

  private renderShop(): void {
    const g = this.game!;
    this.shopKey = this.shopState(g);
    setText($('shop-gold'), String(Math.floor(g.res.gold)));
    const wrap = $('shop-items');
    wrap.innerHTML = '';
    for (const item of SHOP) {
      const sold = !!item.once && g.shopBought.has(item.id);
      const el = document.createElement('div');
      el.className = 'shop-item' + (sold ? ' sold' : '');
      el.innerHTML = `${iconHtml(item.icon, 32)}<div class="si-body"><b>${item.name}</b><div>${item.desc}</div></div>
        <button ${sold || !g.canAfford(item.cost) ? 'disabled' : ''}>${sold ? 'Sold out' : costHtml(item.cost)}</button>`;
      el.querySelector('button')!.onclick = () => {
        command({ c: 'buy', item: item.id });
        this.renderShop();
      };
      wrap.appendChild(el);
    }
    this.renderWares(g);
  }

  /** The merchant's equipment for this visit. */
  private renderWares(g: Game): void {
    const wrap = $('shop-wares'), p = me(), tip = $('item-tip');
    wrap.innerHTML = '';
    $('shop-wares-title').classList.toggle('hidden', !g.wares.length);
    g.wares.forEach((item, i) => {
      const price = itemPrice(item), r = RARITIES[item.rarity];
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.innerHTML = `<div class="inv-ico" style="--rc:${r.color}">${iconHtml(itemIcon(item, p.cls), 32)}</div>
        <div class="si-body"><b style="color:${r.color}">${itemName(item, p.cls)}</b><div>${r.name} · item level ${item.ilvl}</div></div>
        <button ${g.res.gold < price ? 'disabled' : ''}>${price}${iconHtml(RES_ICONS.gold, 14)}</button>`;
      el.querySelector('button')!.onclick = () => { command({ c: 'buyItem', index: i }); this.renderShop(); };
      el.onmouseenter = () => {
        tip.innerHTML = itemTipHtml(item, p, '', p.equip[item.slot]);
        tip.classList.remove('hidden');
      };
      el.onmousemove = e => this.inventory.placeTip(tip, e);
      el.onmouseleave = () => this.inventory.hideTip();
      wrap.appendChild(el);
    });
  }

  banner(title: string, sub: string, danger = false): void {
    const b = $('banner');
    setText($('banner-title'), title);
    setText($('banner-sub'), sub);
    b.classList.toggle('danger', danger);
    b.classList.remove('hidden', 'show');
    void b.offsetWidth; // restart the CSS animation
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.add('hidden'), 5200);
  }

  toast(msg: string): void {
    const wrap = $('toasts'), t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4200);
    while (wrap.children.length > 4) wrap.firstChild!.remove();
  }

  // ----------------------------- Game over --------------------------------

  private gameOver(g: Game): void {
    setBuildMode(false);
    saveRun(); // a lost run's save is deleted
    const n = g.stats.nights, best = loadBest();
    const isBest = n > 0 && (!best.nights || n > best.nights || (n === best.nights && g.stats.kills > (best.kills ?? 0)));
    if (isBest) saveBest({ nights: n, kills: g.stats.kills, cls: CLASSES[me().cls].name });
    this.unlocked = recordRun(me().cls, n, false) ?? this.unlocked;
    if (!App.net) this.submitSolo(g);
    else if (!this.rank) this.rankPending = n > 0 || g.won;
    const title = this.endedByChoice ? 'Victory' : g.won ? 'The Hearth fell at last' : 'The Hearth has fallen';
    const sub = this.endedByChoice ? `You held the Hearth through the final night.`
      : g.won ? `After winning, you held on for ${n - FINAL_NIGHT} more night${n - FINAL_NIGHT === 1 ? '' : 's'} of endless mode.`
      : n ? `You survived ${n} of ${FINAL_NIGHT} nights.` : '';
    const prog = this.endedByChoice ? 0 : nightProgress(g);
    const deeper = prog ? ` The horde broke through ${Math.round(prog * 100)}% of the way into night ${n + 1}.` : '';
    this.showResults(g, title, sub + deeper, !this.endedByChoice, isBest ? '★ New personal best!' : '');
    $('hud').classList.add('hidden');
  }

  /** The final night was survived. Solo pauses here; online the run keeps going behind the screen. */
  private victory(g: Game): void {
    setBuildMode(false);
    App.mode = 'victory';
    saveRun();
    this.unlocked = recordRun(me().cls, g.stats.nights, true) ?? this.unlocked;
    if (!App.net) this.submitSolo(g);
    else this.rankPending = true;
    this.showResults(g, 'Victory!', 'The Hearth stands. You survived the final night. Keep going to see how long you can last in endless mode.', false);
  }

  private showResults(g: Game, title: string, sub: string, defeat: boolean, extra = ''): void {
    this.hideScreens();
    const r = resultsHtml(g);
    const t = $('over-title');
    setText(t, title);
    t.classList.toggle('danger-title', defeat);
    setText($('over-sub'), sub);
    $('over-stats').innerHTML = r.stats;
    $('over-party').innerHTML = r.party;
    this.renderNotes(extra);
    const won = App.mode === 'victory';
    $('btn-endless').classList.toggle('hidden', !won);
    $('btn-victory-end').classList.toggle('hidden', !won);
    setText($('btn-victory-end'), App.net ? 'Leave run' : 'End run');
    $('btn-again').classList.toggle('hidden', won);
    setText($('btn-again'), App.net ? 'Back to lobby' : 'Play again');
    $('btn-over-menu').classList.toggle('hidden', won || !!App.net);
    $('gameover').classList.remove('hidden');
  }

  private notesExtra = '';
  private renderNotes(extra = this.notesExtra): void {
    this.notesExtra = extra;
    const guest = !App.net && !signedIn() ? '<div class="note-rank muted">Sign in to put your solo runs on the leaderboard.</div>' : '';
    $('over-notes').innerHTML = rankHtml(this.rank, this.rankPending) + guest + heirloomHtml(me().cls, this.unlocked)
      + (extra ? `<div class="note-best">${extra}</div>` : '');
  }

  /** The server (online) or our submission (solo) put the run on the leaderboard. */
  setRank(r: { size: number; rank: number | null; id: string }): void {
    this.rank = r;
    this.rankPending = false;
    if (!$('gameover').classList.contains('hidden') && this.game) this.renderNotes();
  }

  private submitSolo(g: Game): void {
    if ((!g.stats.nights && !g.won) || !signedIn()) return;
    this.rankPending = true;
    void submitSolo(runResult(g), App.lbEntry).then(res => {
      if (g !== this.game) return;
      if (!res) { this.rankPending = false; this.renderNotes(); return; }
      App.lbEntry = res;
      saveRun();
      this.setRank({ size: 1, rank: res.rank, id: res.id });
    });
  }

  private keepGoing(): void {
    if (App.mode !== 'victory') return;
    App.mode = 'playing';
    this.hideScreens();
    this.toast('Endless mode: the nights keep getting worse. How long can you last?');
  }

  private endWonRun(): void {
    if (App.mode !== 'victory') return;
    if (App.net) { toMenu(); return; }
    this.endedByChoice = true;
    this.game?.endGame();
  }

  // ----------------------------- Co-op -------------------------------------

  /** Ping (or "reconnecting") in the corner while online. */
  private updateNetStatus(): void {
    const net = App.net, el = $('net-status');
    el.classList.toggle('hidden', !net);
    if (!net) return;
    const ms = net.ping;
    setText(el, net.reconnecting ? 'Reconnecting…' : ms === null ? '…' : `${ms} ms`);
    el.classList.toggle('bad', net.reconnecting || (ms ?? 0) > 150);
  }

  /** Other players' health, under our own panel (online only). */
  private updateParty(g: Game): void {
    const others = g.players.filter(q => q.id !== App.me);
    $('party').classList.toggle('hidden', !others.length);
    if (!others.length) return;
    setHtml($('party'), others.map(q => {
      const pct = q.dead ? 0 : Math.round((100 * Math.max(0, q.hp)) / q.maxHp);
      return `<div class="pm" style="--cc:${q.def.color}"><span class="pm-name">${escapeHtml(q.name)}</span>
        <span class="pm-lv">${q.dead ? 'down' : 'Lv ' + q.level}</span><div class="pm-bar"><div style="width:${pct}%"></div></div></div>`;
    }).join(''));
  }

  /** Online, the talent screen and shop change when a snapshot arrives: redraw when they did. */
  private refreshLiveScreens(g: Game): void {
    if (App.mode === 'talents') {
      const key = this.talentState();
      if (key !== this.talentKey) { this.talentKey = key; this.talents.render(g); }
    } else if (App.mode === 'inventory') {
      const key = this.inventory.state();
      if (key !== this.inventoryKey) { this.inventoryKey = key; this.inventory.render(g); this.seenBag = me().bag.length; }
    } else if (App.mode === 'shop' && this.shopState(g) !== this.shopKey) {
      this.renderShop();
    } else if (App.mode === 'forge') {
      const key = this.forge.state(g);
      if (key !== this.forgeKey) { this.forgeKey = key; this.forge.render(g); }
    }
    // New loot since we last opened the bag.
    const fresh = Math.max(0, me().bag.length - this.seenBag);
    if (me().bag.length < this.seenBag) this.seenBag = me().bag.length;
    setText($('bag-new'), fresh ? String(fresh) : '');
    $('bag-new').classList.toggle('hidden', !fresh);
  }

  private talentState(): string {
    const p = me();
    return JSON.stringify([p.talents, p.points, this.game!.phase]);
  }

  private shopState(g: Game): string {
    return JSON.stringify([Math.floor(g.res.gold), [...g.shopBought], g.wares.map(i => i.id), me().bag.length]);
  }

  /** A room code from an invite link (?room=CODE), joined once the menu is up. */
  private inviteCode: string | null = null;

  private initOnline(): void {
    const name = $('player-name') as HTMLInputElement;
    try { App.name = localStorage.getItem('nightfall_name') ?? ''; } catch { /* storage unavailable */ }
    name.value = App.name;
    // Signed in, the name is the account's (other players and the leaderboard see it).
    name.addEventListener('change', () => {
      const v = name.value.trim().slice(0, 16);
      if (signedIn()) { if (v) void pushSettings({ ...account()!.settings, name: v }).catch(e => this.onlineError((e as Error).message)); return; }
      App.name = v;
      try { localStorage.setItem('nightfall_name', App.name); } catch { /* storage unavailable */ }
    });
    const code = new URLSearchParams(location.search).get('room');
    if (code && /^[A-Za-z0-9]{5}$/.test(code)) this.inviteCode = code.toUpperCase();

    $('btn-online').onclick = () => void this.goOnline();
    $('btn-hub-back').onclick = () => {
      App.net?.close();
      App.net = null;
      this.showMenu();
    };
    $('btn-create-public').onclick = () => App.net?.create(true);
    $('btn-create-private').onclick = () => App.net?.create(false);
    const join = () => {
      const c = ($('join-code') as HTMLInputElement).value.trim().toUpperCase();
      if (c) App.net?.join(c);
    };
    $('btn-join').onclick = join;
    $('join-code').addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') join(); });
    $('btn-lobby-leave').onclick = () => App.net?.leaveRoom();
    $('btn-lobby-start').onclick = () => App.net?.start();
    $('btn-copy-invite').onclick = () => {
      const room = App.net?.room;
      if (!room) return;
      const link = `${location.origin}${location.pathname}?room=${room.code}`;
      navigator.clipboard?.writeText(link).then(() => setText($('btn-copy-invite'), 'Copied!'), () => prompt('Invite link:', link));
      window.setTimeout(() => setText($('btn-copy-invite'), 'Copy invite link'), 1500);
    };
    // Keep the public room list fresh while it's on screen.
    window.setInterval(() => { if (App.mode === 'hub') App.net?.list(); }, 3000);
  }

  /** Connects to the game server and opens the room browser (or joins an invite's room). */
  private async goOnline(): Promise<void> {
    // Online play needs an account (it's how players get their characters back in saved runs).
    if (!signedIn()) return this.auth.show('Online play needs an account.', () => void this.goOnline());
    const net = new NetClient();
    this.onlineError('Connecting…');
    try {
      await net.connect();
    } catch (e) {
      this.onlineError(`${(e as Error).message}. Is the server running (npm start)?`);
      return;
    }
    this.onlineError('');
    App.net = net;
    // Reconnecting with a saved session may have put us straight back into a room.
    if (net.room) return;
    if (this.inviteCode) {
      net.join(this.inviteCode);
      this.inviteCode = null;
      return;
    }
    this.showHub();
    net.list();
  }

  /** Shows a connection problem on whichever online screen is up. */
  onlineError(msg: string): void {
    setText($('online-error'), msg);
    setText($('hub-error'), msg);
  }

  /** The online room browser. */
  showHub(): void {
    const net = App.net;
    if (!net) return this.showMenu();
    if (App.mode !== 'hub') {
      this.hideScreens();
      $('hud').classList.add('hidden');
      setText($('hub-error'), '');
      App.mode = 'hub';
    }
    setText($('hub-status'), `Playing as ${App.name}`);
    const list = $('room-list');
    setHtml(list, net.rooms.length ? net.rooms.map(r => `<div class="room-row">
        <b class="room-code">${r.code}</b><span>${escapeHtml(r.host)}'s room</span>
        <span class="room-state">${r.running ? `Day ${r.day} · in progress` : 'In the lobby'}</span>
        <span>${r.players} / 4</span><button data-code="${r.code}">Join</button></div>`).join('')
      : '<div class="room-empty">No public rooms right now. Start one, or join a friend\'s with its code.</div>');
    for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-code]')) b.onclick = () => net.join(b.dataset.code!);
    $('hub').classList.remove('hidden');
  }

  /** Inside an online room, between runs. */
  showLobby(): void {
    const net = App.net, room = net?.room;
    if (!net) return this.showMenu();
    if (!room) return this.showHub();
    this.hideScreens();
    $('hud').classList.add('hidden');
    App.mode = 'lobby';
    const you = room.members.find(m => m.id === net.you);
    if (you) App.cls = you.cls;
    $('lobby-members').innerHTML = room.members.map(m => {
      const c = CLASSES[m.cls];
      const state = !m.online ? ' · reconnecting…' : m.playing ? ' · in the run' : '';
      return `<div class="lm${m.id === net.you ? ' you' : ''}${m.online ? '' : ' away'}" style="--cc:${c.color}">
        <div class="cc-portrait">${this.portraitHtml(m.cls)}</div>
        <b>${escapeHtml(m.name)}${m.host ? ' 👑' : ''}</b><span>${c.name}${state}</span></div>`;
    }).join('');

    const picks = $('lobby-classes');
    picks.innerHTML = '';
    for (const id of CLASS_IDS) {
      const c = CLASSES[id], b = document.createElement('button');
      b.className = 'lc' + (id === App.cls ? ' sel' : '');
      b.style.setProperty('--cc', c.color);
      b.innerHTML = `<b>${c.name}</b><span>${c.tagline}</span>`;
      b.onclick = () => { App.cls = id; net.pick(id); };
      picks.appendChild(b);
    }

    const start = $('btn-lobby-start') as HTMLButtonElement;
    if (room.running) {
      start.disabled = room.full;
      start.textContent = room.full ? 'The run is full' : 'Join the run in progress';
    } else {
      start.disabled = !net.isHost;
      const n = room.members.length;
      start.textContent = net.isHost ? `Start the run (${n} player${n === 1 ? '' : 's'})` : 'Waiting for the host to start…';
    }
    this.renderLobbySaves();
    setText($('lobby-status'), `${room.members.length} / 4 players · ${room.public ? 'public' : 'private'}`);
    setText($('lobby-code'), room.code);
    $('lobby').classList.remove('hidden');
  }

  /** Lobby: our account's saved online runs. The host can resume one. */
  private renderLobbySaves(): void {
    const net = App.net, room = net?.room, wrap = $('lobby-saves');
    if (!net || !room) return;
    if (room.running) { wrap.classList.add('hidden'); return; }
    // Ask the server which of our runs still exist, now and then.
    if (Date.now() - net.savesAskedAt > 4000) net.askSaves();
    const list = net.saveList ?? [];
    wrap.classList.toggle('hidden', !list.length);
    wrap.innerHTML = list.length ? `<h3>Saved runs</h3>${net.isHost ? '' : '<div class="muted">The host can resume one of these.</div>'}` : '';
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'save-row';
      const who = s.meta.players.map(p => `<b>${escapeHtml(p.name)}</b> <span style="color:${CLASSES[p.cls].color}">${CLASSES[p.cls].name}</span>`).join(', ');
      row.innerHTML = `<div>${who}<span class="save-when">${describeSave(s.meta)}</span></div>`;
      const go = document.createElement('button'), del = document.createElement('button');
      go.className = 'primary'; go.textContent = 'Resume'; go.disabled = !net.isHost; go.onclick = () => net.resume(s.id);
      del.className = 'del'; del.textContent = '✕'; del.title = 'Remove from this list';
      del.onclick = () => { net.forgetSave(s.id); this.renderLobbySaves(); };
      row.append(go, del);
      wrap.appendChild(row);
    }
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

export const UI = new UIController();
