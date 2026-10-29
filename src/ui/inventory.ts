// The bag screen: what we're wearing, what we're carrying, and our resulting stats. Click a bag
// item to wear it (swapping out the old one), click a worn item to take it off, right-click a bag
// item to salvage it for gold. Hovering shows the item next to the one it would replace.

import { BAG_SIZE, ITEM_SLOTS, RARITIES, SLOT_NAMES } from '../data/items';
import { command, me } from '../app';
import type { Game } from '../sim/game';
import { itemIcon, itemLines, itemName, legendaryConflict, legendText, salvageValue, type Item } from '../sim/items';
import type { Player } from '../sim/player';
import { iconHtml } from './icons';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/** Tooltip markup for an item, optionally with the worn item it would replace. */
export function itemTipHtml(item: Item, p: Player, extra = '', compare?: Item): string {
  const r = RARITIES[item.rarity];
  const legend = legendText(item);
  let html = `<div class="it-name" style="color:${r.color}">${esc(itemName(item, p.cls))}</div>
    <div class="it-sub">${r.name} ${SLOT_NAMES[item.slot]} · item level ${item.ilvl}</div>
    <div class="it-lines">${itemLines(item).map(l => `<div>${l}</div>`).join('')}</div>
    ${legend ? `<div class="it-legend">${legend}</div>` : ''}${extra}`;
  if (compare) {
    html += `<div class="it-compare"><div class="it-sub">Currently worn:</div>
      <div class="it-name small" style="color:${RARITIES[compare.rarity].color}">${esc(itemName(compare, p.cls))}</div>
      <div class="it-lines muted">${itemLines(compare).map(l => `<div>${l}</div>`).join('')}</div>
      ${legendText(compare) ? `<div class="it-legend muted">${legendText(compare)}</div>` : ''}</div>`;
  }
  return html;
}

export class InventoryScreen {
  init(): void {
    const tip = $('item-tip');
    $('inventory').addEventListener('mousemove', e => this.placeTip(tip, e));
  }

  placeTip(tip: HTMLElement, e: MouseEvent): void {
    tip.style.left = `${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8)}px`;
  }

  hideTip(): void { $('item-tip').classList.add('hidden'); }

  /** Snapshot of what's shown, to redraw only when it changes. */
  state(): string {
    const p = me();
    return JSON.stringify([p.bag.map(i => i.id), Object.values(p.equip).map(i => i?.id)]);
  }

  render(g: Game): void {
    const p = me();
    this.hideTip();

    const worn = $('inv-equip');
    worn.innerHTML = '';
    for (const slot of ITEM_SLOTS) {
      const item = p.equip[slot];
      const el = document.createElement('div');
      el.className = 'inv-slot equip' + (item ? '' : ' empty');
      el.innerHTML = item
        ? `<div class="inv-ico" style="--rc:${RARITIES[item.rarity].color}">${iconHtml(itemIcon(item, p.cls), 32)}</div>
           <div class="inv-txt"><b style="color:${RARITIES[item.rarity].color}">${esc(itemName(item, p.cls))}</b><span>${SLOT_NAMES[slot]}</span></div>`
        : `<div class="inv-ico"></div><div class="inv-txt"><b>${SLOT_NAMES[slot]}</b><span>Empty</span></div>`;
      if (item) {
        el.onclick = () => { command({ c: 'unequip', slot }); this.render(g); };
        this.tip(el, item, p, '<div class="it-hint">Click to take off</div>');
      }
      worn.appendChild(el);
    }

    const bag = $('inv-bag');
    bag.innerHTML = '';
    for (let i = 0; i < BAG_SIZE; i++) {
      const item = p.bag[i];
      const el = document.createElement('div');
      el.className = 'inv-cell' + (item ? '' : ' empty');
      if (item) {
        el.style.setProperty('--rc', RARITIES[item.rarity].color);
        el.innerHTML = iconHtml(itemIcon(item, p.cls), 32);
        const blocker = legendaryConflict(p, item);
        if (blocker) el.classList.add('blocked');
        el.onclick = () => { command({ c: 'equip', bag: i }); this.render(g); };
        el.oncontextmenu = e => { e.preventDefault(); command({ c: 'salvage', bag: i }); this.render(g); };
        const wear = blocker
          ? `<div class="it-warn">Only one legendary at a time: take off ${esc(itemName(blocker, p.cls))} first</div>`
          : '';
        this.tip(el, item, p, `${wear}<div class="it-hint">${blocker ? '' : 'Click to wear · '}Right-click to salvage for ${salvageValue(item)} gold</div>`, p.equip[item.slot]);
      }
      bag.appendChild(el);
    }
    $('inv-count').textContent = `${p.bag.length} / ${BAG_SIZE}`;
    $('inv-stats').innerHTML = statsHtml(p);
  }

  private tip(el: HTMLElement, item: Item, p: Player, extra: string, compare?: Item): void {
    const tip = $('item-tip');
    el.onmouseenter = () => {
      tip.innerHTML = itemTipHtml(item, p, extra, compare);
      tip.style.setProperty('--rc', RARITIES[item.rarity].color);
      tip.classList.remove('hidden');
    };
    el.onmouseleave = () => this.hideTip();
  }
}

/** The numbers that matter, after talents and gear. */
function statsHtml(p: Player): string {
  const s = p.stats, pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows: [string, string][] = [
    ['Health', `${Math.round(s.maxHp)}`],
    ['Damage', `+${pct(s.dmgMul - 1)}`],
    ['Critical strike', pct(s.crit)],
    ['Attack speed', `+${pct(s.atkSpeed - 1)}`],
    ['Damage taken', `-${pct(s.armor)}`],
    ['Movement speed', `+${pct(s.moveMul - 1)}`],
    ['Spell recharge', `+${pct(s.cdr)}`],
    ['Regeneration', `${s.regen.toFixed(1)}/s`],
  ];
  if (s.lifesteal > 0) rows.push(['Lifesteal', pct(s.lifesteal)]);
  if (s.thorns > 0) rows.push(['Thorns', `${Math.round(s.thorns)}`]);
  if (s.healMul !== 1) rows.push(['Healing', `+${pct(s.healMul - 1)}`]);
  if (s.goldMul !== 1) rows.push(['Gold found', `+${pct(s.goldMul - 1)}`]);
  return rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
