import { CLASSES } from '../data/classes';
import { TALENTS, TALENT_GATES } from '../data/talents';
import type { ClassId, Stats, StatKey, TalentNode, TalentTree } from '../data/types';
import type { Item } from './items';

const BASE: Omit<Stats, 'flags' | 'ranks' | 'legend'> = {
  maxHp: 0, regen: 0, dmgMul: 1, moveMul: 1, cdr: 0, crit: 0.05, atkSpeed: 1,
  buildCost: 1, wallHp: 1, towerDmg: 1, towerSpeed: 1, aoe: 1, pierce: 0, extraProj: 0,
  lifesteal: 0, armor: 0, thorns: 0, gather: 1, freezeBonus: 0, arcMul: 1, rangeMul: 1,
  allyMax: 0, allyPow: 1, goldMul: 1, towerHp: 1, towerRange: 1, healMul: 1, legendRank: 0,
};

/** Ranks above I of the legendary `id`, if it's the one being worn (its effect grows with them). */
export const legendBonus = (s: Stats, id: string) => (s.legend === id ? s.legendRank - 1 : 0);

/** A class's stats with its learned talents and the items it's wearing. */
export function computeStats(cls: ClassId, talents: Record<string, number>, items: Item[] = []): Stats {
  const def = CLASSES[cls];
  const s: Stats = { ...BASE, maxHp: def.hp, regen: def.regen, armor: def.armor ?? 0, flags: new Set(), ranks: {} };
  for (const tree of TALENTS[cls]) {
    for (const node of tree.nodes) {
      for (const t of node.options) {
        const rank = talents[t.id] || 0;
        if (!rank) continue;
        if (t.mods) for (const k in t.mods) s[k as StatKey] += t.mods[k as StatKey]! * rank;
        if (t.flag) {
          s.flags.add(t.flag);
          s.ranks[t.flag] = (s.ranks[t.flag] || 0) + rank;
        }
      }
    }
  }
  for (const item of items) {
    for (const k in item.mods) s[k as StatKey] += item.mods[k as StatKey]!;
    if (item.legend) { s.legend = item.legend; s.legendRank = item.rank ?? 1; }
    if (item.flag) {
      s.flags.add(item.flag);
      s.ranks[item.flag] = (s.ranks[item.flag] || 0) + 1;
    }
  }
  if (s.flags.has('sentry')) s.towerSpeed += 0.3;
  s.cdr = Math.min(0.6, s.cdr);
  s.armor = Math.min(0.6, s.armor);
  return s;
}

// ----------------------------- Talent rules ------------------------------------
// A node opens when any of its `req` nodes is fully learned and enough points are spent in the
// rows above it. The same rules decide whether a refund is allowed: the remaining talents must
// still all be reachable.

export const nodeRank = (node: TalentNode, talents: Record<string, number>) =>
  node.options.reduce((n, t) => n + (talents[t.id] || 0), 0);

export const nodeMax = (node: TalentNode) => node.options[0].max;

export const treeSpent = (tree: TalentTree, talents: Record<string, number>) =>
  tree.nodes.reduce((n, node) => n + nodeRank(node, talents), 0);

/** Points this row needs spent in the rows above it. */
export function rowRequirement(row: number): number {
  let need = 0;
  for (const gate of TALENT_GATES) if (row >= gate.row) need = gate.points;
  return need;
}

/** Points spent in a tree's rows above `row`. */
export const pointsAbove = (tree: TalentTree, row: number, talents: Record<string, number>) =>
  tree.nodes.reduce((n, node) => n + (node.row < row ? nodeRank(node, talents) : 0), 0);

/** Whether a node's prerequisites and row gate are met (ignoring points to spend). */
export function nodeOpen(tree: TalentTree, node: TalentNode, talents: Record<string, number>): boolean {
  if (pointsAbove(tree, node.row, talents) < rowRequirement(node.row)) return false;
  if (!node.req.length) return true;
  return node.req.some(id => {
    const parent = tree.nodes.find(x => x.id === id)!;
    return nodeRank(parent, talents) >= nodeMax(parent);
  });
}

export function canLearn(tree: TalentTree, node: TalentNode, option: number, talents: Record<string, number>, points: number): boolean {
  if (points <= 0 || nodeRank(node, talents) >= nodeMax(node)) return false;
  // On a choice node, the other option must not be taken.
  if (node.options.some((t, i) => i !== option && (talents[t.id] || 0) > 0)) return false;
  return nodeOpen(tree, node, talents);
}

/** Every learned node is still reachable. */
function treeValid(tree: TalentTree, talents: Record<string, number>): boolean {
  return tree.nodes.every(node => nodeRank(node, talents) === 0 || nodeOpen(tree, node, talents));
}

export function canUnlearn(tree: TalentTree, optionId: string, talents: Record<string, number>): boolean {
  if (!(talents[optionId] > 0)) return false;
  const after = { ...talents, [optionId]: talents[optionId] - 1 };
  return treeValid(tree, after);
}
