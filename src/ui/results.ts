// The end of a run: the victory and game-over screen (party totals, best finds, leaderboard rank,
// unlocked heirlooms) and the leaderboard screen, one board per party size.

import { MAX_PLAYERS } from '../config';
import { ROMAN } from '../data/buildings';
import { CLASSES } from '../data/classes';
import { RARITIES, type Rarity } from '../data/items';
import type { ClassId } from '../data/types';
import { App } from '../app';
import { fetchBoards } from '../net/scores';
import type { RunResult } from '../net/protocol';
import type { Game } from '../sim/game';
import { itemName } from '../sim/items';
import { nightProgress } from '../sim/cycle';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/** 1234 → "1.2k". */
export const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
/** Seconds → "m:ss" (or "h:mm:ss"). */
export const clock = (s: number) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export const bracketName = (n: number) => (n === 1 ? 'Solo' : `${n} players`);

const clsName = (cls: ClassId) => `<span style="color:${CLASSES[cls].color}">${esc(CLASSES[cls].name)}</span>`;

/** The run as the leaderboard keeps it. */
export function runResult(g: Game): RunResult {
  return {
    size: Math.max(1, g.peakParty), players: g.players.map(p => ({ name: p.name, cls: p.cls })),
    nights: g.stats.nights, won: g.won, kills: g.stats.kills, time: Math.round(g.time), online: !!App.net,
    progress: nightProgress(g),
  };
}

/** The four big numbers and the per-player table. */
export function resultsHtml(g: Game): { stats: string; party: string } {
  const n = g.stats.nights;
  const stats = `
    <div><b>${n}</b><span>Night${n === 1 ? '' : 's'} survived</span></div>
    <div><b>${short(g.stats.kills)}</b><span>Monsters slain</span></div>
    <div><b>${clock(g.time)}</b><span>Time</span></div>
    <div><b>${ROMAN[g.world.hearth.tier]}</b><span>Hearth level</span></div>`;
  const anyHeal = g.players.some(p => p.run.heal >= 1);
  const rows = [...g.players].sort((a, b) => b.run.dmg - a.run.dmg).map(p => {
    const best = p.run.best;
    const find = best ? `<span style="color:${RARITIES[best.rarity].color}">${esc(itemName(best, p.cls))}</span>` : '<span class="muted">—</span>';
    return `<tr class="${p.id === App.me ? 'me' : ''}">
      <td><b>${esc(p.name)}</b> ${clsName(p.cls)} <span class="muted">Lv ${p.level}</span></td>
      <td>${short(p.run.dmg)}</td>${anyHeal ? `<td>${short(p.run.heal)}</td>` : ''}<td>${short(p.run.taken)}</td>
      <td>${p.run.kills}</td><td>${p.run.deaths}</td><td class="find">${find}</td></tr>`;
  }).join('');
  const party = `<table class="res-party"><thead><tr><th>Player</th><th>Damage</th>${anyHeal ? '<th>Healing</th>' : ''}<th>Taken</th>
    <th>Kills</th><th>Deaths</th><th>Best find</th></tr></thead><tbody>${rows}</tbody></table>`;
  return { stats, party };
}

export function rankHtml(r: { size: number; rank: number | null } | null, pending: boolean): string {
  if (r?.rank) return `<div class="note-rank">🏆 #${r.rank} on the ${bracketName(r.size)} leaderboard</div>`;
  if (r) return `<div class="note-rank muted">Not in the top 100 for ${bracketName(r.size)} this time.</div>`;
  return pending ? '<div class="note-rank muted">Recording your run…</div>' : '';
}

export function heirloomHtml(cls: ClassId, r: Rarity | null): string {
  if (!r) return '';
  const a = /^[aeiou]/i.test(RARITIES[r].name) ? 'an' : 'a';
  return `<div class="note-heir">🗡 Heirloom unlocked: your ${esc(CLASSES[cls].name)} now starts each run with ${a}
    <b style="color:${RARITIES[r].color}">${RARITIES[r].name}</b> weapon.</div>`;
}

// ----------------------------------------------------------------- leaderboard screen

export class BoardScreen {
  private tab = 1;
  /** Entry to highlight (the run just played). */
  private mine: string | null = null;

  init(): void {
    $('btn-board-close').onclick = () => this.hide();
  }

  async show(size = 1, mine: string | null = null): Promise<void> {
    this.tab = size;
    this.mine = mine;
    $('board').classList.remove('hidden');
    $('board-list').innerHTML = '<div class="muted board-empty">Loading…</div>';
    this.renderTabs();
    const boards = await fetchBoards();
    if ($('board').classList.contains('hidden')) return;
    this.boards = boards;
    this.renderList();
  }

  hide(): void { $('board').classList.add('hidden'); }

  private boards: Awaited<ReturnType<typeof fetchBoards>> = null;

  private renderTabs(): void {
    const tabs = $('board-tabs');
    tabs.innerHTML = '';
    for (let n = 1; n <= MAX_PLAYERS; n++) {
      const b = document.createElement('button');
      b.textContent = bracketName(n);
      b.className = n === this.tab ? 'on' : '';
      b.onclick = () => { this.tab = n; this.renderTabs(); this.renderList(); };
      tabs.appendChild(b);
    }
  }

  private renderList(): void {
    const list = $('board-list');
    if (!this.boards) {
      list.innerHTML = '<div class="muted board-empty">The leaderboards live on the game server. Run the game with <code>npm run dev</code> or <code>npm start</code> to see them.</div>';
      return;
    }
    const entries = this.boards[this.tab] ?? [];
    $('board-note').textContent = this.tab === 1 ? 'Solo runs' : `Runs that had ${this.tab} players at once`;
    if (!entries.length) {
      list.innerHTML = '<div class="muted board-empty">No runs yet. Be the first!</div>';
      return;
    }
    list.innerHTML = `<table class="board-table"><thead><tr><th>#</th><th>Party</th><th>Nights</th><th>Kills</th><th>Time</th><th>Date</th></tr></thead>
      <tbody>${entries.map((e, i) => `<tr class="${e.id === this.mine ? 'me' : ''}">
        <td class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
        <td>${e.players.map(p => `<b>${esc(p.name)}</b> ${clsName(p.cls)}`).join(', ')}</td>
        <td><b>${e.nights}</b>${e.progress ? ` <span class="muted" title="How far into night ${e.nights + 1} it got">+${Math.round(e.progress * 100)}%</span>` : ''}${e.won ? ' <span class="won" title="Won the run">👑</span>' : ''}</td>
        <td>${short(e.kills)}</td><td>${clock(e.time)}</td>
        <td class="muted">${new Date(e.date).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>`;
  }
}
