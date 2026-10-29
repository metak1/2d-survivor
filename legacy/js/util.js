'use strict';
// ---------------------------------------------------------------------------
// Math helpers, a binary heap for pathfinding, and keyboard/mouse input.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];

function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Small seeded PRNG so world generation is reproducible from a seed.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class MinHeap {
  constructor() { this.keys = []; this.vals = []; this.lastKey = 0; }
  get size() { return this.keys.length; }
  push(k, v) {
    const K = this.keys, V = this.vals;
    let i = K.length;
    K.push(k); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.keys, V = this.vals;
    const top = V[0];
    this.lastKey = K[0];
    const k = K.pop(), v = V.pop();
    const n = K.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && K[r] < K[l] ? r : l;
        if (K[c] >= k) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = k; V[i] = v;
    }
    return top;
  }
}

// Keys are tracked by physical position (event.code), so WASD becomes ZQSD on AZERTY automatically.
const Input = {
  keys: new Set(),
  pressed: new Set(),
  mx: 0, my: 0,
  down: false, rdown: false, clicked: false, rclicked: false, wheel: 0,
  layout: null,

  init(canvas) {
    const block = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', e => {
      if (block.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.down = this.rdown = false; });
    addEventListener('mousemove', e => { this.mx = e.clientX; this.my = e.clientY; });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { this.down = true; this.clicked = true; }
      else if (e.button === 2) { this.rdown = true; this.rclicked = true; }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.down = false;
      else if (e.button === 2) this.rdown = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then(m => {
        this.layout = m;
        if (typeof UI !== 'undefined') UI.refreshKeyLabels();
      }).catch(() => {});
    }
  },

  // Human label for a physical key, respecting the user's keyboard layout when the browser exposes it.
  label(code) {
    if (code === 'Space') return 'Space';
    if (code === 'Escape') return 'Esc';
    const l = this.layout && this.layout.get(code);
    if (l) return l.toUpperCase();
    return code.replace('Key', '').replace('Digit', '');
  },

  isDown(code) { return this.keys.has(code); },
  wasPressed(code) { return this.pressed.has(code); },
  endFrame() { this.pressed.clear(); this.clicked = this.rclicked = false; this.wheel = 0; },
};
