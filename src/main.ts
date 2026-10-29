import Phaser from 'phaser';
import './styles.css';
import { App, pause, startGame } from './app';
import { Input } from './core/input';
import { BootScene } from './render/BootScene';
import { GameScene } from './render/GameScene';
import { UI } from './ui/ui';

UI.init();

App.phaser = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#0c120b',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, GameScene],
  // Input is handled by core/input.ts so keys follow physical layout; Phaser's own isn't needed.
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  banner: false,
});

App.phaser.events.once(Phaser.Core.Events.READY, () => Input.init(App.phaser!.canvas));
// Solo pauses when the tab is hidden; an online run carries on regardless.
document.addEventListener('visibilitychange', () => { if (document.hidden && !App.net) pause(); });

// Dev-only handle for the console and automated tests; stripped from production builds.
if (import.meta.env.DEV) {
  Promise.all([import('./sim/enemy'), import('./data/talents'), import('./app')]).then(([{ Enemy }, { TALENTS }, { me }]) =>
    Object.assign(window, { __nb: { App, startGame, Enemy, TALENTS, me } }));
}
