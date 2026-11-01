/* ------------------------------------------------------------------
 * PADFORGE – Web-MIDI / Pioneer DDJ-FLX4 Treiber
 *
 * Der im Umlauf befindliche Name "DDJ-FLX400" existiert offiziell nicht –
 * das Gerät heißt DDJ-FLX4. Beide Schreibweisen werden erkannt.
 *
 * FLX4-Pad-Layer (offizielle MIDI-Liste / Mixxx-Mapping):
 *   Deck 1 Pads = MIDI-Kanal 8  (Status 0x97)
 *   Deck 2 Pads = MIDI-Kanal 10 (Status 0x99)
 *   Shift-Layer = Kanal 9 / 11  (0x98 / 0x9A)
 *   Sampler-Bank = Noten 0x30–0x37 (48–55) je Deck
 *   Pad-Modus-Tasten auf dem Deck-Kanal (0x90/0x91):
 *     0x1B Hot Cue · 0x1E Pad FX · 0x20 Beat Jump · 0x22 Sampler
 *     0x6D Beat Loop · 0x69 Keyboard · 0x6B Pad FX2 · 0x6F Key Shift
 *   Shift = Note 0x3F (63) auf Kanal 1 / 2
 *   Transport (Kanal 1 / 2): Play 0x0B · Cue 0x0C · Loop In/Out 0x10/0x11
 *   Aufnahme: Beat FX ON/OFF = Note 0x47 auf Kanal 5 / 6
 *   Hot Cue kurz = Pad-Profil 1/2 · Hot Cue halten + Play = Loop starten
 *
 * LEDs: dieselbe Note/Status mit Velocity
 *  0x00 = aus · 0x20 = gedimmt · 0x7F = hell
 * (Pioneer dokumentiert genau diese drei Stufen; der Modus "Helligkeit"
 *  sendet zusätzlich kontinuierliche Werte für Pegel-Anzeigen.)
 * ------------------------------------------------------------------ */

import type { MidiSettings, PadBank } from './types';
import { loadBindings, saveBindings, type MidiBinding } from './store';

export const FLX4 = {
  padChannels: [7, 9] as number[],
  shiftPadChannels: [8, 10] as number[],
  deckChannels: [0, 1] as number[],
  samplerBase: 0x30,
  banks: {
    sampler: 0x30,
    hotcue: 0x00,
    padfx: 0x10,
    beatjump: 0x20,
    beatloop: 0x60,
    keyboard: 0x40,
    keyshift: 0x70,
  } as Record<PadBank, number>,
  modeNotes: {
    0x1b: 'hotcue',
    0x1e: 'padfx',
    0x20: 'beatjump',
    0x22: 'sampler',
    0x6d: 'beatloop',
    0x69: 'keyboard',
    0x6b: 'padfx',
    0x6f: 'keyshift',
  } as Record<number, PadBank>,
  /** LED-Noten der Pad-Modus-Tasten (Deck-Kanal) */
  modeLedNotes: {
    hotcue: 0x1b,
    padfx: 0x1e,
    beatjump: 0x20,
    sampler: 0x22,
    beatloop: 0x6d,
    keyboard: 0x69,
    keyshift: 0x6f,
  } as Record<PadBank, number>,
  shiftNote: 0x3f,
  transport: {
    play: 0x0b,
    cue: 0x0c,
    loopIn: 0x10,
    loopOut: 0x11,
    fourBeat: 0x4d,
    sync: 0x58,
  },
  recordNote: 0x47,
  recordChannels: [4, 5] as number[],
};

export type TransportAction = 'play' | 'cue' | 'loopIn' | 'loopOut' | 'fourBeat' | 'sync' | 'record';

function transportFromNote(note: number): TransportAction | null {
  switch (note) {
    case FLX4.transport.play:
      return 'play';
    case FLX4.transport.cue:
      return 'cue';
    case FLX4.transport.loopIn:
      return 'loopIn';
    case FLX4.transport.loopOut:
      return 'loopOut';
    case FLX4.transport.fourBeat:
      return 'fourBeat';
    case FLX4.transport.sync:
      return 'sync';
    default:
      return null;
  }
}

/** SysEx-Keepalive aus dem Mixxx-Mapping (fordert alle Reglerpositionen an). */
const FLX4_SYSEX = [0xf0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x05, 0x00, 0x50, 0x02, 0xf7];

export type MidiState = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

export interface MidiPort {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export interface MidiLogEntry {
  time: string;
  text: string;
  tone: 'in' | 'out' | 'sys';
}

export interface PadHit {
  pad: number;
  velocity: number;
  pressed: boolean;
  note: number;
  channel: number;
  deck: number;
  shifted: boolean;
}

const FLX4_NAME = /ddj[\s_-]?flx[\s_-]?4|ddj[\s_-]?flx[\s_-]?400|flx[\s_-]?4\b|flx[\s_-]?400/i;

export function isFlx4Name(name: string): boolean {
  return FLX4_NAME.test(name);
}

export class MidiController {
  state: MidiState = 'idle';
  sysex = false;
  profile: 'flx4' | 'generic' | 'none' = 'none';
  portsIn: MidiPort[] = [];
  portsOut: MidiPort[] = [];
  inputId: string | null = null;
  outputId: string | null = null;
  log: MidiLogEntry[] = [];
  settings: MidiSettings;

  onPadHit: ((hit: PadHit) => void) | null = null;
  onMode: ((bank: PadBank) => void) | null = null;
  onShift: ((down: boolean) => void) | null = null;
  onHotcueTap: (() => void) | null = null;
  onHotcueHold: ((down: boolean) => void) | null = null;
  onTransport: ((action: TransportAction, pressed: boolean, deck: number) => void) | null = null;
  onJog: ((deck: number, delta: number) => void) | null = null;
  onChange: (() => void) | null = null;
  onLearn: ((channel: number, note: number) => void) | null = null;
  onPersist: (() => void) | null = null;

  learnTarget: number | null = null;

  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private ledState = new Array<number>(16).fill(-1);
  private baseLeds = new Array<number>(16).fill(0);
  private keepAliveTimer: number | null = null;
  private bindings: MidiBinding[] = loadBindings();
  private shiftDown = false;
  private manualDisconnect = false;
  private hotcueDownAt = 0;
  private profileIndex: 0 | 1 = 0;
  private ledHoldUntil = new Float64Array(16);
  private pulseTimers: number[] = new Array(16).fill(0);
  private transportState = {
    playing: false,
    recording: false,
    melody: false,
    deckPlaying: [false, false] as [boolean, boolean],
  };

  constructor(settings: MidiSettings) {
    this.settings = settings;
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  get connected(): boolean {
    return this.state === 'ready' && Boolean(this.input);
  }

  /* --------------------------- Verbindung -------------------------- */

  async init(): Promise<void> {
    if (!this.supported) {
      this.state = 'unsupported';
      this.onChange?.();
      return;
    }
    if (this.state === 'requesting') return;

    if (this.access) {
      this.state = 'ready';
      this.manualDisconnect = false;
      this.refresh();
      return;
    }

    this.state = 'requesting';
    this.onChange?.();
    try {
      if (this.settings.sysex) {
        try {
          this.access = await navigator.requestMIDIAccess({ sysex: true });
          this.sysex = true;
        } catch {
          this.access = await navigator.requestMIDIAccess();
          this.sysex = false;
        }
      } else {
        this.access = await navigator.requestMIDIAccess();
        this.sysex = false;
      }
      this.access.onstatechange = () => this.refresh();
      this.state = 'ready';
      this.manualDisconnect = false;
      this.refresh();
      this.startKeepAlive();
    } catch (error) {
      const name = (error as DOMException | undefined)?.name;
      this.state = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
      this.pushLog(`MIDI-Zugriff fehlgeschlagen (${name ?? 'Fehler'})`, 'sys');
    }
    this.onChange?.();
  }

  /** Explizit verbinden (auch nach "Trennen"). */
  async connect(): Promise<void> {
    this.manualDisconnect = false;
    if (!this.access) {
      await this.init();
      return;
    }
    this.state = 'ready';
    this.refresh();
  }

  /** Alle Ports freigeben – der Browser behält die Berechtigung. */
  disconnect(): void {
    this.manualDisconnect = true;
    this.clearLeds();
    if (this.input) this.input.onmidimessage = null;
    this.input = null;
    this.output = null;
    this.inputId = null;
    this.outputId = null;
    this.settings.inputId = null;
    this.settings.outputId = null;
    this.profile = 'none';
    this.state = 'idle';
    this.onPersist?.();
    this.onChange?.();
  }

  refresh(): void {
    if (!this.access) {
      this.portsIn = [];
      this.portsOut = [];
      this.onChange?.();
      return;
    }

    this.portsIn = [];
    this.access.inputs.forEach((input) => {
      this.portsIn.push({
        id: input.id,
        name: input.name ?? 'Unbekannt',
        manufacturer: input.manufacturer ?? '',
        state: input.state,
      });
    });
    this.portsOut = [];
    this.access.outputs.forEach((output) => {
      this.portsOut.push({
        id: output.id,
        name: output.name ?? 'Unbekannt',
        manufacturer: output.manufacturer ?? '',
        state: output.state,
      });
    });
    this.portsIn.sort((a, b) => Number(isFlx4Name(b.name)) - Number(isFlx4Name(a.name)) || a.name.localeCompare(b.name));
    this.portsOut.sort((a, b) => Number(isFlx4Name(b.name)) - Number(isFlx4Name(a.name)) || a.name.localeCompare(b.name));

    if (this.manualDisconnect) {
      this.bindInput(null);
      this.bindOutput(null);
    } else {
      const input = this.resolveInput();
      this.bindInput(input);
      this.bindOutput(this.resolveOutput(input));
    }

    this.profile = this.manualDisconnect ? 'none' : this.detectProfile();

    if (this.profile === 'flx4' && this.settings.ledFeedback) {
      this.syncHardwareLeds();
      // Manche Ports sind erst wenige Millisekunden nach dem Öffnen sendebereit.
      window.setTimeout(() => {
        if (this.manualDisconnect || this.profile !== 'flx4' || !this.settings.ledFeedback) return;
        this.repaintLeds(true);
        this.setProfileLed(this.profileIndex);
        this.applyTransportLeds();
      }, 220);
    }

    this.onPersist?.();
    this.onChange?.();
  }

  /** Eingang manuell wählen (Verbindungsmanager). */
  setInput(id: string): void {
    const port = this.portsIn.find((entry) => entry.id === id) ?? null;
    this.manualDisconnect = false;
    this.bindInput(port);
    if (port) this.bindOutput(this.resolveOutput(port));
    this.profile = this.detectProfile();
    if (this.state === 'idle') this.state = this.access ? 'ready' : 'idle';
    if (this.profile === 'flx4') this.syncHardwareLeds();
    this.onPersist?.();
    this.onChange?.();
  }

  /** LED-Ausgang manuell wählen. */
  setOutput(id: string): void {
    const port = this.portsOut.find((entry) => entry.id === id) ?? null;
    this.bindOutput(port);
    if (this.profile === 'flx4') this.syncHardwareLeds();
    this.onPersist?.();
    this.onChange?.();
  }

  private resolveInput(): MidiPort | null {
    const connected = this.portsIn.filter((port) => port.state === 'connected');
    if (this.settings.inputId) {
      const wanted = connected.find((port) => port.id === this.settings.inputId);
      if (wanted) return wanted;
    }
    return connected.find((port) => isFlx4Name(port.name)) ?? connected[0] ?? null;
  }

  private resolveOutput(input: MidiPort | null): MidiPort | null {
    const connected = this.portsOut.filter((port) => port.state === 'connected');
    if (this.settings.outputId) {
      const wanted = connected.find((port) => port.id === this.settings.outputId);
      if (wanted) return wanted;
    }
    if (input) {
      const sameName = connected.find((port) => port.name === input.name);
      if (sameName) return sameName;
    }
    return connected.find((port) => isFlx4Name(port.name)) ?? connected[0] ?? null;
  }

  private bindInput(port: MidiPort | null): void {
    const next = port && this.access ? this.access.inputs.get(port.id) ?? null : null;
    if (this.input && this.input !== next) this.input.onmidimessage = null;
    this.input = next;
    this.inputId = next?.id ?? null;
    if (next) {
      next.onmidimessage = (event) => this.handleMessage(event);
      this.settings.inputId = next.id;
    }
  }

  private bindOutput(port: MidiPort | null): void {
    const next = port && this.access ? this.access.outputs.get(port.id) ?? null : null;
    this.output = next;
    this.outputId = next?.id ?? null;
    if (next) {
      this.settings.outputId = next.id;
      try {
        void next.open().then(
          () => {
            if (this.profile === 'flx4' && this.settings.ledFeedback) this.syncHardwareLeds();
          },
          () => undefined,
        );
      } catch {
        /* Port bereits geschlossen */
      }
    }
  }

  private detectProfile(): 'flx4' | 'generic' | 'none' {
    // Aktiver Eingang entscheidet – sonst würde ein nur angesteckter FLX4
    // das Mapping für einen anderen Controller übernehmen.
    if (this.input) return isFlx4Name(this.input.name ?? '') ? 'flx4' : 'generic';
    const hasFlx4 = [...this.portsIn, ...this.portsOut].some((port) => isFlx4Name(port.name));
    if (hasFlx4) return 'flx4';
    if (this.portsIn.length || this.portsOut.length) return 'generic';
    return 'none';
  }

  private startKeepAlive(): void {
    if (this.keepAliveTimer !== null) return;
    this.keepAliveTimer = window.setInterval(() => {
      if (this.sysex && this.profile === 'flx4') this.sendBytes(FLX4_SYSEX);
    }, 5000);
    if (this.sysex && this.profile === 'flx4') this.sendBytes(FLX4_SYSEX);
  }

  private sendBytes(bytes: number[]): void {
    if (!this.output) return;
    try {
      this.output.send(bytes);
    } catch {
      /* Port getrennt */
    }
  }

  /* ----------------------------- Input ---------------------------- */

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;
    const status = data[0];
    const d1 = data[1];
    const d2 = data[2];
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const note = d1;
    const velocity = d2;
    const isNote = command === 0x90;
    const isCc = command === 0xb0;

    if (isNote && velocity > 0) this.pushLog(`ch${channel + 1} Note ${note} vel ${velocity}`, 'in');
    else if (isCc) this.pushLog(`ch${channel + 1} CC ${note} = ${velocity}`, 'in');

    if (isCc) {
      // Jog / Platter: 0x21 Side-Jog, 0x22/0x23 Platter (Vinyl an/aus).
      if (
        this.profile === 'flx4' &&
        FLX4.deckChannels.includes(channel) &&
        (note === 0x21 || note === 0x22 || note === 0x23)
      ) {
        const delta = velocity - 0x40;
        if (delta !== 0) this.onJog?.(channel, delta);
      }
      return;
    }

    if (!isNote && command !== 0x80) return;
    const pressed = command === 0x90 && velocity > 0;

    if (!pressed) {
      if (this.profile === 'flx4' && FLX4.deckChannels.includes(channel)) {
        if (note === FLX4.shiftNote) {
          this.shiftDown = false;
          this.onShift?.(false);
          return;
        }
        if (note === FLX4.modeLedNotes.hotcue) {
          const heldMs = performance.now() - this.hotcueDownAt;
          this.onHotcueHold?.(false);
          if (heldMs < 420) this.onHotcueTap?.();
          return;
        }
        const action = transportFromNote(note);
        if (action) {
          this.onTransport?.(action, false, channel);
          return;
        }
      }
      const hit = this.resolvePad(channel, note, false);
      if (hit) this.emitHit(hit, false, velocity);
      return;
    }

    if (this.learnTarget !== null && this.onLearn) {
      this.learnTarget = null;
      this.onLearn(channel, note);
      this.pushLog(`Learn: ch${channel + 1} Note ${note}`, 'sys');
      return;
    }

    if (this.profile === 'flx4' && FLX4.deckChannels.includes(channel) && note === FLX4.shiftNote) {
      this.shiftDown = true;
      this.onShift?.(true);
      return;
    }

    if (this.profile === 'flx4' && FLX4.deckChannels.includes(channel) && note === FLX4.modeLedNotes.hotcue) {
      this.hotcueDownAt = performance.now();
      this.onHotcueHold?.(true);
      // Die physische Taste schaltet das Gerät in den Hot-Cue-Modus – die
      // LED-Noten müssen sofort auf die 0x00-Bank wechseln.
      if (this.settings.padBank !== 'hotcue') {
        this.settings.padBank = 'hotcue';
        this.setModeLed('hotcue');
        this.onPersist?.();
      }
      this.pushLog('Hot Cue: kurz = Profil, halten + Play = Loop', 'sys');
      return;
    }

    if (this.profile === 'flx4' && FLX4.deckChannels.includes(channel)) {
      const action = transportFromNote(note);
      if (action) {
        this.onTransport?.(action, true, channel);
        this.pushLog(`Transport: ${action}`, 'sys');
        return;
      }
    }

    if (this.profile === 'flx4' && FLX4.recordChannels.includes(channel) && note === FLX4.recordNote) {
      this.onTransport?.('record', true, -1);
      this.pushLog('Transport: record', 'sys');
      return;
    }

    if (this.profile === 'flx4' && FLX4.deckChannels.includes(channel) && FLX4.modeNotes[note]) {
      const bank = FLX4.modeNotes[note];
      this.onMode?.(bank);
      this.pushLog(`Pad-Modus: ${bank}`, 'sys');
      return;
    }

    const hit = this.resolvePad(channel, note, true);
    if (hit) {
      this.emitHit(hit, true, velocity);
      return;
    }

    if (note >= 36 && note <= 51 && this.profile !== 'flx4') {
      this.onPadHit?.({
        pad: note - 36,
        velocity: velocity / 127,
        pressed: true,
        note,
        channel,
        deck: 0,
        shifted: false,
      });
    }
  }

  private resolvePad(channel: number, note: number, pressed: boolean): PadHit | null {
    const binding = this.bindings.find((entry) => entry.channel === channel && entry.note === note);
    if (binding) {
      return { pad: binding.pad, velocity: 1, pressed, note, channel, deck: 0, shifted: false };
    }

    if (this.profile !== 'flx4') return null;

    const padDeck = FLX4.padChannels.indexOf(channel);
    const shiftDeck = FLX4.shiftPadChannels.indexOf(channel);
    const deck = padDeck >= 0 ? padDeck : shiftDeck;
    if (deck < 0) return null;
    const shifted = shiftDeck >= 0;
    if (shifted && !this.settings.shiftStops) return null;

    const bases = this.settings.allBanks
      ? Object.values(FLX4.banks)
      : [FLX4.banks[this.settings.padBank] ?? FLX4.samplerBase];

    for (const base of bases) {
      const offset = note - base;
      if (offset >= 0 && offset < 8) {
        const pad = deck * 8 + offset;
        if (pad < 0 || pad > 15) return null;
        if (shifted) {
          return { pad, velocity: 0, pressed: false, note, channel, deck, shifted: true };
        }
        return { pad, velocity: 1, pressed, note, channel, deck, shifted: false };
      }
    }
    return null;
  }

  private emitHit(hit: PadHit, pressed: boolean, rawVelocity: number): void {
    this.onPadHit?.({
      ...hit,
      pressed,
      velocity: Math.max(0.15, Math.min(1, rawVelocity / 127)),
    });
    if (pressed) {
      // Folgt der Hardware-Bank automatisch: ein Hit aus Hot Cue / Pad FX
      // synchronisiert auch die LED-Noten, ohne dass etwas eingestellt wird.
      const bank = this.bankForNote(hit.note);
      if (bank && bank !== this.settings.padBank) {
        this.settings.padBank = bank;
        this.setModeLed(bank);
        this.onPersist?.();
      }
      this.pulsePad(hit.pad);
    }
  }

  /* ----------------------------- LEDs ----------------------------- */

  /** Grundhelligkeit der 16 Pads (z. B. gedimmt, wenn belegt). */
  setBaseLeds(values: number[]): void {
    for (let i = 0; i < 16; i++) this.baseLeds[i] = Math.max(0, Math.min(127, values[i] ?? 0));
    this.repaintLeds();
  }

  repaintLeds(force = false): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    const now = performance.now();
    for (let i = 0; i < 16; i++) {
      if (!force && now < this.ledHoldUntil[i]) continue;
      this.setPadLed(i, this.baseLeds[i] ?? 0, force);
    }
  }

  /** Kurzer heller Impuls, der nicht vom Pegel-Repaint überschrieben wird. */
  pulsePad(pad: number): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    if (pad < 0 || pad > 15) return;
    this.ledHoldUntil[pad] = performance.now() + 180;
    this.setPadLed(pad, 0x7f, true);
    window.clearTimeout(this.pulseTimers[pad]);
    this.pulseTimers[pad] = window.setTimeout(() => {
      this.ledHoldUntil[pad] = 0;
      this.setPadLed(pad, this.baseLeds[pad] ?? 0, true);
    }, 190);
  }

  private ledValueFor(level: number): number {
    if (this.settings.ledMode === 'brightness') {
      return Math.round(0x18 + Math.max(0, Math.min(1, level)) * (0x7f - 0x18));
    }
    // Im Stufenmodus erst ab spürbarem Pegel hell schalten, damit die Pads
    // nicht bei jedem Krümel flackern.
    return level > 0.22 ? 0x7f : 0x20;
  }

  setPadLed(pad: number, value: number, force = false): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    if (pad < 0 || pad > 15) return;

    let level = Math.max(0, Math.min(127, Math.round(value)));
    if (this.settings.ledMode === 'binary') {
      // Von Pioneer dokumentierte Stufen: aus / gedimmt / hell
      level = level === 0 ? 0 : level >= 0x50 ? 0x7f : 0x20;
    }
    if (!force && Math.abs(level - this.ledState[pad]) < 6) return;

    this.ledState[pad] = level;
    this.sendPadRaw(pad, level);
  }

  private sendPadRaw(pad: number, level: number): void {
    const deck = Math.floor(pad / 8);
    const channel = FLX4.padChannels[deck] ?? FLX4.padChannels[0];
    // Die LED-Bank muss dem aktiven Hardware-Modus folgen, sonst leuchten
    // die Pads im Hot-Cue-/Pad-FX-Modus ins Leere.
    const base = FLX4.banks[this.settings.padBank] ?? FLX4.samplerBase;
    const note = base + (pad % 8);
    this.sendBytes([0x90 | channel, note, Math.max(0, Math.min(127, level))]);
  }

  private bankForNote(note: number): PadBank | null {
    for (const [bank, base] of Object.entries(FLX4.banks) as [PadBank, number][]) {
      if (note >= base && note < base + 8) return bank;
    }
    return null;
  }

  setPadLedsFromLevels(levels: Float32Array<ArrayBuffer>): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    const now = performance.now();
    for (let i = 0; i < 16; i++) {
      if (now < this.ledHoldUntil[i]) continue;
      const level = Math.max(0, Math.min(1, levels[i]));
      const target = level > 0.035 ? this.ledValueFor(level) : this.baseLeds[i] ?? 0;
      this.setPadLed(i, target);
    }
  }

  /** Modus-Taste leuchten lassen; Gerät löscht beim Moduswechsel die Pad-LEDs. */
  setModeLed(bank: PadBank): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    for (const channel of FLX4.deckChannels) {
      for (const [key, note] of Object.entries(FLX4.modeLedNotes)) {
        this.sendBytes([0x90 | channel, note, key === bank ? 0x7f : 0x00]);
      }
    }
    window.setTimeout(() => {
      this.repaintLeds(true);
      this.setProfileLed(this.profileIndex);
    }, 150);
  }

  /** Aktives Pad-Profil an der Hot-Cue-Taste anzeigen (gedimmt/hell). */
  setProfile(profile: 0 | 1): void {
    this.profileIndex = profile;
    this.setProfileLed(profile);
  }

  private setProfileLed(profile: 0 | 1): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    for (const channel of FLX4.deckChannels) {
      this.sendBytes([0x90 | channel, FLX4.modeLedNotes.hotcue, profile === 0 ? 0x20 : 0x7f]);
    }
  }

  /** Play-/Loop-/Aufnahme-LEDs passend zum Performance-Zustand. */
  setTransportState(
    state: Partial<{ playing: boolean; recording: boolean; melody: boolean; deckPlaying: [boolean, boolean] }>,
  ): void {
    this.transportState = { ...this.transportState, ...state };
    this.applyTransportLeds();
  }

  private applyTransportLeds(): void {
    if (this.profile !== 'flx4' || !this.settings.ledFeedback) return;
    const { playing, recording, melody, deckPlaying } = this.transportState;
    FLX4.deckChannels.forEach((channel, index) => {
      const deckOn = deckPlaying[index] || playing;
      this.sendBytes([0x90 | channel, FLX4.transport.play, deckOn ? 0x7f : 0x20]);
      this.sendBytes([0x90 | channel, FLX4.transport.cue, 0x00]);
      this.sendBytes([0x90 | channel, FLX4.transport.loopIn, melody ? 0x7f : 0x00]);
      this.sendBytes([0x90 | channel, FLX4.transport.loopOut, melody ? 0x20 : 0x00]);
    });
    for (const channel of FLX4.recordChannels) {
      this.sendBytes([0x90 | channel, FLX4.recordNote, recording ? 0x7f : 0x00]);
    }
  }

  syncHardwareLeds(): void {
    if (this.profile !== 'flx4') return;
    this.setModeLed(this.settings.padBank);
    this.repaintLeds(true);
    this.setProfileLed(this.profileIndex);
    this.applyTransportLeds();
  }

  testLeds(): void {
    if (this.profile !== 'flx4') return;
    for (let i = 0; i < 16; i++) this.sendPadRaw(i, 0x7f);
    for (const channel of FLX4.deckChannels) {
      this.sendBytes([0x90 | channel, FLX4.modeLedNotes[this.settings.padBank], 0x7f]);
    }
    window.setTimeout(() => {
      this.repaintLeds(true);
      this.setProfileLed(this.profileIndex);
      this.applyTransportLeds();
    }, 900);
  }

  clearLeds(): void {
    if (this.profile !== 'flx4' && !this.output) return;
    for (let i = 0; i < 16; i++) {
      this.ledState[i] = 0;
      this.sendPadRaw(i, 0);
    }
    for (const channel of FLX4.deckChannels) {
      for (const note of Object.values(FLX4.modeLedNotes)) {
        this.sendBytes([0x90 | channel, note, 0x00]);
      }
      for (const note of Object.values(FLX4.transport)) {
        this.sendBytes([0x90 | channel, note, 0x00]);
      }
    }
    for (const channel of FLX4.recordChannels) {
      this.sendBytes([0x90 | channel, FLX4.recordNote, 0x00]);
    }
  }

  /* --------------------------- Bindings --------------------------- */

  bindPad(pad: number, channel: number, note: number): void {
    this.bindings = this.bindings.filter((entry) => entry.pad !== pad);
    this.bindings.push({ pad, channel, note });
    saveBindings(this.bindings);
    this.onChange?.();
  }

  clearBinding(pad: number): void {
    this.bindings = this.bindings.filter((entry) => entry.pad !== pad);
    saveBindings(this.bindings);
    this.onChange?.();
  }

  bindingFor(pad: number): MidiBinding | null {
    return this.bindings.find((entry) => entry.pad === pad) ?? null;
  }

  startLearn(pad: number): void {
    this.learnTarget = pad;
    this.onChange?.();
  }

  cancelLearn(): void {
    this.learnTarget = null;
    this.onChange?.();
  }

  /* ----------------------------- Log ------------------------------ */

  private pushLog(text: string, tone: MidiLogEntry['tone']): void {
    const now = new Date();
    const time = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(
      now.getMilliseconds(),
    ).padStart(3, '0')}`;
    this.log.unshift({ time, text, tone });
    if (this.log.length > 40) this.log.pop();
    this.onChange?.();
  }

  get shift(): boolean {
    return this.shiftDown;
  }
}

export const flx4MappingTable = [
  { label: 'Deck 1 · Pads 1–8', channel: '8', status: '0x97', notes: '0x30–0x37' },
  { label: 'Deck 2 · Pads 9–16', channel: '10', status: '0x99', notes: '0x30–0x37' },
  { label: 'Shift-Layer', channel: '9 / 11', status: '0x98 / 0x9A', notes: 'Stop / Choke' },
  { label: 'Pad-LEDs', channel: '8 / 10', status: '0x97 / 0x99', notes: '0x00 / 0x20 / 0x7F' },
  { label: 'Hot Cue · kurz = Profil 1/2', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x1B' },
  { label: 'Hot Cue halten + Play', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x1B + 0x0B' },
  { label: 'Play · Deck / Loop', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x0B' },
  { label: 'Cue · Deck / alles stoppen', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x0C' },
  { label: 'Beat Sync · Pads mischen', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x58' },
  { label: 'Jog Wheel · Track / Scrub', channel: '1 / 2', status: '0xB0 / 0xB1', notes: 'CC 0x21 / 0x22 / 0x23' },
  { label: 'Loop In · Melodie an', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x10' },
  { label: 'Loop Out · Melodie aus', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x11' },
  { label: '4 Beat · Loop-Länge 1/2 Bars', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x4D' },
  { label: 'Beat FX ON/OFF · Aufnahme', channel: '5 / 6', status: '0x94 / 0x95', notes: '0x47' },
  { label: 'Pad FX / Beat Jump / Sampler', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x1E / 0x20 / 0x22' },
  { label: 'Shift', channel: '1 / 2', status: '0x90 / 0x91', notes: '0x3F' },
];
