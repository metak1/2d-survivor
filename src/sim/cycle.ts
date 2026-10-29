// Day/night cycle and wave spawning. Each night is planned at dusk so scouts can report
// what's coming while there's still light to prepare.

import { BOSS_EVERY, DARKNESS_MAX, DAY_LEN, FINAL_NIGHT, NIGHT_BASE_LEN, WORLD_H, WORLD_W } from '../config';
import { BOSS_ORDER, ENEMIES } from '../data/enemies';
import type { EnemyId } from '../data/types';
import { choice, compass, rand, TAU } from '../core/math';
import { Enemy } from './enemy';
import type { Game } from './game';
import { onDawn, onNightfall } from './daylife';
import { tileOf } from './world';

export interface SpawnEntry { type: EnemyId; t: number; angle: number }

export interface NightPlan {
  len: number;
  angles: number[];
  queue: SpawnEntry[];
  bloodMoon: boolean;
}

/** Seconds of dusk before nightfall, when the night is planned and darkness creeps in. */
export const DUSK = 22;

/** The boss that comes on night `n`, if any. After the final night they come round again. */
export function bossFor(n: number): EnemyId | null {
  if (n % BOSS_EVERY !== 0) return null;
  return BOSS_ORDER[(n / BOSS_EVERY - 1) % BOSS_ORDER.length];
}

/** The night that decides the run (until it's won; after that the run is endless). */
export const isFinalNight = (g: Game) => g.day === FINAL_NIGHT && !g.won;

export function updateCycle(g: Game, dt: number): void {
  g.phaseTime += dt;
  if (g.phase === 'day') {
    if (!g.nightPlan && g.phaseLen - g.phaseTime < DUSK) planNight(g);
    if (g.phaseTime >= g.phaseLen) startNight(g);
    return;
  }
  while (g.spawnQueue.length && g.spawnQueue[0].t <= g.phaseTime) {
    const s = g.spawnQueue.shift()!;
    spawnEnemy(g, s.type, s.angle);
  }
  if (g.phaseTime < g.phaseLen) return;
  // The final night only ends once its boss is dead.
  const boss = isFinalNight(g) && g.enemies.find(e => e.def.boss && !e.dead);
  if (boss) {
    if (!g.holdNight) g.fx.toast(`The night won't lift while the ${boss.def.name} stands!`);
    g.holdNight = true;
    g.phaseTime = g.phaseLen;
    return;
  }
  g.holdNight = false;
  startDay(g);
}

export function planNight(g: Game): void {
  const n = g.day, blood = g.bloodMoonNext;
  const len = NIGHT_BASE_LEN + Math.min(22, n * 1.5);
  const sides = n >= 7 ? 3 : n >= 3 ? 2 : 1;
  const base = rand(0, TAU);
  const angles: number[] = [];
  for (let i = 0; i < sides; i++) angles.push(base + (i * TAU) / sides + rand(-0.4, 0.4));

  // Spend a point budget on monsters; tougher types unlock on later nights.
  // Bigger parties face bigger hordes.
  let budget = Math.floor((12 + n * 9 + n * n) * (blood ? 1.5 : 1) * g.partyMul);
  const pool = (Object.keys(ENEMIES) as EnemyId[]).filter(k => ENEMIES[k].minNight <= n && ENEMIES[k].weight > 0);
  const totalW = pool.reduce((s, k) => s + ENEMIES[k].weight, 0);
  const list: EnemyId[] = [];
  while (budget > 0) {
    let r = Math.random() * totalW, type = pool[0];
    for (const k of pool) { r -= ENEMIES[k].weight; if (r <= 0) { type = k; break; } }
    budget -= ENEMIES[type].cost;
    list.push(type);
  }
  const window = len * 0.65;
  const queue: SpawnEntry[] = list.map(type => ({ type, t: Math.pow(Math.random(), 1.2) * window, angle: choice(angles) }));
  const boss = bossFor(n);
  if (boss) queue.push({ type: boss, t: window * 0.35, angle: angles[0] });
  queue.sort((a, b) => a.t - b.t);
  g.nightPlan = { len, angles, queue, bloodMoon: blood };

  const counts = new Map<EnemyId, number>();
  for (const s of queue) counts.set(s.type, (counts.get(s.type) || 0) + 1);
  g.events.emit('scout', {
    night: n,
    final: n === FINAL_NIGHT && !g.won,
    bloodMoon: blood,
    directions: [...new Set(angles.map(compass))].join(' and '),
    groups: [...counts].sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ name: ENEMIES[t].name, count: c, blurb: ENEMIES[t].blurb ?? '' })),
  });
}

export function startNight(g: Game, early = false): void {
  if (early) {
    const bonus = Math.floor((g.phaseLen - g.phaseTime) / 4);
    if (bonus > 0) { g.res.gold += bonus; g.fx.toast(`Eager defender: +${bonus} gold`); }
  }
  if (!g.nightPlan) planNight(g);
  const plan = g.nightPlan!;
  g.phase = 'night';
  g.phaseTime = 0;
  g.phaseLen = plan.len;
  g.spawnAngles = plan.angles;
  g.spawnQueue = plan.queue;
  g.bloodMoon = plan.bloodMoon;
  g.bloodMoonNext = false;
  onNightfall(g);

  const dirs = [...new Set(plan.angles.map(compass))].join(' and ');
  const boss = plan.queue.find(s => ENEMIES[s.type].boss);
  const final = isFinalNight(g);
  g.events.emit('banner', {
    title: (final ? 'Final Night' : plan.bloodMoon ? 'Blood Moon' : '') + (final || plan.bloodMoon ? ' · ' : '') + `Night ${g.day}`,
    sub: (boss ? `The ${ENEMIES[boss.type].name} ${final ? 'comes for the Hearth. Slay it to win!' : 'stirs…'} ` : '')
      + `They come from the ${dirs}!` + (plan.bloodMoon ? ' Double rewards tonight.' : ''),
    danger: true,
  });
}

function startDay(g: Game): void {
  g.stats.nights++;
  const survived = g.day;
  if (survived === FINAL_NIGHT && !g.won) {
    g.won = true;
    g.wonAt = g.time;
    g.events.emit('victory', undefined);
  }
  const bonus = 8 * survived * (g.bloodMoon ? 2 : 1);
  g.day++;
  g.phase = 'day';
  g.phaseTime = 0;
  g.phaseLen = DAY_LEN;
  g.spawnQueue = [];
  g.nightPlan = null;
  g.bloodMoon = false;
  g.res.gold += bonus;
  g.world.regrow();
  const event = onDawn(g);
  g.events.emit('banner', {
    title: `Day ${g.day}`,
    sub: `You survived night ${survived}! +${bonus} gold.` + (event ? ` ${event}` : ''),
  });
}

function spawnEnemy(g: Game, type: EnemyId, angle: number): void {
  // Just beyond the lit area around the base, so the action starts quickly.
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  for (let tries = 0; tries < 12; tries++) {
    const a = angle + rand(-0.3, 0.3), r = 1050 - rand(0, 160);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (!ENEMIES[type].flying && g.world.blocked(tileOf(x), tileOf(y))) continue;
    g.enemies.push(new Enemy(g, type, x, y, g.day));
    if (ENEMIES[type].boss) g.fx.toast(`⚠ A ${ENEMIES[type].name} has appeared!`);
    return;
  }
}

/** 0 (full day) .. DARKNESS_MAX (deep night), with dusk and dawn transitions. */
export function darkness(g: Game): number {
  if (g.holdNight) return DARKNESS_MAX;
  const rem = g.phaseLen - g.phaseTime;
  if (g.phase === 'night') return rem < 6 ? DARKNESS_MAX * (rem / 6) : DARKNESS_MAX;
  return rem < DUSK ? DARKNESS_MAX * (1 - rem / DUSK) : 0;
}
