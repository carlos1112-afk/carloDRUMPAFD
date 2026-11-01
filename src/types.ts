/* ------------------------------------------------------------------
 * PADFORGE – zentrale Typen, Gruppen-Metadaten und Defaults
 * ------------------------------------------------------------------ */

export type SoundGroup =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'perc'
  | 'bass'
  | 'vocal'
  | 'fx'
  | 'loop'
  | 'tonal'
  | 'other';

export interface GroupMeta {
  label: string;
  color: string;
  short: string;
}

export const GROUP_META: Record<SoundGroup, GroupMeta> = {
  kick: { label: 'Kick', color: '#ff4d4d', short: 'KCK' },
  snare: { label: 'Snare', color: '#ffa01f', short: 'SNR' },
  hat: { label: 'Hi-Hat', color: '#38e0ff', short: 'HAT' },
  perc: { label: 'Percussion', color: '#52e07a', short: 'PRC' },
  bass: { label: 'Bass', color: '#b06bff', short: 'BAS' },
  vocal: { label: 'Vocal', color: '#ff6bc4', short: 'VOX' },
  fx: { label: 'FX', color: '#6b8cff', short: 'SFX' },
  loop: { label: 'Loop', color: '#ffd400', short: 'LOP' },
  tonal: { label: 'Tonal', color: '#9fa8ff', short: 'TON' },
  other: { label: 'Sonstiges', color: '#64748b', short: 'DIV' },
};

export const GROUP_ORDER: SoundGroup[] = [
  'kick',
  'snare',
  'hat',
  'perc',
  'bass',
  'tonal',
  'vocal',
  'fx',
  'loop',
  'other',
];

export type PadMode = 'oneshot' | 'gate' | 'toggle' | 'loop';

export type DeckMode = 'play' | 'vinyl';

export const PAD_MODES: { id: PadMode; label: string; hint: string }[] = [
  { id: 'oneshot', label: 'One-Shot', hint: 'spielt einmal komplett durch' },
  { id: 'gate', label: 'Gate', hint: 'klingt nur solange du hältst' },
  { id: 'toggle', label: 'Toggle', hint: 'Start / Stop per Druck' },
  { id: 'loop', label: 'Loop', hint: 'loopt & synct aufs Tempo' },
];

export interface PadConfig {
  sampleId: string | null;
  label: string;
  group: SoundGroup;
  mode: PadMode;
  gain: number;
  pan: number;
  pitch: number;
  attack: number;
  decay: number;
  release: number;
  start: number;
  cutoff: number;
  filterType: 'none' | 'lowpass' | 'highpass' | 'bandpass';
  sendReverb: number;
  sendDelay: number;
  choke: number;
  roll: number;
  velocitySensitive: boolean;
  fixedVelocity: number;
  reverse: boolean;
  sync: boolean;
}

export interface SampleMeta {
  id: string;
  name: string;
  group: SoundGroup;
  sub?: string;
  source: 'preset' | 'user';
  packId: string;
  duration?: number;
  sampleRate?: number;
  bits?: number;
  channels?: number;
  bpm?: number;
}

export type PadBank =
  | 'sampler'
  | 'hotcue'
  | 'padfx'
  | 'beatjump'
  | 'beatloop'
  | 'keyboard'
  | 'keyshift';

export const PAD_BANKS: { id: PadBank; label: string }[] = [
  { id: 'sampler', label: 'Sampler (Standard)' },
  { id: 'hotcue', label: 'Hot Cue' },
  { id: 'padfx', label: 'Pad FX' },
  { id: 'beatjump', label: 'Beat Jump' },
  { id: 'beatloop', label: 'Beat Loop' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'keyshift', label: 'Key Shift' },
];

export interface MidiSettings {
  padBank: PadBank;
  allBanks: boolean;
  shiftStops: boolean;
  ledFeedback: boolean;
  ledMode: 'binary' | 'brightness';
  sysex: boolean;
  inputId: string | null;
  outputId: string | null;
}

export interface AppState {
  version: number;
  kitId: string;
  kitName: string;
  pads: PadConfig[];
  bpm: number;
  quantize: number;
  masterVol: number;
  filter: number;
  reverbReturn: number;
  delayReturn: number;
  midi: MidiSettings;
}

export interface PackPadDef {
  name: string;
  group: SoundGroup;
  sub?: string;
  recipe: string;
  params?: Record<string, number>;
  mode?: PadMode;
  choke?: number;
  pitch?: number;
  gain?: number;
  reverse?: boolean;
  sync?: boolean;
}

export interface PackDef {
  id: string;
  name: string;
  tagline: string;
  bpm: number;
  pads: PackPadDef[];
}

export const DEFAULT_PAD: PadConfig = {
  sampleId: null,
  label: 'Empty',
  group: 'other',
  mode: 'oneshot',
  gain: 0.9,
  pan: 0,
  pitch: 0,
  attack: 0.002,
  decay: 0,
  release: 0.22,
  start: 0,
  cutoff: 1,
  filterType: 'none',
  sendReverb: 0.08,
  sendDelay: 0.05,
  choke: 0,
  roll: 0,
  velocitySensitive: true,
  fixedVelocity: 0.85,
  reverse: false,
  sync: true,
};

export function makePadConfig(def: PackPadDef, packId: string, index: number): PadConfig {
  return {
    ...DEFAULT_PAD,
    sampleId: `preset:${packId}:${index}`,
    label: def.name,
    group: def.group,
    mode: def.mode ?? (def.group === 'loop' ? 'loop' : 'oneshot'),
    choke: def.choke ?? 0,
    pitch: def.pitch ?? 0,
    gain: def.gain ?? 0.9,
    reverse: def.reverse ?? false,
    sync: def.sync ?? true,
    sendReverb: def.group === 'vocal' ? 0.22 : def.group === 'fx' ? 0.3 : 0.07,
    sendDelay: def.group === 'vocal' ? 0.18 : def.group === 'fx' ? 0.14 : 0.04,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
