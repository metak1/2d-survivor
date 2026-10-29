// The talent screen: one grid per tree, with links between nodes, row gates, choice nodes and a
// tooltip. Click learns a rank, right-click refunds one (during the day).

import { TALENTS, TALENT_GATES } from '../data/talents';
import type { TalentDef, TalentNode, TalentTree } from '../data/types';
import type { Game } from '../sim/game';
import { command, me } from '../app';
import { MAX_TALENT_POINTS } from '../config';
import { canLearn, canUnlearn, nodeMax, nodeOpen, nodeRank, pointsAbove, rowRequirement, treeSpent } from '../sim/stats';
import { iconHtml } from './icons';

const $ = (id: string) => document.getElementById(id)!;

// Grid geometry in pixels.
const CELL_X = 62, CELL_Y = 66, NODE = 44, PAD_X = 10, PAD_Y = 12;
const COLS = 5, ROWS = 8;
const cx = (col: number) => PAD_X + col * CELL_X + CELL_X / 2;
const cy = (row: number) => PAD_Y + row * CELL_Y + NODE / 2;

interface Hover { tree: number; node: string; option: number }

export class TalentScreen {
  private game: Game | null = null;
  private hover: Hover | null = null;

  init(): void {
    const tip = $('talent-tip');
    $('talents').addEventListener('mousemove', e => {
      tip.style.left = `${Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8)}px`;
    });
    $('btn-talents-reset').onclick = () => {
      if (!this.game || me().respecBlocked) return;
      command({ c: 'resetTalents' });
      this.render(this.game);
    };
  }

  render(g: Game): void {
    this.game = g;
    const p = me(), blocked = p.respecBlocked;
    $('talent-points').textContent = String(p.points);
    $('talent-earned').textContent = `${p.earnedPoints} / ${MAX_TALENT_POINTS} earned this run`;
    const reset = $('btn-talents-reset') as HTMLButtonElement;
    reset.disabled = !!blocked;
    reset.title = blocked ?? 'Refund every talent point';
    $('talent-foot').innerHTML = `Click to learn · Right-click to refund${blocked ? ' (day only)' : ''} · `
      + TALENT_GATES.map(gt => `row ${gt.row + 1} needs ${gt.points} points spent above it`).join(', ')
      + ' · Split nodes are choices: take one of the two.';

    const wrap = $('talent-trees');
    wrap.innerHTML = '';
    TALENTS[p.cls].forEach((tree, ti) => wrap.appendChild(this.renderTree(g, tree, ti)));
    if (this.hover) this.showTip(this.hover); else this.hideTip();
  }

  hideTip(): void {
    this.hover = null;
    $('talent-tip').classList.add('hidden');
  }

  private renderTree(g: Game, tree: TalentTree, ti: number): HTMLElement {
    const t = me().talents, spent = treeSpent(tree, t);
    const col = document.createElement('div');
    col.className = 'tree';
    col.style.setProperty('--tc', tree.color);
    col.innerHTML = `<h3>${tree.name} <span>${spent} pts</span></h3><div class="tree-role">${tree.role}</div>`;

    const grid = document.createElement('div');
    grid.className = 'tree-grid';
    grid.style.width = `${PAD_X * 2 + COLS * CELL_X}px`;
    grid.style.height = `${PAD_Y * 2 + (ROWS - 1) * CELL_Y + NODE}px`;

    // Links from each node to the nodes it opens.
    const lines: string[] = [];
    for (const node of tree.nodes) {
      for (const id of node.req) {
        const parent = tree.nodes.find(n => n.id === id)!;
        const on = nodeRank(parent, t) >= nodeMax(parent);
        lines.push(`<line class="${on ? 'on' : ''}" x1="${cx(parent.col)}" y1="${cy(parent.row) + NODE / 2}" x2="${cx(node.col)}" y2="${cy(node.row) - NODE / 2}"/>`);
      }
    }
    grid.innerHTML = `<svg class="tree-links" width="100%" height="100%">${lines.join('')}</svg>`;

    for (const gate of TALENT_GATES) {
      const el = document.createElement('div');
      const have = pointsAbove(tree, gate.row, t);
      el.className = 'gate' + (have >= gate.points ? ' on' : '');
      el.style.top = `${PAD_Y + gate.row * CELL_Y - (CELL_Y - NODE) / 2 - 1}px`;
      el.innerHTML = `<span>${Math.min(have, gate.points)}/${gate.points}</span>`;
      grid.appendChild(el);
    }

    for (const node of tree.nodes) grid.appendChild(this.renderNode(g, tree, ti, node));
    col.appendChild(grid);
    return col;
  }

  private renderNode(g: Game, tree: TalentTree, ti: number, node: TalentNode): HTMLElement {
    const p = me(), t = p.talents;
    const rank = nodeRank(node, t), max = nodeMax(node), open = nodeOpen(tree, node, t);
    const choice = node.options.length > 1;
    const el = document.createElement('div');
    const state = rank >= max ? 'maxed' : rank > 0 ? 'partial' : open ? 'open' : 'locked';
    el.className = `tnode ${state}${choice ? ' choice' : ''}${node.options.some(o => o.flag) ? ' special' : ''}`;
    const w = choice ? NODE * 1.7 : NODE;
    el.style.left = `${cx(node.col) - w / 2}px`;
    el.style.top = `${cy(node.row) - NODE / 2}px`;
    el.style.width = `${w}px`;

    node.options.forEach((opt, oi) => {
      const b = document.createElement('button');
      const mine = t[opt.id] || 0, other = choice && rank > 0 && mine === 0;
      const can = canLearn(tree, node, oi, t, p.points);
      b.className = 'half' + (mine ? ' chosen' : '') + (other ? ' dim' : '') + (can ? ' can' : '');
      b.innerHTML = iconHtml(opt.icon, 26);
      b.onclick = () => { command({ c: 'learn', tree: ti, node: node.id, option: oi }); this.render(g); };
      b.oncontextmenu = e => {
        e.preventDefault();
        command({ c: 'unlearn', tree: ti, option: opt.id });
        this.render(g);
      };
      b.onmouseenter = () => this.showTip({ tree: ti, node: node.id, option: oi });
      b.onmouseleave = () => this.hideTip();
      el.appendChild(b);
    });
    if (!choice) el.insertAdjacentHTML('beforeend', `<span class="t-rank">${rank}/${max}</span>`);
    return el;
  }

  private showTip(h: Hover): void {
    const g = this.game;
    if (!g) return;
    this.hover = h;
    const p = me(), t = p.talents, tree = TALENTS[p.cls][h.tree];
    const node = tree.nodes.find(n => n.id === h.node)!, opt: TalentDef = node.options[h.option];
    const choice = node.options.length > 1, rank = t[opt.id] || 0;
    const other = choice ? node.options[1 - h.option] : null;

    let status: string;
    if (rank >= opt.max) status = '<span class="ok">Learned</span>';
    else if (other && (t[other.id] || 0) > 0) status = `Refund ${other.name} to take this instead`;
    else if (pointsAbove(tree, node.row, t) < rowRequirement(node.row)) status = `Requires ${rowRequirement(node.row)} points spent in the rows above`;
    else if (!nodeOpen(tree, node, t)) status = `Requires ${node.req.map(id => nodeName(tree, id)).join(' or ')}`;
    else if (p.points <= 0) status = 'No talent points available';
    else status = '<span class="ok">Click to learn</span>';
    const refund = rank > 0
      ? (p.respecBlocked ? 'Refunds only during the day' : canUnlearn(tree, opt.id, t) ? 'Right-click to refund' : 'Talents below depend on this')
      : '';

    const tip = $('talent-tip');
    tip.style.setProperty('--tc', tree.color);
    tip.innerHTML = `
      <div class="tt-head"><b>${opt.name}</b><span>${choice ? 'Choice' : `Rank ${rank}/${opt.max}`}</span></div>
      <div class="tt-desc">${opt.desc}</div>
      ${other ? `<div class="tt-alt">or <b>${other.name}</b>: ${other.desc}</div>` : ''}
      <div class="tt-status">${status}</div>
      ${refund ? `<div class="tt-refund">${refund}</div>` : ''}`;
    tip.classList.remove('hidden');
  }
}

function nodeName(tree: TalentTree, id: string): string {
  const n = tree.nodes.find(x => x.id === id)!;
  return n.options.map(o => o.name).join('/');
}
