import type { PadConfig, SampleMeta } from '../types';
import { GROUP_META } from '../types';
import { h } from './dom';

interface PadCell {
  root: HTMLButtonElement;
  label: HTMLElement;
  groupTag: HTMLElement;
  modeTag: HTMLElement;
  meta: HTMLElement;
  level: HTMLElement;
  index: number;
}

export interface PadGridHandlers {
  onPress: (index: number, velocity: number) => void;
  onRelease: (index: number) => void;
  onSelect: (index: number) => void;
}

const MODE_SHORT: Record<string, string> = {
  oneshot: '1SHOT',
  gate: 'GATE',
  toggle: 'TOGGLE',
  loop: 'LOOP',
};

export class PadGrid {
  private cells: PadCell[] = [];
  private selected = 0;
  private levels: Float32Array<ArrayBuffer> = new Float32Array(16);
  private lastLevels = new Float32Array(16).fill(-1);

  constructor(
    private host: HTMLElement,
    private handlers: PadGridHandlers,
  ) {
    for (let i = 0; i < 16; i++) {
      const root = h('button', 'pad');
      root.type = 'button';
      root.dataset.pad = String(i);
      root.setAttribute('aria-label', `Pad ${i + 1}`);

      const halo = h('span', 'pad-halo');
      const top = h('span', 'pad-top');
      const idx = h('span', 'pad-idx', String(i + 1).padStart(2, '0'));
      const modeTag = h('span', 'pad-mode', '1SHOT');
      top.append(idx, modeTag);

      const label = h('span', 'pad-label', 'Empty');
      const meta = h('span', 'pad-meta');

      const groupTag = h('span', 'pad-group', 'DIV');
      const foot = h('span', 'pad-foot');
      const led = h('span', 'pad-led');
      const level = h('span', 'pad-level');
      led.appendChild(level);
      foot.append(groupTag, led);

      root.append(halo, top, label, meta, foot);

      const press = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const rect = root.getBoundingClientRect();
        const rel = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.7;
        const velocity = Math.max(0.35, Math.min(1, 0.4 + rel * 0.6));
        root.setPointerCapture(event.pointerId);
        this.handlers.onSelect(i);
        this.handlers.onPress(i, velocity);
        root.classList.add('is-held');
      };

      const release = () => {
        root.classList.remove('is-held');
        this.handlers.onRelease(i);
      };

      root.addEventListener('pointerdown', press);
      root.addEventListener('pointerup', release);
      root.addEventListener('pointercancel', release);
      root.addEventListener('lostpointercapture', release);
      root.addEventListener('contextmenu', (event) => event.preventDefault());
      root.addEventListener('focus', () => this.handlers.onSelect(i));

      this.host.appendChild(root);
      this.cells.push({ root, label, groupTag, modeTag, meta, level, index: i });
    }
  }

  sync(pads: PadConfig[], registry: Map<string, SampleMeta>): void {
    pads.forEach((pad, index) => {
      const cell = this.cells[index];
      if (!cell) return;
      const meta = pad.sampleId ? registry.get(pad.sampleId) : null;
      const color = GROUP_META[pad.group]?.color ?? '#64748b';
      cell.root.style.setProperty('--c', color);
      cell.root.style.setProperty('--c-dim', hexToRgba(color, 0.18));
      cell.root.style.setProperty('--c-mid', hexToRgba(color, 0.42));

      cell.label.textContent = pad.label || 'Empty';
      cell.groupTag.textContent = GROUP_META[pad.group]?.short ?? 'DIV';
      cell.modeTag.textContent = MODE_SHORT[pad.mode] ?? '1SHOT';
      cell.meta.textContent = pad.sampleId ? formatMeta(meta, pad) : 'kein Sample';

      cell.root.classList.toggle('is-empty', !pad.sampleId);
      cell.root.classList.toggle('is-choked', pad.choke > 0);
      cell.root.classList.toggle('is-reverse', pad.reverse);
      cell.root.title = `${pad.label}\n${GROUP_META[pad.group]?.label ?? ''} · ${pad.mode}${pad.choke ? ` · Choke ${pad.choke}` : ''}`;
    });
  }

  setSelected(index: number): void {
    this.selected = index;
    this.cells.forEach((cell, i) => cell.root.classList.toggle('is-selected', i === index));
  }

  getSelected(): number {
    return this.selected;
  }

  flash(index: number, velocity: number): void {
    const cell = this.cells[index];
    if (!cell) return;
    cell.root.style.setProperty('--hit', String(Math.max(0.25, velocity)));
    cell.root.classList.remove('is-flash');
    // Reflow erzwingen, damit die Animation neu startet
    void cell.root.offsetWidth;
    cell.root.classList.add('is-flash');
    window.setTimeout(() => cell.root.classList.remove('is-flash'), 260);
    cell.root.classList.add('is-held');
    window.setTimeout(() => cell.root.classList.remove('is-held'), 120);
  }

  releasePad(index: number): void {
    this.cells[index]?.root.classList.remove('is-held');
  }

  tick(levels: Float32Array<ArrayBuffer>): void {
    this.levels = levels;
    for (let i = 0; i < 16; i++) {
      const cell = this.cells[i];
      if (!cell) continue;
      const value = Math.max(0, Math.min(1, levels[i]));

      // Ausklingen: immer auf 0 zurücksetzen, damit kein Rest-Glow stehen bleibt
      if (value < 0.015) {
        if (this.lastLevels[i] !== 0) {
          this.lastLevels[i] = 0;
          cell.root.style.setProperty('--lvl', '0');
          cell.root.classList.remove('is-lit');
          cell.level.style.transform = 'scaleX(0.02)';
        }
        continue;
      }

      // Nur schreiben, wenn sich der Pegel sichtbar ändert (Style-Recalc sparen)
      if (Math.abs(value - this.lastLevels[i]) < 0.012) continue;
      this.lastLevels[i] = value;
      cell.root.style.setProperty('--lvl', value.toFixed(3));
      cell.root.classList.toggle('is-lit', true);
      cell.level.style.transform = `scaleX(${value.toFixed(3)})`;
    }
  }

  getLevels(): Float32Array<ArrayBuffer> {
    return this.levels;
  }
}

function formatMeta(meta: SampleMeta | null | undefined, pad: PadConfig): string {
  if (!meta) return pad.sampleId ? 'Sample fehlt' : 'kein Sample';
  if (meta.source === 'preset') return pad.reverse ? 'REV · Preset' : 'Preset';
  const format = meta.sampleRate ? `${Math.round(meta.sampleRate / 1000)}k` : '';
  const bits = meta.bits ? `${meta.bits}bit` : '';
  const info = [format, bits].filter(Boolean).join('/');
  return info ? `${info}${pad.reverse ? ' · REV' : ''}` : pad.reverse ? 'REV' : 'User';
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
