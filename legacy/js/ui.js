'use strict';
// ---------------------------------------------------------------------------
// DOM UI: class select, HUD, spell bar, build bar, talents, pause, game over.
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const setStyle = (el, k, v) => { const key = '_s' + k; if (el[key] !== v) { el[key] = v; el.style[k] = v; } };

function loadBest() {
  try { return JSON.parse(localStorage.getItem('nightfall_best')) || {}; } catch { return {}; }
}
function saveBest(b) {
  try { localStorage.setItem('nightfall_best', JSON.stringify(b)); } catch { /* storage unavailable */ }
}

function costHtml(cost) {
  return Object.keys(cost).map(k => `<span>${cost[k]}${RES_ICONS[k]}</span>`).join('');
}

const UI = {
  frame: 0,

  init() {
    this.buildMenu();
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart').onclick = () => { this.hideScreens(); newGame(G.cls); };
    $('btn-menu').onclick = () => this.toMenu();
    $('btn-again').onclick = () => { this.hideScreens(); newGame(G.cls); };
    $('btn-over-menu').onclick = () => this.toMenu();
    $('btn-talents-close').onclick = () => this.closeTalents();
    $('btn-open-talents').onclick = () => this.openTalents();
    this.refreshKeyLabels();
  },

  toMenu() {
    G.state = 'menu';
    this.hideScreens();
    $('hud').classList.add('hidden');
    this.buildMenu();
    $('menu').classList.remove('hidden');
  },

  hideScreens() {
    for (const id of ['menu', 'pause', 'talents', 'gameover']) $(id).classList.add('hidden');
  },

  buildMenu() {
    const wrap = $('class-cards');
    wrap.innerHTML = '';
    for (const [id, c] of Object.entries(CLASSES)) {
      const card = document.createElement('button');
      card.className = 'class-card';
      card.style.setProperty('--cc', c.color);
      card.innerHTML = `
        <div class="cc-portrait"><canvas width="96" height="96"></canvas></div>
        <h3>${c.name}</h3>
        <div class="cc-tag">${c.tagline}</div>
        <p>${c.desc}</p>
        <div class="cc-stats"><span>❤ ${c.hp}</span><span>👟 ${c.speed}</span></div>
        <ul class="cc-spells">
          ${[{ ...c.basic, key: 'LMB' }, { ...c.mobility, key: 'Space' }, ...c.spells].map(s =>
            `<li title="${s.desc}"><span class="ico">${s.icon}</span><b>${s.name}</b><kbd data-code="${s.key}">${s.key === 'LMB' ? 'LMB' : Input.label(s.key)}</kbd></li>`).join('')}
        </ul>`;
      card.onclick = () => { this.hideScreens(); newGame(id); };
      wrap.appendChild(card);
      drawPortrait(card.querySelector('canvas'), id);
    }
    const best = loadBest();
    $('best').textContent = best.nights ? `Best: survived ${best.nights} night${best.nights === 1 ? '' : 's'} as ${best.cls} (${best.kills} kills)` : '';
    $('controls-menu').innerHTML = this.controlsHtml();
  },

  controlsHtml() {
    const k = c => `<kbd>${Input.label(c)}</kbd>`;
    return `
      <div>${k('KeyW')}${k('KeyA')}${k('KeyS')}${k('KeyD')} Move</div>
      <div><kbd>LMB</kbd> Attack / harvest</div>
      <div>${k('KeyQ')}${k('KeyE')}${k('KeyR')} Spells</div>
      <div><kbd>Space</kbd> Dodge</div>
      <div>${k('KeyB')} Build menu · <kbd>1</kbd>–<kbd>0</kbd> pick</div>
      <div>${k('KeyT')} Talents</div>
      <div>${k('KeyN')} Call the night early</div>
      <div><kbd>Esc</kbd> Pause</div>`;
  },

  refreshKeyLabels() {
    for (const el of document.querySelectorAll('[data-code]')) {
      const c = el.dataset.code;
      if (c !== 'LMB') el.textContent = Input.label(c);
    }
    if ($('controls-menu')) $('controls-menu').innerHTML = this.controlsHtml();
    if ($('controls-pause')) $('controls-pause').innerHTML = this.controlsHtml();
  },

  startGame() {
    this.hideScreens();
    $('hud').classList.remove('hidden');
    $('toasts').innerHTML = '';
    $('banner').classList.add('hidden');
    const c = CLASSES[G.cls];
    setText($('hud-class'), c.name);
    $('hud-player').style.setProperty('--cc', c.color);
    this.buildSpellbar();
    this.buildBuildbar();
  },

  buildSpellbar() {
    const c = CLASSES[G.cls], bar = $('spellbar');
    bar.innerHTML = '';
    this.slots = [];
    const all = [{ sp: c.basic, key: 'LMB', basic: true }, { sp: c.mobility, key: 'Space' }, ...c.spells.map(s => ({ sp: s, key: s.key }))];
    for (const { sp, key, basic } of all) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<div class="ico">${sp.icon}</div><div class="cd"></div><div class="cdt"></div>
        <kbd data-code="${key}">${key === 'LMB' ? 'LMB' : Input.label(key)}</kbd>
        <div class="tip"><b>${sp.name}</b>${sp.cd && !basic ? ` <i>${sp.cd}s</i>` : ''}<br>${sp.desc}</div>`;
      bar.appendChild(el);
      this.slots.push({ el, sp, basic, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt') });
    }
  },

  buildBuildbar() {
    const bar = $('buildbar');
    bar.innerHTML = '';
    this.bslots = [];
    BUILD_SLOTS.forEach((id, i) => {
      const def = BUILDINGS[id] || BUILD_TOOLS[id];
      const el = document.createElement('button');
      el.className = 'bslot';
      el.innerHTML = `<kbd>${BUILD_KEYS[i].replace('Digit', '')}</kbd><div class="ico">${def.icon}</div>
        <div class="bname">${def.name}</div><div class="bcost"></div>
        <div class="tip"><b>${def.name}</b>${def.hp ? ` <i>${def.hp} HP</i>` : ''}<br>${def.desc}</div>`;
      el.onmousedown = e => { e.stopPropagation(); G.buildSel = id; };
      bar.appendChild(el);
      this.bslots.push({ el, id, cost: el.querySelector('.bcost') });
    });
  },

  update() {
    if (G.state === 'menu' || !G.player) return;
    this.frame++;
    const p = G.player, s = p.stats;

    setText($('hud-level'), `Lv ${p.level}`);
    setStyle($('hp-fill'), 'width', `${(100 * Math.max(0, p.hp) / s.maxHp).toFixed(1)}%`);
    setText($('hp-text'), `${Math.ceil(Math.max(0, p.hp))} / ${s.maxHp}`);
    setStyle($('xp-fill'), 'width', `${(100 * p.xp / p.xpNext).toFixed(1)}%`);
    setText($('xp-text'), `${p.xp} / ${p.xpNext} XP`);
    $('talent-alert').classList.toggle('hidden', p.points <= 0);
    setText($('talent-count'), String(p.points));

    for (const k of ['wood', 'stone', 'gold']) setText($('res-' + k), String(Math.floor(G.res[k])));

    const night = G.phase === 'night';
    const rem = Math.max(0, G.phaseLen - G.phaseTime);
    setText($('cycle-label'), night ? `🌙 Night ${G.day}` : `☀️ Day ${G.day}`);
    setStyle($('cycle-fill'), 'width', `${(100 * G.phaseTime / G.phaseLen).toFixed(1)}%`);
    $('hud-cycle').classList.toggle('night', night);
    const left = G.enemies.length + G.spawnQueue.length;
    setText($('cycle-sub'), night
      ? `Dawn in ${Math.ceil(rem)}s · ${left} monster${left === 1 ? '' : 's'}`
      : `Nightfall in ${Math.ceil(rem)}s · ${Input.label('KeyN')} to start now`);

    const h = G.hearth;
    setStyle($('hearth-fill'), 'width', `${(100 * Math.max(0, h.hp) / h.maxHp).toFixed(1)}%`);
    setText($('hearth-text'), `${Math.ceil(Math.max(0, h.hp))} / ${h.maxHp}`);
    $('hearth-panel').classList.toggle('danger', h.hp / h.maxHp < 0.35);

    for (const sl of this.slots) {
      let frac, rem2;
      if (sl.basic) { frac = Math.max(0, p.atkTimer) / (sl.sp.cd / s.atkSpeed); rem2 = 0; }
      else { frac = p.cooldownFrac(sl.sp); rem2 = p.cds[sl.sp.id] || 0; }
      setStyle(sl.cd, 'height', `${(Math.min(1, frac) * 100).toFixed(0)}%`);
      setText(sl.cdt, rem2 > 0.05 ? (rem2 >= 1 ? Math.ceil(rem2) : rem2.toFixed(1)) + '' : '');
      sl.el.classList.toggle('ready', frac <= 0);
    }

    $('buildbar').classList.toggle('hidden', !G.buildMode);
    if (G.buildMode) {
      for (const b of this.bslots) {
        b.el.classList.toggle('sel', G.buildSel === b.id);
        if (BUILDINGS[b.id]) {
          const c = buildCost(b.id);
          const html = costHtml(c);
          if (b.cost._h !== html) { b.cost._h = html; b.cost.innerHTML = html; }
          b.el.classList.toggle('poor', !canAfford(c));
        }
      }
    }

    let hint = '';
    if (G.state === 'playing') {
      if (p.dead) hint = `Reviving at the Hearth in ${Math.ceil(p.respawn)}s…`;
      else if (G.buildMode) hint = `LMB place · drag for walls · wheel / 1–0 switch · RMB or ${Input.label('KeyB')} to close`;
      else if (G.day === 1 && G.phase === 'day' && G.stats.gathered < 30) hint = 'Attack trees 🌳 and rocks 🪨 to gather resources';
      else if (G.day === 1 && G.phase === 'day' && G.stats.built === 0) hint = `Press ${Input.label('KeyB')} to build walls and towers around the Hearth`;
    }
    setText($('hint'), hint);
    $('hint').classList.toggle('hidden', !hint);
    $('death').classList.toggle('hidden', !p.dead || G.state !== 'playing');
    if (p.dead) setText($('death'), `You have fallen — reviving in ${Math.ceil(p.respawn)}s`);

    if (this.frame % 4 === 0) drawMinimap($('minimap'));
  },

  banner(title, sub, danger) {
    const b = $('banner');
    setText($('banner-title'), title);
    setText($('banner-sub'), sub);
    b.classList.toggle('danger', !!danger);
    b.classList.remove('hidden', 'show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add('hidden'), 4200);
  },

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  },

  // ----------------------------- Talents ----------------------------------
  openTalents() {
    if (G.state !== 'playing') return;
    G.state = 'talents';
    this.renderTalents();
    $('talents').classList.remove('hidden');
  },

  closeTalents() {
    $('talents').classList.add('hidden');
    if (G.state === 'talents') G.state = 'playing';
  },

  renderTalents() {
    const p = G.player, trees = TALENTS[p.cls];
    $('talent-points').textContent = p.points;
    const wrap = $('talent-trees');
    wrap.innerHTML = '';
    for (const tree of trees) {
      const spent = tree.talents.reduce((n, t) => n + (p.talents[t.id] || 0), 0);
      const col = document.createElement('div');
      col.className = 'tree';
      col.style.setProperty('--tc', tree.color);
      col.innerHTML = `<h3>${tree.name} <span>${spent}</span></h3>`;
      tree.talents.forEach((t, i) => {
        const rank = p.talents[t.id] || 0, req = i * TALENT_TIER_REQ;
        const unlocked = spent >= req, maxed = rank >= t.max;
        const can = unlocked && !maxed && p.points > 0;
        const btn = document.createElement('button');
        btn.className = 'talent' + (maxed ? ' maxed' : '') + (!unlocked ? ' locked' : '') + (can ? ' can' : '') + (rank ? ' has' : '');
        btn.innerHTML = `<div class="t-ico">${t.icon}</div><div class="t-body">
          <div class="t-head"><b>${t.name}</b><span class="t-rank">${rank}/${t.max}</span></div>
          <div class="t-desc">${t.desc}</div>
          ${!unlocked ? `<div class="t-req">Requires ${req} points in ${tree.name}</div>` : ''}</div>`;
        btn.onclick = () => {
          if (!can) return;
          p.talents[t.id] = rank + 1;
          p.points--;
          p.recalc();
          this.renderTalents();
        };
        col.appendChild(btn);
        if (i < tree.talents.length - 1) {
          const link = document.createElement('div');
          link.className = 'link' + (spent >= (i + 1) * TALENT_TIER_REQ ? ' on' : '');
          col.appendChild(link);
        }
      });
      wrap.appendChild(col);
    }
  },

  // ----------------------------- Pause / game over ------------------------
  pause() {
    if (G.state !== 'playing') return;
    G.state = 'paused';
    $('controls-pause').innerHTML = this.controlsHtml();
    $('pause').classList.remove('hidden');
  },

  resume() {
    $('pause').classList.add('hidden');
    if (G.state === 'paused') G.state = 'playing';
  },

  gameOver() {
    const p = G.player, n = G.stats.nights;
    const best = loadBest();
    const isBest = n > 0 && (!best.nights || n > best.nights || (n === best.nights && G.stats.kills > best.kills));
    if (isBest) saveBest({ nights: n, kills: G.stats.kills, cls: CLASSES[G.cls].name });
    $('over-stats').innerHTML = `
      <div><b>${n}</b><span>Night${n === 1 ? '' : 's'} survived</span></div>
      <div><b>${G.stats.kills}</b><span>Monsters slain</span></div>
      <div><b>${p.level}</b><span>Level reached</span></div>
      <div><b>${G.stats.built}</b><span>Buildings raised</span></div>`;
    $('over-best').textContent = isBest ? '★ New personal best!' : best.nights ? `Best: ${best.nights} nights` : '';
    $('gameover').classList.remove('hidden');
    $('hud').classList.add('hidden');
  },
};

// Small class portrait for the menu cards, drawn with the same shapes as in-game.
function drawPortrait(cv, cls) {
  const c = cv.getContext('2d'), d = CLASSES[cls];
  c.translate(48, 52);
  c.scale(2, 2);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath(); c.ellipse(0, 12, 14, 6, 0, 0, TAU); c.fill();
  c.fillStyle = d.color;
  c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke();
  c.fillStyle = d.accent;
  c.beginPath(); c.arc(3, -2, 6, 0, TAU); c.fill();
  c.rotate(-0.5);
  if (cls === 'warrior') {
    c.fillStyle = '#6b4a2b'; c.fillRect(10, -2, 7, 4);
    c.fillStyle = '#d7dde4'; c.fillRect(17, -2.5, 16, 5);
    c.fillStyle = '#f2c879'; c.fillRect(15, -6, 3, 12);
  } else if (cls === 'mage') {
    c.strokeStyle = '#7a5a3a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(4, 9); c.lineTo(22, 9); c.stroke();
    c.fillStyle = '#a0e6ff'; c.beginPath(); c.arc(23, 9, 5, 0, TAU); c.fill();
  } else {
    c.strokeStyle = '#8a5f33'; c.lineWidth = 3;
    c.beginPath(); c.arc(8, 0, 12, -1.2, 1.2); c.stroke();
  }
}
