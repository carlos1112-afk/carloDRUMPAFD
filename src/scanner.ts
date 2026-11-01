/* ------------------------------------------------------------------
 * PADFORGE – Sample-Pack-Scanner
 *
 * Erkennt die Funktion eines Samples am Dateinamen (EN/DE + gängige
 * Abkürzungen), liest bei WAV zusätzlich das fmt-Chunk (SR/Bit/Channels)
 * und baut daraus automatisch ein spielbares 16-Pad-Kit.
 * ------------------------------------------------------------------ */

import type { SoundGroup } from './types';

export interface WavInfo {
  sampleRate: number;
  bits: number;
  channels: number;
  duration: number;
}

export interface ScanEntry {
  file: File;
  name: string;
  label: string;
  path: string;
  ext: string;
  group: SoundGroup;
  sub: string;
  score: number;
  bpm?: number;
  wav?: WavInfo;
}

export interface ScanResult {
  entries: ScanEntry[];
  byGroup: Map<SoundGroup, ScanEntry[]>;
  plan: (ScanEntry | null)[];
  packName: string;
  folder: string;
  unknown: number;
}

const AUDIO_EXT = ['wav', 'wave', 'aif', 'aiff', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'opus'];

/* --------------------------- Klassifikation ----------------------- */

interface Rule {
  group: SoundGroup;
  sub: string;
  words: string[];
  weight: number;
}

const RULES: Rule[] = [
  { group: 'loop', sub: 'loop', words: ['loop', 'loops', 'groove', 'top', 'full', 'break', 'beat'], weight: 16 },
  { group: 'vocal', sub: 'vocal', words: ['vocal', 'vocals', 'vox', 'voice', 'acap', 'acapella', 'chop', 'hey', 'shout', 'chant', 'ooh', 'aah', 'spoken'], weight: 11 },
  { group: 'fx', sub: 'fx', words: ['fx', 'sfx', 'riser', 'uplifter', 'downlifter', 'sweep', 'noise', 'impact', 'zap', 'laser', 'siren', 'horn', 'alarm', 'glitch', 'swell', 'transition', 'scratch', 'vinyl', 'stop', 'reverse', 'whoosh', 'sweepup', 'sweepdown', 'atmos', 'texture'], weight: 11 },
  { group: 'hat', sub: 'hat', words: ['hat', 'hats', 'hihat', 'hh', 'chh', 'ohh', 'hhcl', 'hhopen', 'hhclosed', 'shaker'], weight: 10 },
  { group: 'kick', sub: 'kick', words: ['kick', 'kicks', 'kik', 'bd', 'bassdrum', 'boom', 'thump', 'punch'], weight: 10 },
  { group: 'snare', sub: 'snare', words: ['snare', 'snares', 'snr', 'sd'], weight: 9 },
  { group: 'bass', sub: 'bass', words: ['bass', 'sub', '808', '909', 'reese', 'wobble', 'moog', 'sinebass', 'subbass'], weight: 9 },
  { group: 'tonal', sub: 'tonal', words: ['stab', 'chord', 'chords', 'keys', 'key', 'piano', 'synth', 'pluck', 'bell', 'blip', 'beep', 'bleep', 'arp', 'lead', 'pad', 'string', 'brass', 'marimba', 'kalimba', 'note', 'tonal', 'melody', 'drone'], weight: 8 },
  { group: 'perc', sub: 'perc', words: ['perc', 'percussion', 'clap', 'claps', 'cp', 'snap', 'rim', 'rimshot', 'tamb', 'tambourine', 'cowbell', 'conga', 'congas', 'bongo', 'bongos', 'timbale', 'clave', 'claves', 'guiro', 'agogo', 'djembe', 'cajon', 'tom', 'toms', 'block', 'woodblock', 'click', 'stomp', 'ride', 'crash', 'cymbal'], weight: 9 },
];

export const GROUP_RULES = RULES;

function normalize(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(Boolean));
}

export function classify(rawName: string): { group: SoundGroup; sub: string; score: number } {
  const normalized = normalize(rawName);
  const tokens = tokenize(normalized);
  let best: { group: SoundGroup; sub: string; score: number } = { group: 'other', sub: 'other', score: 0 };

  for (const rule of RULES) {
    for (const word of rule.words) {
      let hit = false;
      if (word.includes(' ')) {
        hit = normalized.includes(word);
      } else {
        hit = tokens.has(word);
        if (!hit) {
          // Komposita wie "kick_909" / "openhat" / "hihatclosed"
          hit = normalized.includes(word) && word.length >= 3;
        }
      }
      if (!hit) continue;
      const score = rule.weight + Math.min(word.length, 8);
      if (score > best.score) {
        best = { group: rule.group, sub: refineSub(rule, tokens, normalized), score };
      }
    }
  }
  return best;
}

function refineSub(rule: Rule, tokens: Set<string>, normalized: string): string {
  if (rule.group === 'hat') {
    if (tokens.has('open') || tokens.has('ohh') || tokens.has('hhopen') || normalized.includes('open')) return 'open';
    return 'closed';
  }
  if (rule.group === 'loop') {
    if (tokens.has('top')) return 'top';
    if (tokens.has('break')) return 'break';
    if (tokens.has('perc') || tokens.has('percussion')) return 'perc';
    return 'loop';
  }
  if (rule.group === 'fx') {
    if (tokens.has('riser') || tokens.has('uplifter') || tokens.has('sweepup')) return 'riser';
    if (tokens.has('downlifter') || tokens.has('sweepdown')) return 'downlifter';
    if (tokens.has('impact')) return 'impact';
    return 'fx';
  }
  if (rule.group === 'perc') {
    const sub = [...tokens].find((t) =>
      ['clap', 'claps', 'cp', 'snap', 'rim', 'rimshot', 'shaker', 'tamb', 'tambourine', 'cowbell', 'conga', 'bongo', 'timbale', 'clave', 'guiro', 'agogo', 'djembe', 'cajon', 'tom', 'ride', 'crash', 'cymbal', 'block', 'stomp'].includes(t),
    );
    if (sub === 'cp') return 'clap';
    if (sub === 'claps') return 'clap';
    return sub ?? 'perc';
  }
  if (rule.group === 'snare') return 'snare';
  if (rule.group === 'kick') {
    if (tokens.has('soft') || tokens.has('boom')) return 'soft';
    return 'kick';
  }
  if (rule.group === 'bass') {
    if (tokens.has('808') || tokens.has('909')) return '808';
    if (tokens.has('sub')) return 'sub';
    return 'bass';
  }
  return rule.sub;
}

export function prettify(raw: string): string {
  const base = raw.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cleaned = base.replace(/^\d{1,3}[\s.)-]*/, '').replace(/\b(16|24) ?bit\b/gi, '').replace(/\b\d{2,3} ?k(hz)?\b/gi, '').trim();
  const value = cleaned || base || 'Sample';
  return value
    .split(' ')
    .map((word) => (word.length > 3 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(' ')
    .slice(0, 22);
}

export function detectBpm(raw: string): number | undefined {
  const match = raw.match(/(\d{2,3})\s?bpm/i);
  if (match) {
    const bpm = Number(match[1]);
    if (bpm >= 50 && bpm <= 220) return bpm;
  }
  return undefined;
}

/* ----------------------------- WAV-Header ------------------------- */

async function readWavInfo(file: File): Promise<WavInfo | null> {
  if (!/\.(wav|wave)$/i.test(file.name)) return null;
  try {
    const head = await file.slice(0, Math.min(file.size, 131072)).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 44) return null;
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') return null;
    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let dataSize = 0;
    while (offset + 8 <= view.byteLength) {
      const id = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );
      const size = view.getUint32(offset + 4, true);
      if (id === 'fmt ') {
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bits = view.getUint16(offset + 22, true);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      if (size <= 0 || offset + 8 + size > view.byteLength * 4) break;
      offset += 8 + size + (size % 2);
    }
    if (!sampleRate || !channels || !bits) return null;
    const duration = dataSize ? dataSize / (sampleRate * channels * (bits / 8)) : 0;
    return { sampleRate, bits, channels, duration };
  } catch {
    return null;
  }
}

/* ------------------------------- Scan ----------------------------- */

const GROUP_ORDER: SoundGroup[] = ['kick', 'snare', 'hat', 'perc', 'bass', 'tonal', 'vocal', 'fx', 'loop', 'other'];

const PAD_TEMPLATE: SoundGroup[] = [
  'kick',
  'kick',
  'snare',
  'perc',
  'hat',
  'hat',
  'perc',
  'perc',
  'bass',
  'bass',
  'tonal',
  'vocal',
  'fx',
  'fx',
  'loop',
  'loop',
];

export async function scanFiles(files: File[], packNameOverride?: string): Promise<ScanResult> {
  const entries: ScanEntry[] = [];
  const audioFiles = files.filter((file) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return AUDIO_EXT.includes(ext);
  });

  for (const file of audioFiles) {
    const classified = classify(file.name);
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const entry: ScanEntry = {
      file,
      name: file.name,
      label: prettify(file.name),
      path,
      ext: file.name.split('.').pop()?.toLowerCase() ?? '',
      group: classified.group,
      sub: classified.sub,
      score: classified.score,
      bpm: detectBpm(file.name),
    };
    if (entry.ext === 'wav' || entry.ext === 'wave') entry.wav = await readWavInfo(file) ?? undefined;
    entries.push(entry);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

  const byGroup = new Map<SoundGroup, ScanEntry[]>();
  for (const group of GROUP_ORDER) byGroup.set(group, []);
  for (const entry of entries) {
    const list = byGroup.get(entry.group) ?? byGroup.get('other');
    list?.push(entry);
  }

  const plan: (ScanEntry | null)[] = new Array(16).fill(null);
  const used = new Set<ScanEntry>();
  const pickFrom = (group: SoundGroup): ScanEntry | null => {
    const pool = byGroup.get(group) ?? [];
    const next = pool.find((entry) => !used.has(entry));
    if (next) used.add(next);
    return next ?? null;
  };

  PAD_TEMPLATE.forEach((group, index) => {
    plan[index] = pickFrom(group);
  });

  // Freie Slots mit übrig gebliebenen Sounds auffüllen
  const leftovers = entries.filter((entry) => !used.has(entry));
  for (let i = 0; i < 16 && leftovers.length; i++) {
    if (!plan[i]) {
      const entry = leftovers.shift() ?? null;
      plan[i] = entry;
      if (entry) used.add(entry);
    }
  }

  const folder =
    (audioFiles[0] as File & { webkitRelativePath?: string } | undefined)?.webkitRelativePath?.split('/')[0] ?? '';
  const packName = packNameOverride ? prettify(packNameOverride) : folder ? prettify(folder) : 'Gescanntes Pack';
  const unknown = entries.filter((entry) => entry.score === 0).length;

  return { entries, byGroup, plan, packName, folder, unknown };
}

export function groupCounts(result: ScanResult): { group: SoundGroup; count: number }[] {
  return GROUP_ORDER.map((group) => ({ group, count: result.byGroup.get(group)?.length ?? 0 })).filter((g) => g.count > 0);
}

export { GROUP_ORDER };
