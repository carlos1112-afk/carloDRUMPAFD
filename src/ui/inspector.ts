import type { PadConfig, SampleMeta } from '../types';
import { GROUP_META, GROUP_ORDER, PAD_MODES } from '../types';
import { button, clear, formatSeconds, h } from './dom';

export interface InspectorHandlers {
  patch: (partial: Partial<PadConfig>) => void;
  assignSample: (sampleId: string) => void;
  loadFile: (file: File) => void;
  preview: () => void;
  clearPad: () => void;
  resetPad: () => void;
  learn: () => void;
  clearLearn: () => void;
  copyPad: () => void;
  pastePad: () => void;
}

export interface InspectorContext {
  pad: PadConfig;
  index: number;
  meta: SampleMeta | null;
  registry: Map<string, SampleMeta>;
  presetGroups: { label: string; entries: SampleMeta[] }[];
  userSamples: SampleMeta[];
  midiText: string;
  canPaste: boolean;
}

interface RangeSpec {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
}

export class Inspector {
  private waveform: HTMLCanvasElement | null = null;

  constructor(
    private host: HTMLElement,
    private handlers: InspectorHandlers,
  ) {}

  render(ctx: InspectorContext): void {
    clear(this.host);
    const { pad, index, meta } = ctx;
    const color = GROUP_META[pad.group]?.color ?? '#64748b';
    this.host.style.setProperty('--pad-color', color);

    /* Kopf */
    const head = h('div', 'insp-head');
    const badge = h('div', 'insp-badge', `PAD ${String(index + 1).padStart(2, '0')}`);
    badge.style.setProperty('--c', color);
    const titleWrap = h('div', 'insp-title');
    const title = h('input', 'insp-name') as HTMLInputElement;
    title.value = pad.label;
    title.setAttribute('aria-label', 'Pad-Name');
    title.addEventListener('change', () => this.handlers.patch({ label: title.value.slice(0, 24) }));
    const sub = h('div', 'insp-sub');
    const groupSelect = h('select', 'chip-select') as HTMLSelectElement;
    for (const group of GROUP_ORDER) {
      const option = h('option', '', GROUP_META[group].label) as HTMLOptionElement;
      option.value = group;
      option.selected = group === pad.group;
      groupSelect.appendChild(option);
    }
    groupSelect.addEventListener('change', () =>
      this.handlers.patch({ group: groupSelect.value as PadConfig['group'] }),
    );
    const sampleInfo = h(
      'span',
      'insp-meta',
      meta
        ? [formatSeconds(meta.duration ?? 0), meta.sampleRate ? `${Math.round(meta.sampleRate / 1000)} kHz` : '', meta.bits ? `${meta.bits} bit` : '', meta.channels ? (meta.channels > 1 ? 'stereo' : 'mono') : '']
            .filter(Boolean)
            .join(' · ')
        : 'kein Sample geladen',
    );
    sub.append(groupSelect, sampleInfo);
    titleWrap.append(title, sub);
    const previewBtn = button('▶', 'icon-btn icon-btn-preview', () => this.handlers.preview());
    previewBtn.title = 'Pad anspielen';
    head.append(badge, titleWrap, previewBtn);

    /* Waveform */
    const waveWrap = h('div', 'wave-wrap');
    this.waveform = h('canvas', 'wave') as HTMLCanvasElement;
    this.waveform.width = 640;
    this.waveform.height = 96;
    const startLine = h('span', 'wave-start');
    startLine.style.left = `${pad.start * 100}%`;
    waveWrap.append(this.waveform, startLine);

    /* Sound */
    const soundSection = h('section', 'insp-section');
    soundSection.append(h('h3', '', 'Sound'));
    const picker = h('div', 'picker-row');
    const select = h('select', 'select-full') as HTMLSelectElement;
    const placeholder = h('option', '', '— Sample wählen —') as HTMLOptionElement;
    placeholder.value = '';
    select.appendChild(placeholder);
    for (const group of ctx.presetGroups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;
      for (const entry of group.entries) {
        const option = h('option', '', entry.name) as HTMLOptionElement;
        option.value = entry.id;
        option.selected = entry.id === pad.sampleId;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    if (ctx.userSamples.length) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Eigene / gescannte Samples';
      for (const entry of ctx.userSamples) {
        const option = h('option', '', entry.name) as HTMLOptionElement;
        option.value = entry.id;
        option.selected = entry.id === pad.sampleId;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    select.addEventListener('change', () => {
      if (select.value) this.handlers.assignSample(select.value);
    });
    picker.append(select);

    const actions = h('div', 'picker-actions');
    const fileInput = h('input') as HTMLInputElement;
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.handlers.loadFile(file);
      fileInput.value = '';
    });
    const loadBtn = button('Datei…', 'btn btn-ghost btn-small', () => fileInput.click());
    const copyBtn = button('Kopieren', 'btn btn-ghost btn-small', () => this.handlers.copyPad());
    const pasteBtn = button('Einsetzen', 'btn btn-ghost btn-small', () => this.handlers.pastePad());
    pasteBtn.disabled = !ctx.canPaste;
    const clearBtn = button('Leeren', 'btn btn-ghost btn-small', () => this.handlers.clearPad());
    actions.append(loadBtn, copyBtn, pasteBtn, clearBtn, fileInput);
    soundSection.append(picker, actions);

    /* Trigger */
    const trigger = h('section', 'insp-section');
    trigger.append(h('h3', '', 'Trigger'));
    const modes = h('div', 'seg seg-full');
    for (const mode of PAD_MODES) {
      const modeBtn = h('button', `seg-btn${mode.id === pad.mode ? ' is-active' : ''}`, mode.label);
      modeBtn.type = 'button';
      modeBtn.title = mode.hint;
      modeBtn.addEventListener('click', () => this.handlers.patch({ mode: mode.id }));
      modes.appendChild(modeBtn);
    }
    trigger.append(modes);

    trigger.append(
      this.toggle('Velocity (Anschlag)', pad.velocitySensitive, (value) =>
        this.handlers.patch({ velocitySensitive: value }),
      ),
      this.range({
        label: 'Fix-Velocity',
        value: pad.fixedVelocity,
        min: 0.05,
        max: 1,
        step: 0.01,
        format: (value) => `${Math.round(value * 127)}`,
        onInput: (value) => this.handlers.patch({ fixedVelocity: value }),
      }),
      this.select('Choke-Gruppe', pad.choke, [
        { value: 0, label: 'Aus' },
        { value: 1, label: 'Gruppe 1' },
        { value: 2, label: 'Gruppe 2' },
        { value: 3, label: 'Gruppe 3' },
        { value: 4, label: 'Gruppe 4' },
      ], (value) => this.handlers.patch({ choke: value })),
      this.select('Roll / Retrigger', pad.roll, [
        { value: 0, label: 'Aus' },
        { value: 0.25, label: '1/16 · 2× Repeat' },
        { value: 0.125, label: '1/32 · 4× Repeat' },
      ], (value) => this.handlers.patch({ roll: value })),
      this.toggle('Loop synct auf BPM', pad.sync, (value) => this.handlers.patch({ sync: value }), pad.mode === 'loop'),
      this.toggle('Reverse', pad.reverse, (value) => this.handlers.patch({ reverse: value })),
    );

    /* Klang */
    const tone = h('section', 'insp-section');
    tone.append(h('h3', '', 'Klang'));
    tone.append(
      this.range({
        label: 'Level',
        value: pad.gain,
        min: 0,
        max: 1.4,
        step: 0.01,
        format: (value) => (value <= 0.001 ? '−∞' : `${(20 * Math.log10(value)).toFixed(0)} dB`),
        onInput: (value) => this.handlers.patch({ gain: value }),
      }),
      this.range({
        label: 'Pan',
        value: pad.pan,
        min: -1,
        max: 1,
        step: 0.01,
        format: (value) => (Math.abs(value) < 0.02 ? 'C' : `${value < 0 ? 'L' : 'R'}${Math.round(Math.abs(value) * 100)}`),
        onInput: (value) => this.handlers.patch({ pan: value }),
      }),
      this.range({
        label: 'Pitch',
        value: pad.pitch,
        min: -24,
        max: 24,
        step: 1,
        format: (value) => `${value > 0 ? '+' : ''}${value} st`,
        onInput: (value) => this.handlers.patch({ pitch: value }),
      }),
      this.range({
        label: 'Start',
        value: pad.start,
        min: 0,
        max: 0.95,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)} %`,
        onInput: (value) => this.handlers.patch({ start: value }),
      }),
      this.range({
        label: 'Attack',
        value: pad.attack,
        min: 0,
        max: 0.4,
        step: 0.001,
        format: (value) => formatSeconds(value),
        onInput: (value) => this.handlers.patch({ attack: value }),
      }),
      this.range({
        label: 'Decay',
        value: pad.decay,
        min: 0,
        max: 4,
        step: 0.01,
        format: (value) => (value === 0 ? 'natürlich' : formatSeconds(value)),
        onInput: (value) => this.handlers.patch({ decay: value }),
      }),
      this.range({
        label: 'Release',
        value: pad.release,
        min: 0.01,
        max: 1.5,
        step: 0.01,
        format: (value) => formatSeconds(value),
        onInput: (value) => this.handlers.patch({ release: value }),
      }),
    );

    const filterRow = h('div', 'control-grid');
    const filterType = h('select', 'select-full') as HTMLSelectElement;
    [
      { value: 'none', label: 'Filter: Aus' },
      { value: 'lowpass', label: 'Low-Pass' },
      { value: 'highpass', label: 'High-Pass' },
      { value: 'bandpass', label: 'Band-Pass' },
    ].forEach((option) => {
      const node = h('option', '', option.label) as HTMLOptionElement;
      node.value = option.value;
      node.selected = pad.filterType === option.value;
      filterType.appendChild(node);
    });
    filterType.addEventListener('change', () =>
      this.handlers.patch({ filterType: filterType.value as PadConfig['filterType'] }),
    );
    filterRow.append(filterType);
    tone.append(
      filterRow,
      this.range({
        label: 'Cutoff',
        value: pad.cutoff,
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => {
          if (pad.filterType === 'none' || value >= 0.999) return 'offen';
          return `${Math.round(200 * Math.pow(90, value))} Hz`;
        },
        onInput: (value) => this.handlers.patch({ cutoff: value }),
      }),
      this.range({
        label: 'Reverb Send',
        value: pad.sendReverb,
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)} %`,
        onInput: (value) => this.handlers.patch({ sendReverb: value }),
      }),
      this.range({
        label: 'Delay Send',
        value: pad.sendDelay,
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)} %`,
        onInput: (value) => this.handlers.patch({ sendDelay: value }),
      }),
    );

    /* Hardware */
    const hw = h('section', 'insp-section insp-hw');
    hw.append(h('h3', '', 'Hardware'));
    const learnRow = h('div', 'learn-row');
    learnRow.append(h('span', 'learn-text', ctx.midiText));
    const learnBtn = button('MIDI Learn', 'btn btn-ghost btn-small', () => this.handlers.learn());
    const clearLearnBtn = button('✕', 'btn btn-ghost btn-small', () => this.handlers.clearLearn());
    clearLearnBtn.title = 'Hardware-Binding entfernen';
    learnRow.append(learnBtn, clearLearnBtn);
    hw.append(learnRow);

    const footer = h('div', 'insp-foot');
    const resetBtn = button('Pad zurücksetzen', 'link-btn', () => this.handlers.resetPad());
    footer.append(resetBtn);

    this.host.append(head, waveWrap, soundSection, trigger, tone, hw, footer);
    this.host.classList.toggle('is-empty-pad', !pad.sampleId);
    void meta;
  }

  drawWaveform(buffer: AudioBuffer | null, start: number): void {
    const canvas = this.waveform;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (!buffer) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '500 22px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('kein Sample', width / 2, height / 2 + 8);
      return;
    }

    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    const color = getComputedStyle(this.host).getPropertyValue('--pad-color').trim() || '#6b8cff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      let min = 1;
      let max = -1;
      const startIndex = x * step;
      for (let i = 0; i < step; i++) {
        const value = data[startIndex + i] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const y1 = height / 2 - max * (height / 2) * 0.86;
      const y2 = height / 2 - min * (height / 2) * 0.86;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(start * width, 0, 1, height);
  }

  private range(spec: RangeSpec): HTMLElement {
    const row = h('div', 'control-row');
    const label = h('span', 'control-label', spec.label);
    const value = h('span', 'control-value', spec.format(spec.value));
    const input = h('input', 'range range-compact') as HTMLInputElement;
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      value.textContent = spec.format(next);
      spec.onInput(next);
    });
    const head = h('div', 'control-head');
    head.append(label, value);
    row.append(head, input);
    return row;
  }

  private toggle(label: string, checked: boolean, onChange: (value: boolean) => void, enabled = true): HTMLElement {
    const row = h('label', 'switch-row');
    const text = h('span', 'switch-label', label);
    const wrap = h('span', 'switch');
    const input = h('input') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = !enabled;
    input.addEventListener('change', () => onChange(input.checked));
    const track = h('span', 'switch-track');
    wrap.append(input, track);
    row.append(text, wrap);
    if (!enabled) row.classList.add('is-disabled');
    return row;
  }

  private select(
    label: string,
    value: number,
    options: { value: number; label: string }[],
    onChange: (value: number) => void,
  ): HTMLElement {
    const row = h('div', 'control-row control-row-inline');
    const head = h('div', 'control-head');
    head.append(h('span', 'control-label', label));
    const select = h('select', 'select-inline') as HTMLSelectElement;
    for (const option of options) {
      const node = h('option', '', option.label) as HTMLOptionElement;
      node.value = String(option.value);
      node.selected = option.value === value;
      select.appendChild(node);
    }
    select.addEventListener('change', () => onChange(Number(select.value)));
    row.append(head, select);
    return row;
  }
}
