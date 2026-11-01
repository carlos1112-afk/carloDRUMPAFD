/* ------------------------------------------------------------------
 * PADFORGE – App-Verdrahtung
 * ------------------------------------------------------------------ */

import './styles.css';
import { AudioEngine, MASTER_FX, type MasterFx } from './audio/engine';
import { PACKS, getPack } from './audio/packs';
import { renderSample } from './audio/synth';
import { FLX4, MidiController } from './midi';
import { DeckPlayer } from './deck';
import { PerformanceLoop } from './loop';
import { SetRecorder } from './set-recorder';
import { classify, detectBpm, groupCounts, prettify, scanFiles, type ScanEntry, type ScanResult } from './scanner';
import {
  buildPresetRegistry,
  getAllUserSamples,
  loadDeckModes,
  loadProfileStore,
  loadScannedPacks,
  loadState,
  packPads,
  putUserSample,
  saveDeckModes,
  saveProfileStore,
  saveScannedPacks,
  saveState,
  type ProfileSnapshot,
  type ProfileStore,
  type ScannedPack,
  type UserSampleRecord,
} from './store';
import type { AppState, PadConfig, SampleMeta, SoundGroup } from './types';
import { DEFAULT_PAD, GROUP_META } from './types';
import { DecksPanel } from './ui/decks';
import { HardwarePanel } from './ui/hardware';
import { Inspector, type InspectorContext } from './ui/inspector';
import { PadGrid } from './ui/pads';
import { button, clear, h, toast } from './ui/dom';

/* ------------------------------ Setup ------------------------------ */

const state: AppState = loadState();
const profileStore: ProfileStore = loadProfileStore() ?? { active: 0, slots: [null, null] };
const initialProfile = profileStore.slots[profileStore.active];
if (initialProfile) {
  state.pads = initialProfile.pads.map((pad) => ({ ...pad }));
  state.kitId = initialProfile.kitId;
  state.kitName = initialProfile.kitName;
  state.bpm = initialProfile.bpm;
}
const registry = buildPresetRegistry();
const audio = new AudioContext({ latencyHint: 'interactive' });
const engine = new AudioEngine(audio);
engine.pads.push(...state.pads);
engine.setQuantize(state.quantize);
engine.setBpm(state.bpm);
engine.setMasterVolume(state.masterVol);
engine.setMasterFilter(state.filter);
engine.storeFilter(state.filter);
engine.storeDelay(state.delayReturn);
engine.setReverbReturn(state.reverbReturn);
engine.setDelayReturn(state.delayReturn);

const midi = new MidiController(state.midi);
const loop = new PerformanceLoop(() => audio.currentTime);
loop.bpm = state.bpm;
loop.quantizeBeats = state.quantize;
loop.onHit = (hit, when) => {
  engine.trigger(hit.pad, { velocity: hit.velocity, time: when, quantize: false });
  const delay = Math.max(0, (when - audio.currentTime) * 1000);
  window.setTimeout(() => padGrid.flash(hit.pad, hit.velocity), delay);
};
loop.onStateChange = () => updateLoopUi();
const deckModes = loadDeckModes();
const deckPlayers = [
  new DeckPlayer(audio, engine.masterInputNode(), 0),
  new DeckPlayer(audio, engine.masterInputNode(), 1),
];
deckPlayers[0].mode = deckModes[0];
deckPlayers[1].mode = deckModes[1];
const setRecorder = new SetRecorder(audio, engine);
setRecorder.onState = () => {
  updateSetUi();
  syncSetTimer();
};
setRecorder.onFinished = (recording) => {
  setRecorder.downloadLast();
  if (recording.size < 1024) {
    toast('Set-Aufnahme ist leer – Audio-Ausgang prüfen.', 'warn', 5000);
  } else {
    toast(
      `Set gespeichert: ${recording.filename} · ${(recording.size / 1048576).toFixed(1)} MB`,
      'info',
      6000,
    );
  }
  updateSetUi();
};
const scannedPacks: ScannedPack[] = loadScannedPacks();

let selected = 0;
let clipboard: PadConfig | null = null;
let lastScan: ScanResult | null = null;
let currentSink = '';

const levels = new Float32Array(16);

/* ----------------------------- Helpers ----------------------------- */

function $<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} fehlt`);
  return node as T;
}

let lastStatus = '';
function setStatus(text: string): void {
  if (text === lastStatus) return;
  lastStatus = text;
  $('statusText').textContent = text;
}

let saveTimer = 0;
function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveState(state);
    profileStore.slots[profileStore.active] = snapshotProfile();
    saveProfileStore(profileStore);
  }, 350);
}

function syncEnginePads(): void {
  engine.pads.length = 0;
  engine.pads.push(...state.pads);
  engine.setBpm(state.bpm);
}

/* ---------------------------- Decks ------------------------------- */

async function loadDeckTrack(index: number, file: File): Promise<void> {
  const deck = deckPlayers[index];
  if (!deck) return;
  setStatus(`Deck ${index + 1}: ${file.name} wird geladen …`);
  try {
    const buffer = await engine.decode(await file.arrayBuffer());
    deck.load(buffer, prettify(file.name));
    setStatus(`Deck ${index + 1}: ${prettify(file.name)} · ${formatClock(buffer.duration)}`);
    toast(`Deck ${index + 1}: ${prettify(file.name)} geladen`, 'info', 2600);
  } catch {
    toast('Track konnte nicht dekodiert werden (Format?).', 'error', 3600);
  }
}

function syncDeckLeds(): void {
  midi.setTransportState({
    deckPlaying: [deckPlayers[0].playing, deckPlayers[1].playing],
  });
}

/* ---------------------------- Profile ----------------------------- */

function snapshotProfile(): ProfileSnapshot {
  return {
    pads: state.pads.map((pad) => ({ ...pad })),
    kitId: state.kitId,
    kitName: state.kitName,
    bpm: state.bpm,
  };
}

function applyProfileSnapshot(snapshot: ProfileSnapshot): void {
  state.pads = snapshot.pads.map((pad) => ({ ...pad }));
  state.kitId = snapshot.kitId;
  state.kitName = snapshot.kitName;
  state.bpm = snapshot.bpm;
  const bpmInput = document.getElementById('bpmInput') as HTMLInputElement | null;
  if (bpmInput) bpmInput.value = String(state.bpm);
  syncEnginePads();
}

function saveActiveProfile(): void {
  profileStore.slots[profileStore.active] = snapshotProfile();
  saveProfileStore(profileStore);
}

const shuffleHistory: PadConfig[][] = [];

function shufflePads(): void {
  shuffleHistory.push(state.pads.map((pad) => ({ ...pad })));
  if (shuffleHistory.length > 20) shuffleHistory.shift();
  const next = state.pads.map((pad) => ({ ...pad }));
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  state.pads = next;
  refreshAll();
  persist();
  toast('Beat Sync: Pads zufällig neu belegt · Ctrl+Z rückgängig', 'info', 2800);
}

function undoShuffle(): void {
  const previous = shuffleHistory.pop();
  if (!previous) {
    toast('Kein Pad-Shuffle zum Rückgängigmachen.', 'info', 1800);
    return;
  }
  state.pads = previous;
  refreshAll();
  persist();
  toast('Pad-Shuffle rückgängig', 'info', 1600);
}

function toggleProfile(): void {
  saveActiveProfile();
  const next: 0 | 1 = profileStore.active === 0 ? 1 : 0;
  if (!profileStore.slots[next]) profileStore.slots[next] = snapshotProfile();
  profileStore.active = next;
  saveProfileStore(profileStore);
  engine.stopAll();
  loop.clear();
  setMelody(false);
  shuffleHistory.length = 0;
  applyProfileSnapshot(profileStore.slots[next] as ProfileSnapshot);
  loop.setBpm(state.bpm);
  refreshAll();
  persist();
  updateProfileUi();
  toast(`Profil ${next + 1} aktiv`, 'info', 1600);
}

/* ----------------------------- Samples ----------------------------- */

function sampleMetaFromRecord(record: UserSampleRecord): SampleMeta {
  return {
    id: record.id,
    name: record.name,
    group: record.group,
    sub: record.sub,
    source: 'user',
    packId: record.packId,
    duration: record.duration,
    sampleRate: record.sampleRate,
    bits: record.bits,
    channels: record.channels,
    bpm: record.bpm,
  };
}

async function loadUserSamples(): Promise<void> {
  try {
    const records = await getAllUserSamples();
    for (const record of records) {
      registry.set(record.id, sampleMetaFromRecord(record));
      try {
        const buffer = await engine.decode(record.data.slice(0));
        engine.registerBuffer(record.id, buffer);
      } catch {
        /* defekte Datei ignorieren */
      }
    }
  } catch {
    /* IndexedDB nicht verfügbar */
  }
}

async function ensurePresetSample(sampleId: string): Promise<boolean> {
  if (engine.hasBuffer(sampleId)) return true;
  const [, packId, indexRaw] = sampleId.split(':');
  const pack = getPack(packId ?? '');
  const def = pack?.pads[Number(indexRaw)];
  if (!pack || !def) return false;
  try {
    const buffer = await renderSample(def.recipe, def.params, def.group);
    engine.registerBuffer(sampleId, buffer);
    const meta = registry.get(sampleId);
    if (meta) {
      meta.duration = buffer.duration;
      meta.sampleRate = buffer.sampleRate;
      meta.channels = buffer.numberOfChannels;
      meta.bits = 32;
    }
    return true;
  } catch {
    return false;
  }
}

async function ensurePackBuffers(packId: string): Promise<void> {
  const pack = getPack(packId);
  if (!pack) return;
  let loaded = 0;
  for (let i = 0; i < pack.pads.length; i++) {
    const ok = await ensurePresetSample(`preset:${packId}:${i}`);
    if (ok) loaded++;
    if (i % 4 === 3) setStatus(`Werks-Samples werden generiert … ${loaded}/${pack.pads.length}`);
  }
}

async function importSampleFile(
  file: File,
  options: { group: SoundGroup; sub?: string; bpm?: number; label?: string; packId?: string },
): Promise<SampleMeta | null> {
  let decoded: AudioBuffer;
  const bytes = await file.arrayBuffer();
  try {
    decoded = await engine.decode(bytes.slice(0));
  } catch {
    return null;
  }
  const id = `user:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const meta: SampleMeta = {
    id,
    name: options.label ?? prettify(file.name),
    group: options.group,
    sub: options.sub,
    source: 'user',
    packId: options.packId ?? 'user',
    duration: decoded.duration,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    bits: 32,
    bpm: options.bpm,
  };
  registry.set(id, meta);
  engine.registerBuffer(id, decoded);
  try {
    await putUserSample({
      id,
      name: meta.name,
      group: meta.group,
      sub: meta.sub,
      packId: meta.packId,
      ext: file.name.split('.').pop()?.toLowerCase() ?? '',
      size: file.size,
      data: bytes,
      duration: meta.duration,
      sampleRate: meta.sampleRate,
      bits: meta.bits,
      channels: meta.channels,
      bpm: meta.bpm,
    });
  } catch {
    toast('Sample konnte nicht dauerhaft gespeichert werden (Speicher voll?).', 'warn');
  }
  return meta;
}

/* ------------------------------ Pad UI ----------------------------- */

const padGrid = new PadGrid($('padGrid'), {
  onPress: (index, velocity) => {
    selected = index;
    triggerPad(index, velocity);
  },
  onRelease: (index) => releasePad(index),
  onSelect: (index) => {
    if (selected === index) return;
    selected = index;
    padGrid.setSelected(index);
    renderInspector();
  },
});

const inspector = new Inspector($('inspector'), {
  patch: (partial) => {
    const pad = state.pads[selected];
    if (!pad) return;
    Object.assign(pad, partial);
    padGrid.sync(state.pads, registry);
    renderInspectorIfStructural(partial);
    persist();
  },
  assignSample: (sampleId) => void assignSample(sampleId),
  loadFile: (file) => void assignFileToSelected(file),
  preview: () => {
    const pad = state.pads[selected];
    if (!pad?.sampleId) {
      toast('Dieses Pad hat kein Sample.', 'warn');
      return;
    }
    void unlockAudio();
    triggerPad(selected, 1);
  },
  clearPad: () => {
    const pad = state.pads[selected];
    if (!pad) return;
    pad.sampleId = null;
    pad.label = 'Empty';
    pad.group = 'other';
    refreshAll();
    persist();
  },
  resetPad: () => {
    const pad = state.pads[selected];
    if (!pad) return;
    state.pads[selected] = { ...DEFAULT_PAD, sampleId: pad.sampleId, label: pad.label, group: pad.group };
    refreshAll();
    persist();
  },
  learn: () => {
    midi.startLearn(selected);
    switchTab('hw');
    toast(`Pad ${selected + 1}: Taste am Controller drücken …`, 'info', 4000);
  },
  clearLearn: () => {
    midi.clearBinding(selected);
    renderInspector();
  },
  copyPad: () => {
    const pad = state.pads[selected];
    if (!pad) return;
    clipboard = { ...pad };
    toast(`Pad ${selected + 1} kopiert`, 'info', 1400);
    renderInspector();
  },
  pastePad: () => {
    if (!clipboard) return;
    state.pads[selected] = { ...clipboard };
    refreshAll();
    persist();
    toast(`In Pad ${selected + 1} eingesetzt`, 'info', 1600);
  },
});

const decksUi = new DecksPanel($('decks'), deckPlayers, {
  load: (index, file) => void loadDeckTrack(index, file),
  toggle: (index) => {
    void unlockAudio();
    deckPlayers[index]?.toggle();
  },
  cue: (index) => deckPlayers[index]?.cue(),
  seek: (index, seconds) => deckPlayers[index]?.seek(seconds),
  mode: (index, mode) => {
    const deck = deckPlayers[index];
    if (!deck) return;
    deck.setMode(mode);
    deckModes[index] = mode;
    saveDeckModes(deckModes);
    decksUi.update();
  },
});
for (const deck of deckPlayers) {
  deck.onState = () => {
    decksUi.update();
    syncDeckLeds();
  };
}

const hardware = new HardwarePanel($('hardware'), midi, {
  connect: () => void midi.connect(),
  disconnect: () => {
    midi.disconnect();
    toast('MIDI getrennt', 'info', 1800);
  },
  rescan: () => {
    midi.refresh();
    toast('MIDI-Ports neu gescannt', 'info', 1800);
  },
  selectInput: (id) => {
    midi.setInput(id);
    persist();
    scheduleHardware();
  },
  selectOutput: (id) => {
    midi.setOutput(id);
    persist();
    scheduleHardware();
  },
  update: (patch) => {
    state.midi = { ...state.midi, ...patch };
    midi.settings = state.midi;
    persist();
    if (patch.ledFeedback === false) midi.clearLeds();
    else if (patch.ledFeedback === true) midi.syncHardwareLeds();
    if (patch.padBank) midi.setModeLed(patch.padBank);
    scheduleHardware();
  },
  learn: () => {
    midi.startLearn(selected);
    renderInspector();
  },
  cancelLearn: () => {
    midi.cancelLearn();
    renderInspector();
  },
  testLeds: () => {
    midi.testLeds();
  },
  clearLog: () => {
    midi.log.length = 0;
    scheduleHardware();
  },
});

/* --------------------------- Inspector ---------------------------- */

function presetGroups(): { label: string; entries: SampleMeta[] }[] {
  return PACKS.map((pack) => ({
    label: pack.name,
    entries: pack.pads
      .map((_, index) => registry.get(`preset:${pack.id}:${index}`))
      .filter((entry): entry is SampleMeta => Boolean(entry)),
  }));
}

function midiTextFor(index: number): string {
  const binding = midi.bindingFor(index);
  if (binding) return `Custom: Kanal ${binding.channel + 1} · Note ${binding.note}`;
  if (midi.profile === 'flx4') {
    const deck = Math.floor(index / 8);
    const base = FLX4.banks[state.midi.padBank] ?? FLX4.samplerBase;
    return `FLX4: Deck ${deck + 1} · Kanal ${deck === 0 ? 8 : 10} · Note 0x${(base + (index % 8))
      .toString(16)
      .toUpperCase()}`;
  }
  return 'Kein Hardware-Mapping';
}

function renderInspector(): void {
  const pad = state.pads[selected];
  if (!pad) return;
  const meta = pad.sampleId ? registry.get(pad.sampleId) ?? null : null;
  const context: InspectorContext = {
    pad,
    index: selected,
    meta,
    registry,
    presetGroups: presetGroups(),
    userSamples: [...registry.values()].filter((entry) => entry.source === 'user'),
    midiText: midiTextFor(selected),
    canPaste: Boolean(clipboard),
  };
  inspector.render(context);
  inspector.drawWaveform(engine.getBuffer(pad.sampleId), pad.start);
  padGrid.setSelected(selected);
}

function renderInspectorIfStructural(partial: Partial<PadConfig>): void {
  if ('mode' in partial || 'filterType' in partial || 'group' in partial) renderInspector();
  else inspector.drawWaveform(engine.getBuffer(state.pads[selected]?.sampleId ?? null), state.pads[selected]?.start ?? 0);
}

/* ----------------------------- Pads ------------------------------- */

function triggerPad(index: number, velocity: number): void {
  const pad = state.pads[index];
  if (!pad) return;
  void unlockAudio();

  if (!pad.sampleId) {
    toast(`Pad ${index + 1} ist leer – Sample im Editor zuweisen.`, 'warn', 2200);
    return;
  }
  if (!engine.hasBuffer(pad.sampleId)) {
    if (pad.sampleId.startsWith('preset:')) {
      void ensurePresetSample(pad.sampleId).then((ok) => {
        if (ok) triggerPad(index, velocity);
      });
      return;
    }
    toast('Sample fehlt – bitte neu zuweisen.', 'warn');
    return;
  }

  if (pad.mode === 'toggle' || pad.mode === 'loop') {
    if (engine.isPlaying(index)) {
      engine.stop(index);
      stopRoll(index);
      padGrid.releasePad(index);
      return;
    }
    loop.capture(index, velocity);
    engine.trigger(index, { velocity, quantize: state.quantize > 0 });
    padGrid.flash(index, velocity);
    return;
  }

  loop.capture(index, velocity);
  engine.trigger(index, { velocity, quantize: state.quantize > 0 });
  padGrid.flash(index, velocity);
  if (pad.roll > 0) startRoll(index, velocity);
}

function releasePad(index: number): void {
  const pad = state.pads[index];
  if (!pad) return;
  stopRoll(index);
  if (pad.mode === 'gate') engine.stop(index);
  padGrid.releasePad(index);
}

function stopAll(): void {
  engine.stopAll();
  loop.stop();
  setMelody(false);
  for (const deck of deckPlayers) if (deck.playing) deck.pause();
  syncDeckLeds();
  for (let i = 0; i < 16; i++) stopRoll(i);
  setStatus('Alle Pads und Decks gestoppt');
}

/* Roll / Retrigger */
const rollTimers = new Map<number, number>();

function startRoll(index: number, velocity: number, override?: number): void {
  stopRoll(index);
  const pad = state.pads[index];
  const division = override ?? pad.roll;
  if (!division) return;
  const interval = Math.max(45, (60 / state.bpm) * division * 1000);
  const timer = window.setInterval(() => {
    engine.trigger(index, { velocity, quantize: false, fast: true });
    padGrid.flash(index, velocity * 0.8);
  }, interval);
  rollTimers.set(index, timer);
}

function stopRoll(index: number): void {
  const timer = rollTimers.get(index);
  if (timer !== undefined) {
    window.clearInterval(timer);
    rollTimers.delete(index);
  }
}

/* --------------------------- Sample zuweisen ---------------------- */

async function assignSample(sampleId: string): Promise<void> {
  const meta = registry.get(sampleId);
  const pad = state.pads[selected];
  if (!meta || !pad) return;
  if (meta.source === 'preset') {
    setStatus('Sample wird generiert …');
    const ok = await ensurePresetSample(sampleId);
    if (!ok) {
      toast('Sample konnte nicht geladen werden.', 'error');
      return;
    }
  }
  pad.sampleId = sampleId;
  pad.label = meta.name;
  pad.group = meta.group;
  if (meta.group === 'loop') pad.mode = 'loop';
  refreshAll();
  persist();
  setStatus(`Pad ${selected + 1}: ${meta.name}`);
}

async function assignFileToSelected(file: File): Promise<void> {
  setStatus('Sample wird importiert …');
  const meta = await importSampleFile(file, {
    group: classify(file.name).group,
    sub: classify(file.name).sub,
    bpm: detectBpm(file.name),
    packId: 'user',
  });
  if (!meta) {
    toast('Datei konnte nicht dekodiert werden.', 'error');
    return;
  }
  const pad = state.pads[selected];
  if (!pad) return;
  pad.sampleId = meta.id;
  pad.label = meta.name;
  pad.group = meta.group;
  if (meta.group === 'loop') pad.mode = 'loop';
  refreshAll();
  persist();
  toast(`${meta.name} → Pad ${selected + 1}`, 'info');
}

/* ----------------------------- Packs ------------------------------ */

function renderKitOptions(): void {
  const select = $<HTMLSelectElement>('kitSelect');
  clear(select);
  const factory = document.createElement('optgroup');
  factory.label = 'Werks-Packs';
  for (const pack of PACKS) {
    const option = h('option', '', `${pack.name} · ${pack.bpm} BPM`) as HTMLOptionElement;
    option.value = pack.id;
    option.selected = pack.id === state.kitId;
    factory.appendChild(option);
  }
  select.appendChild(factory);

  if (scannedPacks.length) {
    const scanned = document.createElement('optgroup');
    scanned.label = 'Gescannte Packs';
    for (const pack of scannedPacks) {
      const option = h('option', '', `${pack.name} · ${pack.total} Sounds`) as HTMLOptionElement;
      option.value = pack.id;
      option.selected = pack.id === state.kitId;
      scanned.appendChild(option);
    }
    select.appendChild(scanned);
  }
}

function updateStage(): void {
  $('stageKitName').textContent = state.kitName || 'Custom Kit';
  const loaded = state.pads.filter((pad) => pad.sampleId).length;
  $('stageKitMeta').textContent = `${loaded}/16 Pads belegt · ${state.bpm} BPM · Profil ${
    profileStore.active + 1
  } · ${getPack(state.kitId) ? 'Werk-Pack' : 'gescanntes Pack'}`;
}

function refreshAll(): void {
  syncEnginePads();
  padGrid.sync(state.pads, registry);
  padGrid.setSelected(selected);
  updateStage();
  renderInspector();
  midi.setBaseLeds(state.pads.map((pad) => (pad?.sampleId ? 0x20 : 0x00)));
  scheduleHardware();
}

async function loadPresetPack(packId: string): Promise<void> {
  const pads = packPads(packId);
  const pack = getPack(packId);
  if (!pads || !pack) return;
  engine.stopAll();
  loop.clear();
  setMelody(false);
  shuffleHistory.length = 0;
  state.pads = pads;
  state.kitId = pack.id;
  state.kitName = pack.name;
  state.bpm = pack.bpm;
  loop.setBpm(state.bpm);
  $<HTMLInputElement>('bpmInput').value = String(state.bpm);
  syncEnginePads();
  setStatus('Werks-Pack wird geladen …');
  await ensurePackBuffers(packId);
  refreshAll();
  persist();
  setStatus(`${pack.name} geladen · 16 Pads spielbereit`);
}

function applyScannedPack(pack: ScannedPack): void {
  engine.stopAll();
  loop.clear();
  setMelody(false);
  shuffleHistory.length = 0;
  const pads: PadConfig[] = pack.padIds.map((id) => {
    const meta = id ? registry.get(id) : null;
    if (!id || !meta) return { ...DEFAULT_PAD, label: 'Empty' };
    return {
      ...DEFAULT_PAD,
      sampleId: id,
      label: meta.name,
      group: meta.group,
      mode: (meta.group === 'loop' ? 'loop' : 'oneshot') as PadConfig['mode'],
      sendReverb: meta.group === 'vocal' ? 0.22 : 0.08,
      sendDelay: meta.group === 'vocal' ? 0.16 : 0.05,
    };
  });
  state.pads = pads;
  state.kitId = pack.id;
  state.kitName = pack.name;
  refreshAll();
  persist();
  setStatus(`${pack.name} geladen · ${pack.total} Sounds im Kit`);
}

/* --------------------------- Performance -------------------------- */

let melodyOn = false;
let melodyTimer = 0;

function updateProfileUi(): void {
  const btn = document.getElementById('profileBtn');
  if (btn) {
    btn.textContent = `Profil ${profileStore.active + 1}`;
    btn.classList.toggle('is-profile-b', profileStore.active === 1);
    btn.title = 'Pad-Profil wechseln (P oder Hot Cue kurz drücken)';
  }
  midi.setProfile(profileStore.active);
}

let setTimer = 0;

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function updateSetUi(): void {
  const btn = document.getElementById('setRecBtn');
  const time = document.getElementById('setRecTime');
  const save = document.getElementById('setRecSave') as HTMLButtonElement | null;
  if (!btn || !time) return;
  const recording = setRecorder.state === 'recording';
  const processing = setRecorder.state === 'processing';
  btn.classList.toggle('is-recording', recording);
  btn.textContent = recording ? '■ Set stoppen' : processing ? '… Speichern' : '● Set REC';
  time.textContent = formatClock(setRecorder.elapsed);
  time.classList.toggle('is-recording', recording);
  if (save) save.disabled = !setRecorder.last || recording || processing;
}

function syncSetTimer(): void {
  if (setRecorder.state === 'recording') {
    if (!setTimer) setTimer = window.setInterval(updateSetUi, 500);
  } else if (setTimer) {
    window.clearInterval(setTimer);
    setTimer = 0;
  }
}

async function toggleSetRecording(): Promise<void> {
  if (setRecorder.state === 'recording') {
    setRecorder.stop();
    return;
  }
  if (setRecorder.state === 'processing') return;
  await unlockAudio();
  if (!setRecorder.supported) {
    toast('Set-Aufnahme wird von diesem Browser nicht unterstützt.', 'error', 4200);
    return;
  }
  setRecorder.setLabel(`${state.kitName} ${state.bpm}BPM`);
  if (!setRecorder.start()) {
    toast('Set-Aufnahme konnte nicht gestartet werden.', 'error', 3600);
    return;
  }
  updateSetUi();
  toast('Set-Aufnahme läuft – der komplette Master wird als WebM/Opus mitgeschnitten.', 'info', 3400);
}

function updateLoopUi(): void {
  const recBtn = document.getElementById('recBtn');
  const loopBtn = document.getElementById('loopBtn');
  const status = document.getElementById('loopStatus');
  const barsSelect = document.getElementById('loopBars') as HTMLSelectElement | null;
  if (!recBtn || !loopBtn || !status) return;
  const recording = loop.state === 'recording';
  const playing = loop.state === 'playing';
  recBtn.classList.toggle('is-recording', recording);
  recBtn.textContent = recording ? '● Aufnahme' : '● Loop-REC';
  loopBtn.classList.toggle('is-playing', playing);
  loopBtn.textContent = playing ? '■ Loop' : '▶ Loop';
  const hits = loop.events.length;
  status.textContent = recording
    ? `Aufnahme · ${loop.bars} Bars · ${hits} Hit${hits === 1 ? '' : 's'}`
    : playing
      ? `Loop läuft · ${loop.bars} Bars · ${hits} Hits`
      : hits
        ? `Loop bereit · ${hits} Hits`
        : 'leer';
  status.classList.toggle('is-recording', recording);
  if (barsSelect) barsSelect.value = String(loop.bars);
  midi.setTransportState({ playing, recording, melody: melodyOn });
}

async function toggleRecord(): Promise<void> {
  await unlockAudio();
  if (loop.state === 'recording') {
    loop.finishRecording();
  } else {
    const bars = Number(($('loopBars') as HTMLSelectElement).value) || 2;
    loop.bars = bars;
    loop.quantizeBeats = state.quantize;
    loop.arm();
    toast(`Aufnahme läuft · ${bars} Bars – Sequenz einspielen`, 'info', 2600);
  }
  updateLoopUi();
}

function toggleLoop(): void {
  if (loop.state === 'recording') {
    loop.finishRecording();
    updateLoopUi();
    return;
  }
  if (loop.state === 'playing') {
    loop.stop();
    updateLoopUi();
    return;
  }
  if (!loop.events.length) {
    toast('Noch keine Sequenz – erst REC drücken (Shift+Space).', 'warn', 2600);
    return;
  }
  void unlockAudio();
  loop.startPlayback();
  updateLoopUi();
}

function clearLoop(): void {
  loop.clear();
  toast('Loop gelöscht', 'info', 1400);
}

function setLoopBars(bars: number): void {
  loop.setBars(bars);
  updateLoopUi();
}

function melodyCandidates(): number[] {
  const preferred: number[] = [];
  const fallback: number[] = [];
  state.pads.forEach((pad, index) => {
    if (!pad.sampleId) return;
    if (pad.group === 'tonal' || pad.group === 'bass') preferred.push(index);
    else if (pad.mode !== 'loop' && pad.group !== 'kick') fallback.push(index);
  });
  return preferred.length ? preferred : fallback;
}

function setMelody(on: boolean): void {
  if (on === melodyOn) return;
  window.clearInterval(melodyTimer);
  melodyTimer = 0;
  melodyOn = on;
  const btn = document.getElementById('melodyBtn');
  btn?.classList.toggle('is-active', on);
  if (!on) {
    updateLoopUi();
    return;
  }
  if (!melodyCandidates().length) {
    melodyOn = false;
    btn?.classList.remove('is-active');
    toast('Keine melodischen Pads im Kit – erst Samples zuweisen.', 'warn', 2600);
    updateLoopUi();
    return;
  }
  melodyTimer = window.setInterval(melodyStep, Math.max(90, (60 / state.bpm) * 1000 / 2));
  toast('Zufalls-Melodie an · Loop Out stoppt', 'info', 2200);
  updateLoopUi();
}

const MELODY_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

function melodyStep(): void {
  if (!melodyOn) return;
  const candidates = melodyCandidates();
  if (!candidates.length) {
    setMelody(false);
    return;
  }
  if (Math.random() < 0.18) return;
  const padIndex = candidates[Math.floor(Math.random() * candidates.length)];
  const octave = Math.random() < 0.22 ? -12 : Math.random() < 0.18 ? 12 : 0;
  const offset = MELODY_SCALE[Math.floor(Math.random() * MELODY_SCALE.length)] + octave;
  const velocity = 0.45 + Math.random() * 0.35;
  engine.trigger(padIndex, { velocity, pitch: offset, quantize: false });
  padGrid.flash(padIndex, velocity);
}

function restartMelody(): void {
  if (!melodyOn) return;
  melodyOn = false;
  setMelody(true);
}

/* ----------------------------- Trigger UI -------------------------- */

function bindControls(): void {
  /* BPM */
  const bpmInput = $<HTMLInputElement>('bpmInput');
  bpmInput.value = String(state.bpm);
  bpmInput.addEventListener('change', () => {
    const value = Math.round(Math.min(200, Math.max(60, Number(bpmInput.value) || state.bpm)));
    state.bpm = value;
    bpmInput.value = String(value);
    engine.setBpm(value);
    loop.setBpm(value);
    restartMelody();
    updateStage();
    persist();
  });

  let taps: number[] = [];
  $('tapBtn').addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter((time) => now - time < 2600);
    taps.push(now);
    if (taps.length >= 2) {
      const deltas: number[] = [];
      for (let i = 1; i < taps.length; i++) deltas.push(taps[i] - taps[i - 1]);
      const avg = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      const bpm = Math.round(Math.min(200, Math.max(60, 60000 / avg)));
      state.bpm = bpm;
      bpmInput.value = String(bpm);
      engine.setBpm(bpm);
      loop.setBpm(bpm);
      restartMelody();
      updateStage();
      persist();
    }
    if (taps.length > 8) taps = taps.slice(-4);
  });

  /* Master */
  const masterVol = $<HTMLInputElement>('masterVol');
  masterVol.value = String(Math.round(state.masterVol * 100));
  masterVol.addEventListener('input', () => {
    state.masterVol = Number(masterVol.value) / 100;
    engine.setMasterVolume(state.masterVol);
    persist();
  });

  /* Filter / FX sendet */
  const filterKnob = $<HTMLInputElement>('filterKnob');
  filterKnob.value = String(Math.round(state.filter * 100));
  filterKnob.addEventListener('input', () => {
    state.filter = Number(filterKnob.value) / 100;
    engine.setMasterFilter(state.filter);
    engine.storeFilter(state.filter);
    persist();
  });

  const reverbKnob = $<HTMLInputElement>('reverbKnob');
  reverbKnob.value = String(Math.round(state.reverbReturn * 100));
  reverbKnob.addEventListener('input', () => {
    state.reverbReturn = Number(reverbKnob.value) / 100;
    engine.setReverbReturn(state.reverbReturn);
    persist();
  });

  const delayKnob = $<HTMLInputElement>('delayKnob');
  delayKnob.value = String(Math.round(state.delayReturn * 100));
  delayKnob.addEventListener('input', () => {
    state.delayReturn = Number(delayKnob.value) / 100;
    engine.setDelayReturn(state.delayReturn);
    engine.storeDelay(state.delayReturn);
    persist();
  });

  /* Quantize */
  const quantize = $<HTMLSelectElement>('quantizeSelect');
  quantize.value = String(state.quantize);
  quantize.addEventListener('change', () => {
    state.quantize = Number(quantize.value);
    engine.setQuantize(state.quantize);
    loop.quantizeBeats = state.quantize;
    persist();
    setStatus(state.quantize === 0 ? 'Quantize aus' : `Quantize: ${quantize.selectedOptions[0]?.textContent}`);
  });

  /* Master FX */
  const fxHost = $('fxButtons');
  for (const fx of MASTER_FX) {
    const fxBtn = button(fx, 'fx-btn', () => {});
    fxBtn.dataset.fx = fx;
    const label: Record<MasterFx, string> = {
      LP: 'LP-Filter',
      HP: 'HP-Filter',
      Echo: 'Echo Throw',
      Gate: 'Beat Gate',
    };
    fxBtn.textContent = label[fx];
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return;
      void unlockAudio();
      fxBtn.setPointerCapture(event.pointerId);
      fxBtn.classList.add('is-active');
      engine.pressFx(fx);
    };
    const release = () => {
      fxBtn.classList.remove('is-active');
      engine.releaseFx(fx);
    };
    fxBtn.addEventListener('pointerdown', press);
    fxBtn.addEventListener('pointerup', release);
    fxBtn.addEventListener('pointercancel', release);
    fxBtn.addEventListener('pointerleave', release);
    fxHost.appendChild(fxBtn);
  }

  /* Kit */
  $<HTMLSelectElement>('kitSelect').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value.startsWith('scan:')) {
      const pack = scannedPacks.find((entry) => entry.id === value);
      if (pack) applyScannedPack(pack);
    } else {
      void loadPresetPack(value);
    }
  });

  /* Stop */
  $('stopAllBtn').addEventListener('click', stopAll);

  /* Performance */
  $('shuffleBtn').addEventListener('click', shufflePads);
  $('profileBtn').addEventListener('click', toggleProfile);
  $('recBtn').addEventListener('click', () => void toggleRecord());
  $('loopBtn').addEventListener('click', toggleLoop);
  $('clearLoopBtn').addEventListener('click', clearLoop);
  $('melodyBtn').addEventListener('click', () => setMelody(!melodyOn));
  $('setRecBtn').addEventListener('click', () => void toggleSetRecording());
  $('setRecSave').addEventListener('click', () => setRecorder.downloadLast());
  $<HTMLSelectElement>('loopBars').addEventListener('change', () => {
    setLoopBars(Number($<HTMLSelectElement>('loopBars').value) || 2);
  });

  /* Ansicht */
  document.querySelectorAll<HTMLButtonElement>('#padModeFilter .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#padModeFilter .seg-btn').forEach((other) => other.classList.remove('is-active'));
      btn.classList.add('is-active');
      $('padGrid').classList.toggle('view-groups', btn.dataset.view === 'groups');
    });
  });

  /* Tabs */
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target === 'hw' ? 'hw' : target === 'deck' ? 'deck' : 'pad');
    });
  });

  /* MIDI Badge */
  $('midiBadge').addEventListener('click', () => {
    switchTab('hw');
    void midi.init();
  });

  /* Ausgang */
  $('outputBtn').addEventListener('click', () => void openOutputDialog());
  $('outputApply').addEventListener('click', () => void applySink());

  /* Scanner */
  $('scanBtn').addEventListener('click', () => {
    ($('scanDialog') as HTMLDialogElement).showModal();
  });
  setupScanner();

  /* Keyboard */
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* Fokusverlust: gehaltene Gates/Rolls sauber beenden */
  window.addEventListener('beforeunload', (event) => {
    if (setRecorder.state === 'recording') {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('blur', () => {
    heldKeys.clear();
    for (let i = 0; i < 16; i++) {
      stopRoll(i);
      if (state.pads[i]?.mode === 'gate') engine.stop(i);
      padGrid.releasePad(i);
    }
  });

  /* Erstes Sample-Play entsperrt Audio + fragt MIDI an */
  const unlock = () => {
    void unlockAudio();
    if (midi.state === 'idle' && !unlockRequested) {
      unlockRequested = true;
      void midi.init();
    }
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
}

let unlockRequested = false;

function switchTab(tab: 'pad' | 'deck' | 'hw'): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>('.tab-pane').forEach((pane) => {
    pane.classList.toggle('is-active', pane.dataset.pane === tab);
  });
  if (tab === 'hw') scheduleHardware();
}

async function unlockAudio(): Promise<void> {
  if (audio.state !== 'running') {
    try {
      await audio.resume();
    } catch {
      /* Browser verweigert ohne Geste */
    }
  }
}

/* ---------------------------- Keyboard ---------------------------- */

const KEY_MAP: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  q: 4,
  w: 5,
  e: 6,
  r: 7,
  a: 8,
  s: 9,
  d: 10,
  f: 11,
  z: 12,
  x: 13,
  c: 14,
  v: 15,
};

const heldKeys = new Set<string>();

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Regler und Schalter fangen keine Pad-/Loop-Tasten ab – sonst reagiert
  // die Performance nach dem Einstellen eines Faders nicht mehr.
  if (target instanceof HTMLInputElement && ['range', 'checkbox', 'radio', 'button'].includes(target.type)) {
    return false;
  }
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
}

function onKeyDown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoShuffle();
    return;
  }
  if (event.key === 'Escape') {
    stopAll();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    const pad = state.pads[selected];
    if (!pad) return;
    pad.sampleId = null;
    pad.label = 'Empty';
    pad.group = 'other';
    refreshAll();
    persist();
    return;
  }
  if (event.altKey && event.code === 'KeyR') {
    event.preventDefault();
    if (!event.repeat) void toggleSetRecording();
    return;
  }
  if (event.code === 'Space') {
    if (event.repeat) return;
    // Fokus von Buttons lösen, damit Space nicht zusätzlich den Button klickt.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.tagName === 'BUTTON') active.blur();
    event.preventDefault();
    if (event.shiftKey) void toggleRecord();
    else toggleLoop();
    return;
  }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
    const hotkey = event.key.toLowerCase();
    if (hotkey === 'p') {
      event.preventDefault();
      toggleProfile();
      return;
    }
    if (hotkey === 'm') {
      event.preventDefault();
      setMelody(!melodyOn);
      return;
    }
  }
  const padIndex = KEY_MAP[event.key.toLowerCase()];
  if (padIndex === undefined || event.repeat) return;
  event.preventDefault();
  const key = `${event.key.toLowerCase()}:${event.shiftKey ? 's' : 'n'}`;
  if (heldKeys.has(key)) return;
  heldKeys.add(key);
  if (event.shiftKey) {
    startRoll(padIndex, 0.95, 0.0625);
    engine.trigger(padIndex, { velocity: 0.95, quantize: false });
    padGrid.flash(padIndex, 0.95);
  } else {
    triggerPad(padIndex, 0.9);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) return;
  const padIndex = KEY_MAP[event.key.toLowerCase()];
  if (padIndex === undefined) return;
  heldKeys.delete(`${event.key.toLowerCase()}:n`);
  heldKeys.delete(`${event.key.toLowerCase()}:s`);
  releasePad(padIndex);
}

/* ------------------------------ Scan ------------------------------ */

function setupScanner(): void {
  const dialog = $<HTMLDialogElement>('scanDialog');
  const input = $<HTMLInputElement>('folderInput');
  const dropzone = $('dropzone');
  const applyBtn = $<HTMLButtonElement>('applyScanBtn');

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) void runScan(files);
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-hover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-hover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-hover');
    const transfer = event.dataTransfer;
    if (!transfer) return;
    void (async () => {
      const files: File[] = [];
      let rootName = '';
      const items = Array.from(transfer.items ?? []);
      const entries: FileSystemEntry[] = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
        if (entry) entries.push(entry);
        if (entry && !rootName) rootName = entry.name;
      }
      for (const entry of entries) await collectEntry(entry, files);
      if (!files.length) files.push(...Array.from(transfer.files ?? []));
      if (files.length) void runScan(files, rootName);
    })();
  });

  dialog.addEventListener('close', () => {
    lastScan = null;
    applyBtn.disabled = true;
  });

  applyBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void applyScan();
  });
}

async function collectEntry(entry: FileSystemEntry, files: File[], depth = 0): Promise<void> {
  if (files.length > 800 || depth > 6) return;
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (value) => resolve(value),
        () => resolve(null),
      );
    });
    if (file) files.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    await new Promise<void>((resolve) => {
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (!batch.length) resolve();
            else {
              children.push(...batch);
              readBatch();
            }
          },
          () => resolve(),
        );
      };
      readBatch();
    });
    for (const child of children) await collectEntry(child, files, depth + 1);
  }
}

async function runScan(files: File[], packName?: string): Promise<void> {
  const resultHost = $('scanResult');
  clear(resultHost);
  resultHost.appendChild(h('p', 'scan-loading', `Analysiere ${files.length} Dateien …`));
  $('scanSummary').textContent = '';
  const result = await scanFiles(files, packName);
  lastScan = result;
  renderScanResult(result);
  $<HTMLButtonElement>('applyScanBtn').disabled = result.entries.length === 0;
}

function renderScanResult(result: ScanResult): void {
  const host = $('scanResult');
  clear(host);
  $('scanSummary').textContent = `${result.entries.length} Audio-Dateien · ${result.entries.length - result.unknown} erkannt · ${
    result.unknown
  } unbekannt`;

  if (!result.entries.length) {
    host.appendChild(h('p', 'empty-note', 'Keine unterstützten Audiodateien gefunden.'));
    return;
  }

  const groups = h('div', 'scan-groups');
  for (const entry of groupCounts(result)) {
    const meta = GROUP_META[entry.group];
    const group = h('div', 'scan-group');
    const head = h('div', 'scan-group-head');
    const chip = h('span', 'scan-chip', meta.label);
    chip.style.setProperty('--c', meta.color);
    head.append(chip, h('span', 'scan-count', `${entry.count} Sounds`));
    group.appendChild(head);

    const list = h('div', 'scan-items');
    const items = (result.byGroup.get(entry.group) ?? []).slice(0, 8);
    for (const item of items) {
      const node = button(item.label, 'scan-item', () => void previewEntry(item));
      const info = [item.bpm ? `${item.bpm} BPM` : '', item.wav ? `${Math.round(item.wav.sampleRate / 1000)} kHz` : '']
        .filter(Boolean)
        .join(' · ');
      if (info) node.title = info;
      list.appendChild(node);
    }
    if (entry.count > items.length) {
      list.appendChild(h('span', 'scan-more', `+${entry.count - items.length}`));
    }
    group.appendChild(list);
    groups.appendChild(group);
  }
  host.appendChild(groups);

  /* Kit-Vorschau */
  const preview = h('div', 'scan-plan');
  preview.append(h('h4', '', 'Vorschlag Pad-Belegung'));
  const grid = h('div', 'scan-plan-grid');
  result.plan.forEach((entry, index) => {
    const slot = h('div', 'scan-slot');
    const meta = entry ? GROUP_META[entry.group] : null;
    if (meta) slot.style.setProperty('--c', meta.color);
    slot.append(h('span', 'scan-slot-idx', String(index + 1)));
    slot.append(h('span', 'scan-slot-name', entry ? entry.label : 'frei'));
    grid.appendChild(slot);
  });
  preview.appendChild(grid);
  host.appendChild(preview);
}

async function previewEntry(entry: ScanEntry): Promise<void> {
  void unlockAudio();
  try {
    const bytes = await entry.file.arrayBuffer();
    const buffer = await engine.decode(bytes);
    engine.previewBuffer(buffer);
  } catch {
    toast('Vorschau nicht möglich (Format?).', 'error');
  }
}

async function applyScan(): Promise<void> {
  const result = lastScan;
  if (!result) return;
  const applyBtn = $<HTMLButtonElement>('applyScanBtn');
  applyBtn.disabled = true;
  const packId = `scan:${Date.now()}`;
  const padIds: (string | null)[] = [];
  let imported = 0;

  for (let i = 0; i < 16; i++) {
    const entry = result.plan[i];
    if (!entry) {
      padIds.push(null);
      continue;
    }
    setStatus(`Importiere Sound ${i + 1}/16 …`);
    const meta = await importSampleFile(entry.file, {
      group: entry.group,
      sub: entry.sub,
      bpm: entry.bpm,
      label: entry.label,
      packId,
    });
    padIds.push(meta?.id ?? null);
    if (meta) imported++;
  }

  const pack: ScannedPack = {
    id: packId,
    name: result.packName,
    createdAt: Date.now(),
    folder: result.folder,
    padIds,
    total: result.entries.length,
  };
  scannedPacks.unshift(pack);
  saveScannedPacks(scannedPacks);
  renderKitOptions();
  applyScannedPack(pack);
  $<HTMLSelectElement>('kitSelect').value = pack.id;
  ($('scanDialog') as HTMLDialogElement).close();
  toast(`${imported} Sounds übernommen → „${pack.name}“`, 'info', 4000);
}

/* --------------------------- Audio-Ausgang ------------------------ */

async function openOutputDialog(): Promise<void> {
  const dialog = $<HTMLDialogElement>('outputDialog');
  const select = $<HTMLSelectElement>('outputSelect');
  const hint = $('outputHint');
  hint.textContent = 'Geräte werden geladen …';
  clear(select);
  dialog.showModal();

  const ctxWithSink = audio as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
  if (typeof ctxWithSink.setSinkId !== 'function') {
    hint.textContent = 'Dieser Browser kann den Audio-Ausgang nicht umschalten (Chrome/Edge ab 110 unterstützt es).';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    clear(select);
    const fallback = h('option', '', 'Standard-Ausgang') as HTMLOptionElement;
    fallback.value = '';
    select.appendChild(fallback);
    for (const device of outputs) {
      const option = h(
        'option',
        '',
        /flx|ddj|pioneer/i.test(device.label) ? `${device.label} ★` : device.label || 'Audio-Ausgang',
      ) as HTMLOptionElement;
      option.value = device.deviceId;
      select.appendChild(option);
    }
    const active = ctxWithSink.sinkId;
    if (active) select.value = active;
    hint.textContent =
      'Tipp: DDJ-FLX4 wählen – das Gerät stellt seine eigene Soundkarte (Master = Kanäle 1/2, Kopfhörer = 3/4). ' +
      'Gerätenamen erscheinen erst nach erteilter Audio-Berechtigung.';
  } catch {
    hint.textContent = 'Audio-Geräte konnten nicht gelesen werden.';
  }
}

async function applySink(): Promise<void> {
  const select = $<HTMLSelectElement>('outputSelect');
  const hint = $('outputHint');
  const ctxWithSink = audio as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (typeof ctxWithSink.setSinkId !== 'function') return;
  try {
    await ctxWithSink.setSinkId(select.value);
    currentSink = select.value;
    const label = select.selectedOptions[0]?.textContent ?? 'Standard';
    $('outputLabel').textContent = label.replace(' ★', '').slice(0, 18);
    hint.textContent = `Ausgang: ${label}`;
  } catch {
    hint.textContent = 'Ausgang konnte nicht gesetzt werden (Berechtigung?).';
    void currentSink;
  }
}

/* ------------------------------ MIDI ------------------------------ */

let hardwareFrame = 0;

function scheduleHardware(): void {
  if (hardwareFrame) return;
  hardwareFrame = requestAnimationFrame(() => {
    hardwareFrame = 0;
    const open = document.querySelector<HTMLElement>('.tab-pane[data-pane="hw"].is-active');
    if (!open) return;
    const active = document.activeElement;
    if (active && $('hardware').contains(active) && ['SELECT', 'INPUT'].includes(active.tagName)) return;
    hardware.update(selected, state.pads[selected]?.label ?? 'Pad');
  });
}

midi.onPadHit = (hit) => {
  if (hit.shifted) {
    engine.stop(hit.pad);
    stopRoll(hit.pad);
    return;
  }
  if (hit.pressed) triggerPad(hit.pad, hit.velocity);
  else releasePad(hit.pad);
};

let hotcueHeld = false;
let hotcueUsed = false;
midi.onHotcueTap = () => {
  if (!hotcueUsed) toggleProfile();
};
midi.onHotcueHold = (down) => {
  hotcueHeld = down;
  if (down) hotcueUsed = false;
};
midi.onTransport = (action, pressed, deckIndex) => {
  if (!pressed) return;
  const hardwareDeck = deckIndex >= 0 ? deckPlayers[deckIndex] : undefined;
  switch (action) {
    case 'play':
      if (hotcueHeld) {
        hotcueUsed = true;
        if (!loop.events.length) {
          toast('Keine Sequenz – erst REC drücken.', 'warn', 2200);
          break;
        }
        void unlockAudio();
        loop.startPlayback();
        updateLoopUi();
        toast('Sequenz loopt', 'info', 1400);
      } else if (hardwareDeck?.hasTrack) {
        void unlockAudio();
        hardwareDeck.toggle();
        syncDeckLeds();
      } else {
        toggleLoop();
      }
      break;
    case 'cue':
      if (hardwareDeck?.hasTrack) {
        hardwareDeck.cue();
        syncDeckLeds();
      } else {
        stopAll();
      }
      break;
    case 'sync':
      shufflePads();
      break;
    case 'record':
      void toggleRecord();
      break;
    case 'loopIn':
      setMelody(true);
      break;
    case 'loopOut':
      setMelody(false);
      break;
    case 'fourBeat':
      setLoopBars(loop.bars === 1 ? 2 : 1);
      break;
  }
};

midi.onMode = (bank) => {
  state.midi.padBank = bank;
  midi.setModeLed(bank);
  state.midi.allBanks = false;
  persist();
  toast(`Pad-Bank: ${bank.toUpperCase()}`, 'info', 1600);
  scheduleHardware();
};

midi.onJog = (deckIndex, delta) => {
  const deck = deckPlayers[deckIndex];
  if (!deck) return;
  deck.jog(delta);
  decksUi.update();
};

midi.onLearn = (channel, note) => {
  const target = selected;
  midi.bindPad(target, channel, note);
  toast(`Pad ${target + 1} → Kanal ${channel + 1}, Note ${note}`, 'info', 3600);
  renderInspector();
  scheduleHardware();
};

midi.onPersist = () => persist();

midi.onChange = () => {
  scheduleHardware();
  const badge = $('midiBadge');
  badge.classList.toggle('is-on', midi.profile === 'flx4' && midi.connected);
  $('midiBadgeText').textContent =
    midi.profile === 'flx4' && midi.connected
      ? 'FLX4'
      : midi.state === 'ready'
        ? 'MIDI'
        : midi.state === 'requesting'
          ? '…'
          : 'MIDI';
  if (midi.state === 'denied') toast('MIDI-Zugriff verweigert – im Hardware-Tab erneut versuchen.', 'warn', 4200);
  if (midi.profile === 'flx4' && midi.connected) setStatus('DDJ-FLX4 verbunden · Pads 1–8 Deck 1 / 9–16 Deck 2');
};

/* ---------------------------- Rendering --------------------------- */

const vuSegments = Array.from(document.querySelectorAll<HTMLElement>('#masterVu i'));

function updateVu(value: number): void {
  const active = Math.round(Math.min(1, value * 1.15) * vuSegments.length);
  vuSegments.forEach((segment, index) => {
    segment.classList.toggle('is-on', index < active);
    segment.classList.toggle('is-peak', index >= vuSegments.length - 3 && index < active);
  });
}

let lastLed = 0;

function frame(now: number): void {
  engine.levels(levels);
  padGrid.tick(levels);
  updateVu(engine.masterLevel());
  if (now - lastLed > 90) {
    lastLed = now;
    midi.setPadLedsFromLevels(levels);
  }
  requestAnimationFrame(frame);
}

/* ------------------------------ Boot ------------------------------ */

async function boot(): Promise<void> {
  renderKitOptions();
  syncEnginePads();
  padGrid.sync(state.pads, registry);
  padGrid.setSelected(selected);
  updateStage();
  updateVu(0);
  renderInspector();
  bindControls();
  updateProfileUi();
  updateLoopUi();
  updateSetUi();
  decksUi.update();
  syncDeckLeds();
  window.setInterval(() => decksUi.update(), 220);
  midi.onChange?.();

  await loadUserSamples();
  if (getPack(state.kitId)) {
    setStatus('Werks-Samples werden generiert …');
    await ensurePackBuffers(state.kitId);
  }
  refreshAll();
  requestAnimationFrame(frame);

  const missing = state.pads.filter((pad) => pad.sampleId && !engine.hasBuffer(pad.sampleId)).length;
  setStatus(
    missing
      ? `Bereit · ${missing} Pad(s) ohne Sample – im Editor neu zuweisen`
      : 'Bereit · Pad klicken oder Taste 1–4 / Q–R / A–F / Z–V',
  );

  if (midi.supported) {
    $('midiBadge').classList.add('is-ready');
  } else {
    $('midiBadgeText').textContent = 'kein MIDI';
    $('midiBadge').classList.add('is-off');
  }
}

void boot();
