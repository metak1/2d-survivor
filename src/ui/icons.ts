// Renders an IconRef as HTML: a cell of the Raven 32x32 icon sheet, or an emoji placeholder.

import type { IconRef } from '../data/types';

const SHEET = import.meta.env.BASE_URL + 'assets/icons/raven32.png';
const COLS = 16, CELL = 32, SHEET_W = COLS * CELL;

let sheetOk: boolean | null = null;
const probe = new Image();
probe.onload = () => { sheetOk = true; };
probe.onerror = () => { sheetOk = false; };
probe.src = SHEET;

/** Fallback glyph when the icon sheet hasn't been imported. */
const MISSING = '◆';

export function iconHtml(icon: IconRef, size = 32): string {
  if (typeof icon === 'string') return `<span class="icon emoji" style="font-size:${Math.round(size * 0.8)}px">${icon}</span>`;
  if (sheetOk === false) return `<span class="icon emoji" style="font-size:${Math.round(size * 0.6)}px">${MISSING}</span>`;
  const k = size / CELL, x = (icon % COLS) * size, y = Math.floor(icon / COLS) * size;
  return `<span class="icon" style="width:${size}px;height:${size}px;background-image:url('${SHEET}');` +
    `background-size:${SHEET_W * k}px auto;background-position:-${x}px -${y}px"></span>`;
}
