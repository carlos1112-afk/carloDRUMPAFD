/* ------------------------------------------------------------------
 * PADFORGE – Audio-Engine
 *
 * • 16 unabhängige Pad-Ketten mit eigenem Analyser (für das Licht)
 * • One-Shot / Gate / Toggle / Loop, Choke-Gruppen, Quantize, Roll
 * • Master-FX (Filter, Reverb, Delay, momentary Pad-FX)
 * • Metrik pro Pad für die Hardware-LEDs
 * ------------------------------------------------------------------ */

import type { PadConfig } from '../types';
import { clamp } from '../types';
import { reverseBuffer } from './synth';

export interface Voice {
  pad: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  startAt: number;
  endAt: number;
  loop: boolean;
}

interface PadChain {
  input: GainNode;
  analyser: AnalyserNode;
  panner: StereoPannerNode;
  level: GainNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  data: Float32Array<ArrayBuffer>;
}

export interface TriggerOptions {
  velocity?: number;
  quantize?: boolean;
  time?: number;
  /** Ignoriert Pad-Attack/Release (für Roll-Retrigger). */
  fast?: boolean;
  /** Zusätzliche Transposition in Halbtönen (Zufalls-Melodien). */
  pitch?: number;
}

const FX_LABELS = ['LP', 'HP', 'Echo', 'Gate'] as const;
export type MasterFx = (typeof FX_LABELS)[number];
export const MASTER_FX = FX_LABELS;

export class AudioEngine {
  ctx: AudioContext;
  readonly pads: PadConfig[];

  private masterIn: GainNode;
  private masterGain: GainNode;
  private lp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  private limiter: DynamicsCompressorNode;
  private masterAnalyser: AnalyserNode;
  private masterData: Float32Array<ArrayBuffer>;

  private reverbBus: GainNode;
  private reverbReturn: GainNode;
  private delayBus: GainNode;
  private delayNode: DelayNode;
  private delayFeedback: GainNode;
  private delayReturn: GainNode;

  private chains: PadChain[] = [];
  private voices: (Voice | null)[] = new Array(16).fill(null);
  private reversed = new Map<string, AudioBuffer>();
  private buffers = new Map<string, AudioBuffer>();
  private gateLfo: OscillatorNode | null = null;
  private gateGain: GainNode | null = null;

  bpm = 124;
  private transportStart = 0;
  private masterVolume = 0.82;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.pads = [];

    this.masterIn = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.lp.Q.value = 0.6;
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 18;
    this.hp.Q.value = 0.6;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterData = new Float32Array(this.masterAnalyser.fftSize);

    this.masterIn.connect(this.lp);
    this.lp.connect(this.hp);
    this.hp.connect(this.limiter);
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(ctx.destination);

    // Hall
    this.reverbBus = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(2.4, 2.6);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.18;
    this.reverbBus.connect(convolver);
    convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterIn);

    // Delay (tempo-synchron, 3/16)
    this.delayBus = ctx.createGain();
    this.delayNode = ctx.createDelay(2);
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.36;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.14;
    this.delayBus.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayReturn);
    this.delayReturn.connect(this.masterIn);
    this.setBpm(124);

    for (let i = 0; i < 16; i++) {
      this.chains.push(this.buildChain());
    }
  }

  private buildChain(): PadChain {
    const input = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    const panner = this.ctx.createStereoPanner();
    const level = this.ctx.createGain();
    const reverbSend = this.ctx.createGain();
    reverbSend.gain.value = 0;
    const delaySend = this.ctx.createGain();
    delaySend.gain.value = 0;

    input.connect(analyser);
    analyser.connect(panner);
    panner.connect(level);
    level.connect(this.masterIn);
    level.connect(reverbSend);
    reverbSend.connect(this.reverbBus);
    level.connect(delaySend);
    delaySend.connect(this.delayBus);

    return {
      input,
      analyser,
      panner,
      level,
      reverbSend,
      delaySend,
      data: new Float32Array(analyser.fftSize),
    };
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  /* ----------------------------- Samples ---------------------------- */

  registerBuffer(id: string, buffer: AudioBuffer): void {
    this.buffers.set(id, buffer);
    this.reversed.delete(id);
  }

  hasBuffer(id: string | null): boolean {
    return Boolean(id && this.buffers.has(id));
  }

  getBuffer(id: string | null): AudioBuffer | null {
    if (!id) return null;
    return this.buffers.get(id) ?? null;
  }

  bufferInfo(id: string | null): { duration: number; sampleRate: number; channels: number } | null {
    const b = this.getBuffer(id);
    if (!b) return null;
    return { duration: b.duration, sampleRate: b.sampleRate, channels: b.numberOfChannels };
  }

  private bufferFor(pad: PadConfig): AudioBuffer | null {
    const base = this.getBuffer(pad.sampleId);
    if (!base) return null;
    if (!pad.reverse) return base;
    const key = pad.sampleId as string;
    let rev = this.reversed.get(key);
    if (!rev) {
      rev = reverseBuffer(base);
      this.reversed.set(key, rev);
    }
    return rev;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  /** Einmalige Vorschau ohne Pad-Konfiguration (Sample-Picker/Scanner). */
  previewBuffer(buffer: AudioBuffer, gain = 0.85): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.masterIn);
    src.start();
  }

  /* ----------------------------- Tempo ------------------------------ */

  setBpm(bpm: number): void {
    this.bpm = clamp(bpm, 40, 240);
    const beat = 60 / this.bpm;
    this.delayNode.delayTime.setTargetAtTime(beat * 0.75, this.ctx.currentTime, 0.02);
    if (!this.transportStart) this.transportStart = this.ctx.currentTime;
  }

  resetTransport(): void {
    this.transportStart = this.ctx.currentTime;
  }

  /** Nächster musikalischer Rasterpunkt (in Sekunden). */
  nextGrid(subdivisionBeats: number): number {
    const now = this.ctx.currentTime;
    if (!this.transportStart || this.transportStart > now) this.transportStart = now;
    const beat = 60 / this.bpm;
    const beatsSince = (now - this.transportStart) / beat;
    const grid = Math.ceil(beatsSince / subdivisionBeats + 0.001) * subdivisionBeats;
    let t = this.transportStart + grid * beat;
    if (t - now < 0.015) t += subdivisionBeats * beat;
    return t;
  }

  /** Position im musikalischen Raster (0..1 einer 1-Bar-Phase). */
  private phaseAt(time: number, barSeconds: number): number {
    const rel = Math.max(0, time - this.transportStart);
    return (rel % barSeconds) / barSeconds;
  }

  /* ---------------------------- Trigger ----------------------------- */

  trigger(padIndex: number, opts: TriggerOptions = {}): Voice | null {
    const pad = this.pads[padIndex];
    if (!pad) return null;
    const buffer = this.bufferFor(pad);
    if (!buffer) return null;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const quantize = opts.quantize ?? false;

    let startAt = opts.time ?? now;
    if (quantize && pad.mode !== 'loop') {
      const grid = this.quantizeBeats();
      if (grid > 0) startAt = this.nextGrid(grid);
    }

    // Choke-Gruppen: andere Pads der gleichen Gruppe stoppen
    if (pad.choke > 0) {
      for (let i = 0; i < this.pads.length; i++) {
        const other = this.pads[i];
        if (i !== padIndex && other && other.choke === pad.choke) this.stop(i, true);
      }
    }
    // Retrigger: vorherige Stimme dieses Pads immer beenden (kein Überlagern)
    this.stop(padIndex, true);

    const velocity = pad.velocitySensitive
      ? clamp(opts.velocity ?? 1, 0.05, 1)
      : clamp(pad.fixedVelocity, 0.05, 1);

    const semitones = pad.pitch + (opts.pitch ?? 0);
    const rate = Math.pow(2, semitones / 12) * (pad.mode === 'loop' && pad.sync ? this.bpm / 120 : 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const isLoop = pad.mode === 'loop';
    src.loop = isLoop;

    const filter = ctx.createBiquadFilter();
    filter.type = pad.filterType === 'none' ? 'allpass' : pad.filterType;
    const cutoff = pad.cutoff >= 0.999 ? 20000 : 200 * Math.pow(90, pad.cutoff);
    filter.frequency.value = pad.filterType === 'none' ? 20000 : cutoff;
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    const chain = this.chains[padIndex];
    src.connect(filter);
    filter.connect(gain);
    gain.connect(chain.input);

    chain.panner.pan.setTargetAtTime(pad.pan, now, 0.01);
    chain.level.gain.setTargetAtTime(pad.gain, now, 0.01);
    chain.reverbSend.gain.setTargetAtTime(pad.sendReverb, now, 0.02);
    chain.delaySend.gain.setTargetAtTime(pad.sendDelay, now, 0.02);

    const peak = clamp(velocity, 0.02, 1);
    const attack = opts.fast ? 0.001 : clamp(pad.attack, 0.0005, 0.5);
    const offset = clamp(pad.start, 0, 0.95) * buffer.duration;

    // Loop-Phase auf das Raster legen, damit alle Loops synchron laufen
    let playOffset = offset;
    if (isLoop && pad.sync) {
      const loopSeconds = Math.max(0.05, (buffer.duration - offset) / rate);
      const phase = this.phaseAt(startAt, loopSeconds);
      playOffset = offset + phase * (buffer.duration - offset);
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    const decay = pad.mode === 'oneshot' || pad.mode === 'loop' ? clamp(pad.decay, 0, 8) : 0;
    if (decay > 0) {
      gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
    } else {
      gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    }

    const endAt = startAt + (decay > 0 ? attack + decay : (buffer.duration - playOffset) / Math.max(rate, 0.01));

    try {
      src.start(startAt, playOffset);
    } catch {
      src.start(startAt);
    }
    if (!isLoop && decay > 0) {
      src.stop(endAt + 0.02);
    }

    const voice: Voice = {
      pad: padIndex,
      src,
      gain,
      filter,
      startAt,
      endAt: isLoop ? Infinity : endAt,
      loop: isLoop,
    };
    this.voices[padIndex] = voice;

    src.onended = () => {
      if (this.voices[padIndex] === voice) this.voices[padIndex] = null;
      try {
        gain.disconnect();
        filter.disconnect();
      } catch {
        /* bereits getrennt */
      }
    };

    return voice;
  }

  private quantizeBeats(): number {
    return this._quantize;
  }

  private _quantize = 0;

  setQuantize(beats: number): void {
    this._quantize = Math.max(0, beats);
  }

  isPlaying(padIndex: number): boolean {
    return Boolean(this.voices[padIndex]);
  }

  stop(padIndex: number, immediate = false): void {
    const voice = this.voices[padIndex];
    if (!voice) return;
    this.voices[padIndex] = null;
    const pad = this.pads[padIndex];
    const now = this.ctx.currentTime;
    const release = immediate ? 0.012 : Math.max(0.01, pad?.release ?? 0.2);
    const start = Math.max(now, voice.startAt);
    const g = voice.gain.gain;
    try {
      g.cancelAndHoldAtTime(now);
      g.exponentialRampToValueAtTime(0.0002, now + release);
    } catch {
      /* ignore */
    }
    try {
      voice.src.stop(Math.max(now + release + 0.01, start + 0.01));
    } catch {
      /* ignore */
    }
  }

  stopAll(immediate = true): void {
    for (let i = 0; i < 16; i++) this.stop(i, immediate);
    this.stopMasterFx();
  }

  toggle(padIndex: number, velocity = 1): void {
    const pad = this.pads[padIndex];
    if (!pad) return;
    if (this.voices[padIndex]) {
      this.stop(padIndex);
    } else {
      this.trigger(padIndex, { velocity });
    }
  }

  /* --------------------------- Metrik/Licht ------------------------- */

  levels(out: Float32Array<ArrayBuffer>): void {
    for (let i = 0; i < 16; i++) {
      const chain = this.chains[i];
      chain.analyser.getFloatTimeDomainData(chain.data);
      let sum = 0;
      for (let s = 0; s < chain.data.length; s++) {
        const v = chain.data[s];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / chain.data.length);
      out[i] = clamp(Math.pow(rms * 2.4, 0.7), 0, 1);
    }
  }

  masterLevel(): number {
    this.masterAnalyser.getFloatTimeDomainData(this.masterData);
    let sum = 0;
    for (let i = 0; i < this.masterData.length; i++) {
      const v = this.masterData[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.masterData.length);
    return clamp(rms * 3.2, 0, 1);
  }

  /** Ziel für zusätzliche Quellen (Decks): direkt in den Master-Bus. */
  masterInputNode(): AudioNode {
    return this.masterIn;
  }

  /* --------------------------- Recording ---------------------------- */

  /** Tap für die Set-Aufnahme: mitschneiden, was nach dem Limiter rausgeht. */
  connectRecording(destination: MediaStreamAudioDestinationNode): void {
    try {
      this.masterGain.connect(destination);
    } catch {
      /* AudioContext bereits geschlossen */
    }
  }

  disconnectRecording(destination: MediaStreamAudioDestinationNode): void {
    try {
      this.masterGain.disconnect(destination);
    } catch {
      /* bereits getrennt */
    }
  }

  /* ----------------------------- Mixer ------------------------------ */

  setMasterVolume(value: number): void {
    this.masterVolume = clamp(value, 0, 1);
    this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
  }

  setMasterFilter(value: number): void {
    // 0 = zu, 1 = offen (logarithmisch 120 Hz … 20 kHz)
    const freq = value >= 0.995 ? 20000 : 60 * Math.pow(280, clamp(value, 0, 1));
    this.lp.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
  }

  setReverbReturn(value: number): void {
    this.reverbReturn.gain.setTargetAtTime(clamp(value, 0, 1.4), this.ctx.currentTime, 0.03);
  }

  setDelayReturn(value: number): void {
    this.delayReturn.gain.setTargetAtTime(clamp(value, 0, 1.4), this.ctx.currentTime, 0.03);
  }

  /* --------------------------- Master FX ---------------------------- */

  pressFx(fx: MasterFx): void {
    const t = this.ctx.currentTime;
    switch (fx) {
      case 'LP':
        this.lp.frequency.cancelScheduledValues(t);
        this.lp.frequency.setTargetAtTime(320, t, 0.03);
        break;
      case 'HP':
        this.hp.frequency.cancelScheduledValues(t);
        this.hp.frequency.setTargetAtTime(1400, t, 0.03);
        break;
      case 'Echo':
        this.delayReturn.gain.setTargetAtTime(0.75, t, 0.02);
        this.delayFeedback.gain.setTargetAtTime(0.62, t, 0.05);
        break;
      case 'Gate':
        this.startGate();
        break;
    }
  }

  releaseFx(fx: MasterFx): void {
    const t = this.ctx.currentTime;
    switch (fx) {
      case 'LP':
        this.lp.frequency.cancelScheduledValues(t);
        this.lp.frequency.setTargetAtTime(20000, t, 0.06);
        this.setMasterFilter(this._filter);
        break;
      case 'HP':
        this.hp.frequency.cancelScheduledValues(t);
        this.hp.frequency.setTargetAtTime(18, t, 0.06);
        break;
      case 'Echo':
        this.delayReturn.gain.setTargetAtTime(this._delay, t, 0.08);
        this.delayFeedback.gain.setTargetAtTime(0.36, t, 0.1);
        break;
      case 'Gate':
        this.stopGate();
        break;
    }
  }

  private _filter = 1;
  private _delay = 0.14;

  storeFilter(value: number): void {
    this._filter = value;
  }

  storeDelay(value: number): void {
    this._delay = value;
  }

  private startGate(): void {
    if (this.gateLfo) return;
    const t = this.ctx.currentTime;
    const gate = this.ctx.createGain();
    gate.gain.value = 1;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = (this.bpm / 60) * 4;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(gate.gain);
    this.lp.disconnect();
    this.lp.connect(gate);
    gate.connect(this.hp);
    lfo.start(t);
    lfo.onended = () => depth.disconnect();
    this.gateLfo = lfo;
    this.gateGain = gate;
  }

  private stopGate(): void {
    if (!this.gateLfo || !this.gateGain) return;
    try {
      this.gateLfo.stop();
    } catch {
      /* ignore */
    }
    this.lp.disconnect();
    this.gateGain.disconnect();
    this.lp.connect(this.hp);
    this.gateLfo = null;
    this.gateGain = null;
  }

  /** Sanfter Fade für "Stop All" bei Loops. */
  private stopMasterFx(): void {
    this.stopGate();
  }

  dispose(): void {
    this.stopAll(true);
    void this.ctx.close();
  }
}
