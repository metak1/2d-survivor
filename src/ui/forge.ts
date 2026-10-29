// The Legendary Forge screen (F at the Hearth): the run's legendary collection (craft what's been
// discovered, empower what's owned) and reforging any item (reroll its stats, raise its level).

import { ROMAN } from '../data/buildings';
import { FORGE, LEGENDARIES, LEGEND_MAX_RANK, RARITIES, SLOT_NAMES } from '../data/items';
import { command, me } from '../app';
import { empowerCost, rerollCost, upgradeCost } from '../sim/forge';
import type { Game } from '../sim/game';
import { itemIcon, itemName, type Item } from '../sim/items';
import { iconHtml } from './icons';
import { itemTipHtml } from './inventory';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const SHARD = '💠';

export class ForgeScreen {
  init(): void {
    const tip = $('item-tip');
    $('forge').addEventListener('mousemove', e => {
      tip.style.left = `${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8)}px`;
    });
  }

  /** What's shown, to redraw only when it changes. */
  state(g: Game): string {
    const p = me();
    return JSON.stringify([p.shards, [...p.codex], g.day, [...p.bag, ...p.worn].map(i => [i.id, i.rank, i.ilvl, i.mods])]);
  }

  render(g: Game): void {
    const p = me(), owned = [...p.worn, ...p.bag];
    $('item-tip').classList.add('hidden');
    $('forge-shards').innerHTML = `<b>${p.shards}</b> ${SHARD} Legendary Shards`;

    // The collection: every legendary, discovered or not.
    const list = $('forge-legends');
    list.innerHTML = '';
    // Discovered ones first.
    const sorted = [...LEGENDARIES].sort((x, y) => Number(p.codex.has(y.id)) - Number(p.codex.has(x.id)));
    for (const L of sorted) {
      const known = p.codex.has(L.id), have = owned.find(i => i.legend === L.id);
      const el = document.createElement('div');
      el.className = 'fl-card' + (known ? '' : ' unknown');
      const rank = have?.rank ?? 1;
      el.innerHTML = `
        <div class="fl-ico">${known ? iconHtml(L.icon, 32) : '<span>?</span>'}</div>
        <div class="fl-txt">
          <b>${known ? esc(L.name) : 'Undiscovered'}${have ? ` <span class="fl-rank">${ROMAN[rank - 1]}</span>` : ''}</b>
          <span>${known ? `${SLOT_NAMES[L.slot]} · ${esc(L.desc(rank))}` : 'Slay a boss to discover a legendary.'}</span>
        </div>`;
      if (known) {
        const btn = document.createElement('button');
        if (have) {
          const max = rank >= LEGEND_MAX_RANK, cost = empowerCost(have);
          btn.textContent = max ? 'Max rank' : `Empower to ${ROMAN[rank]} · ${cost} ${SHARD}`;
          btn.disabled = max || p.shards < cost;
          btn.onclick = () => command({ c: 'forge', op: 'empower', item: have.id });
          btn.title = max ? '' : `Rank ${ROMAN[rank]}: ${L.desc(rank + 1)}`;
        } else {
          btn.textContent = `Craft · ${FORGE.craft} ${SHARD}`;
          btn.disabled = p.shards < FORGE.craft;
          btn.onclick = () => command({ c: 'forge', op: 'craft', legend: L.id });
        }
        el.appendChild(btn);
      }
      list.appendChild(el);
    }

    // Reforging: everything worn or carried.
    const gear = $('forge-gear');
    gear.innerHTML = '';
    if (!owned.length) gear.innerHTML = '<div class="muted">Nothing to reforge yet.</div>';
    for (const item of owned) {
      const el = document.createElement('div');
      el.className = 'fg-row';
      el.style.setProperty('--rc', RARITIES[item.rarity].color);
      el.innerHTML = `
        <div class="inv-ico" style="--rc:${RARITIES[item.rarity].color}">${iconHtml(itemIcon(item, p.cls), 32)}</div>
        <div class="fg-txt"><b style="color:${RARITIES[item.rarity].color}">${esc(itemName(item, p.cls))}</b>
          <span>${p.equip[item.slot] === item ? 'Worn' : 'In bag'} · item level ${item.ilvl}</span></div>`;
      const btn = (label: string, cost: number, ok: boolean, op: 'reroll' | 'upgrade', why = '') => {
        const b = document.createElement('button');
        b.textContent = `${label} · ${cost} ${SHARD}`;
        b.disabled = !ok || p.shards < cost;
        if (why) b.title = why;
        b.onclick = () => command({ c: 'forge', op, item: item.id });
        el.appendChild(b);
      };
      btn('Reroll stats', rerollCost(item), true, 'reroll', item.legend ? 'Rerolls its random stat; its own stats and rank stay.' : 'Rolls new stats of the same rarity.');
      btn(`Upgrade to level ${item.ilvl + 1}`, upgradeCost(item), item.ilvl < g.day, 'upgrade', item.ilvl < g.day ? '' : `Items can be raised up to today's level (${g.day}).`);
      this.tip(el, item);
      gear.appendChild(el);
    }
  }

  private tip(el: HTMLElement, item: Item): void {
    const tip = $('item-tip');
    el.onmouseenter = () => {
      tip.innerHTML = itemTipHtml(item, me());
      tip.style.setProperty('--rc', RARITIES[item.rarity].color);
      tip.classList.remove('hidden');
    };
    el.onmouseleave = () => tip.classList.add('hidden');
  }
}
