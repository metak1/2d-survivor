// Keyboard and mouse state. Keys are tracked by physical position (KeyboardEvent.code),
// so WASD becomes ZQSD on AZERTY automatically; labels follow the user's layout when available.

interface LayoutMap { get(code: string): string | undefined }
interface KeyboardWithLayout { getLayoutMap(): Promise<LayoutMap> }

const BLOCKED = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

class InputState {
  private keys = new Set<string>();
  /** Keys pressed since the last endFrame(). */
  pressed = new Set<string>();
  mx = 0;
  my = 0;
  down = false;
  rdown = false;
  clicked = false;
  rclicked = false;
  wheel = 0;
  private layout: LayoutMap | null = null;
  private layoutListeners: (() => void)[] = [];

  init(canvas: HTMLCanvasElement): void {
    addEventListener('keydown', e => {
      if (BLOCKED.has(e.code)) e.preventDefault();
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

    const kb = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
    kb?.getLayoutMap().then(m => {
      this.layout = m;
      for (const fn of this.layoutListeners) fn();
    }).catch(() => { /* layout API unavailable: QWERTY labels */ });
  }

  onLayout(fn: () => void): void { this.layoutListeners.push(fn); }

  /** Human label for a physical key. */
  label(code: string): string {
    if (code === 'Space') return 'Space';
    if (code === 'Escape') return 'Esc';
    if (code === 'LMB') return 'LMB';
    const l = this.layout?.get(code);
    if (l) return l.toUpperCase();
    return code.replace('Key', '').replace('Digit', '');
  }

  isDown(code: string): boolean { return this.keys.has(code); }
  wasPressed(code: string): boolean { return this.pressed.has(code); }
  consume(code: string): void { this.pressed.delete(code); }

  endFrame(): void {
    this.pressed.clear();
    this.clicked = this.rclicked = false;
    this.wheel = 0;
  }
}

export const Input = new InputState();
