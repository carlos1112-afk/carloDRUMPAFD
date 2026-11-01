import { DEFAULT_PACK, PACKS } from './audio/packs';
import type { AppState, DeckMode, PadConfig, SampleMeta, SoundGroup } from './types';
import { DEFAULT_PAD, makePadConfig } from './types';

const STORAGE_KEY = 'padforge.state.v2';
const BIND_KEY = 'padforge.midimap.v1';

export interface UserSampleRecord {
  id: string;
  name: string;
  group: SoundGroup;
  sub?: string;
  packId: string;
  ext: string;
  size: number;
  data: ArrayBuffer;
  duration?: number;
  sampleRate?: number;
  bits?: number;
  channels?: number;
  bpm?: number;
}

export interface ScannedPack {
  id: string;
  name: string;
  createdAt: number;
  folder: string;
  /** sampleIds in Pad-Reihenfolge (16) */
  padIds: (string | null)[];
  total: number;
}

/* --------------------------- App-State ---------------------------- */

export function createDefaultState(): AppState {
  const pack = DEFAULT_PACK;
  return {
    version: 3,
    kitId: pack.id,
    kitName: pack.name,
    pads: pack.pads.map((def, index) => makePadConfig(def, pack.id, index)),
    bpm: pack.bpm,
    quantize: 0.5,
    masterVol: 0.82,
    filter: 1,
    reverbReturn: 0.18,
    delayReturn: 0.14,
    midi: {
      padBank: 'hotcue',
      allBanks: true,
      shiftStops: true,
      ledFeedback: true,
      ledMode: 'binary',
      sysex: true,
      inputId: null,
      outputId: null,
    },
  };
}

function sanitizePad(raw: unknown): PadConfig {
  const pad = { ...DEFAULT_PAD, ...(typeof raw === 'object' && raw ? (raw as Partial<PadConfig>) : {}) };
  return {
    ...pad,
    gain: clampNum(pad.gain, 0, 1.4, DEFAULT_PAD.gain),
    pan: clampNum(pad.pan, -1, 1, 0),
    pitch: clampNum(pad.pitch, -24, 24, 0),
    attack: clampNum(pad.attack, 0, 0.5, DEFAULT_PAD.attack),
    decay: clampNum(pad.decay, 0, 8, 0),
    release: clampNum(pad.release, 0.01, 2, DEFAULT_PAD.release),
    start: clampNum(pad.start, 0, 0.95, 0),
    cutoff: clampNum(pad.cutoff, 0, 1, 1),
    sendReverb: clampNum(pad.sendReverb, 0, 1, 0.08),
    sendDelay: clampNum(pad.sendDelay, 0, 1, 0.05),
    choke: clampNum(pad.choke, 0, 4, 0),
    roll: clampNum(pad.roll, 0, 2, 0),
    fixedVelocity: clampNum(pad.fixedVelocity, 0.05, 1, 0.85),
  };
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadState(): AppState {
  const base = createDefaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const pads = Array.isArray(parsed.pads) && parsed.pads.length === 16 ? parsed.pads.map(sanitizePad) : base.pads;
    const midi = { ...base.midi, ...(parsed.midi ?? {}) };
    // Migration: Der FLX4 startet im Hot-Cue-Modus. Ältere Stände gingen von
    // der Sampler-Bank aus – dann kamen weder Pads noch LEDs an.
    if ((parsed.version ?? 0) < 3) {
      midi.padBank = 'hotcue';
      midi.allBanks = true;
    }
    return {
      ...base,
      ...parsed,
      version: base.version,
      pads,
      bpm: clampNum(parsed.bpm, 60, 200, base.bpm),
      quantize: clampNum(parsed.quantize, 0, 4, 0.5),
      masterVol: clampNum(parsed.masterVol, 0, 1, base.masterVol),
      filter: clampNum(parsed.filter, 0, 1, 1),
      reverbReturn: clampNum(parsed.reverbReturn, 0, 1.4, 0.18),
      delayReturn: clampNum(parsed.delayReturn, 0, 1.4, 0.14),
      midi,
    };
  } catch {
    return base;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Speicher voll / privat – App läuft weiter */
  }
}

/* --------------------------- Pad-Profile -------------------------- */

export interface ProfileSnapshot {
  pads: PadConfig[];
  kitId: string;
  kitName: string;
  bpm: number;
}

export interface ProfileStore {
  active: 0 | 1;
  slots: [ProfileSnapshot | null, ProfileSnapshot | null];
}

const PROFILE_KEY = 'padforge.profiles.v1';

function normalizeProfile(value: unknown): ProfileSnapshot | null {
  if (typeof value !== 'object' || !value) return null;
  const raw = value as Partial<ProfileSnapshot>;
  if (!Array.isArray(raw.pads) || raw.pads.length !== 16) return null;
  return {
    pads: raw.pads.map(sanitizePad),
    kitId: typeof raw.kitId === 'string' ? raw.kitId : 'custom',
    kitName: typeof raw.kitName === 'string' ? raw.kitName : 'Custom Kit',
    bpm: clampNum(raw.bpm, 60, 200, 124),
  };
}

export function loadProfileStore(): ProfileStore | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileStore>;
    if (parsed.active !== 0 && parsed.active !== 1) return null;
    const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
    return {
      active: parsed.active,
      slots: [normalizeProfile(slots[0]), normalizeProfile(slots[1])],
    };
  } catch {
    return null;
  }
}

export function saveProfileStore(store: ProfileStore): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(store));
  } catch {
    /* Speicher voll / privat – App läuft weiter */
  }
}

/* ---------------------------- Deck-Modi --------------------------- */

const DECK_MODE_KEY = 'padforge.deckmodes.v1';

export function loadDeckModes(): [DeckMode, DeckMode] {
  const normalize = (value: unknown): DeckMode => (value === 'vinyl' ? 'vinyl' : 'play');
  try {
    const raw = localStorage.getItem(DECK_MODE_KEY);
    if (!raw) return ['play', 'play'];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ['play', 'play'];
    return [normalize(parsed[0]), normalize(parsed[1])];
  } catch {
    return ['play', 'play'];
  }
}

export function saveDeckModes(modes: [DeckMode, DeckMode]): void {
  try {
    localStorage.setItem(DECK_MODE_KEY, JSON.stringify(modes));
  } catch {
    /* Speicher voll / privat – App läuft weiter */
  }
}

/* ------------------------- Sample-Registry ------------------------ */

export function buildPresetRegistry(): Map<string, SampleMeta> {
  const registry = new Map<string, SampleMeta>();
  for (const pack of PACKS) {
    pack.pads.forEach((def, index) => {
      registry.set(`preset:${pack.id}:${index}`, {
        id: `preset:${pack.id}:${index}`,
        name: def.name,
        group: def.group,
        sub: def.sub,
        source: 'preset',
        packId: pack.id,
      });
    });
  }
  return registry;
}

export function packPads(packId: string): PadConfig[] | null {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return null;
  return pack.pads.map((def, index) => makePadConfig(def, pack.id, index));
}

/* --------------------------- IndexedDB ---------------------------- */

const DB_NAME = 'padforge';
const DB_STORE = 'samples';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putUserSample(record: UserSampleRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllUserSamples(): Promise<UserSampleRecord[]> {
  const db = await openDb();
  const records = await new Promise<UserSampleRecord[]>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as UserSampleRecord[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return records;
}

export async function deleteUserSample(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/* ------------------------- MIDI-Bindings -------------------------- */

export interface MidiBinding {
  channel: number;
  note: number;
  pad: number;
}

export function loadBindings(): MidiBinding[] {
  try {
    const raw = localStorage.getItem(BIND_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MidiBinding[];
    return Array.isArray(parsed) ? parsed.filter((b) => typeof b.pad === 'number' && b.pad >= 0 && b.pad < 16) : [];
  } catch {
    return [];
  }
}

export function saveBindings(bindings: MidiBinding[]): void {
  try {
    localStorage.setItem(BIND_KEY, JSON.stringify(bindings));
  } catch {
    /* ignore */
  }
}

/* -------------------------- Scanned Packs ------------------------- */

const PACK_KEY = 'padforge.scannedpacks.v1';

export function loadScannedPacks(): ScannedPack[] {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScannedPack[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveScannedPacks(packs: ScannedPack[]): void {
  try {
    localStorage.setItem(PACK_KEY, JSON.stringify(packs.slice(0, 24)));
  } catch {
    /* ignore */
  }
}
