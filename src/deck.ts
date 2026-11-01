/* ------------------------------------------------------------------
 * PADFORGE – Deck-Player
 *
 * Spielt komplette Tracks aus einem AudioBuffer über den Master-Bus.
 * Zwei Jog-Modi:
 *   play  – Track läuft normal; Jog pitch-bendet / scrubbed im Stand.
 *   vinyl – Vorwärts drehen spielt, Loslassen stoppt; rückwärts spult.
 * ------------------------------------------------------------------ */

import type { DeckMode } from './types';
import { clamp } from './types';

export class DeckPlayer {
  readonly index: number;
  mode: DeckMode = 'play';
  name = '';
  buffer: AudioBuffer | null = null;
  playing = false;
  onState: (() => void) | null = null;

  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private pausedAt = 0;
  private autoStop = false;
  private stopTimer = 0;
  private bendTimer = 0;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    index: number,
  ) {
    this.index = index;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.9;
    this.gain.connect(destination);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get hasTrack(): boolean {
    return Boolean(this.buffer);
  }

  get position(): number {
    if (!this.buffer) return 0;
    if (!this.playing) return this.pausedAt;
    return clamp(this.offset + (this.ctx.currentTime - this.startedAt), 0, this.duration);
  }

  get progress(): number {
    return this.duration > 0 ? this.position / this.duration : 0;
  }

  setMode(mode: DeckMode): void {
    this.mode = mode;
    if (mode === 'play') this.autoStop = false;
    this.onState?.();
  }

  load(buffer: AudioBuffer, name: string): void {
    this.stopSource();
    window.clearTimeout(this.stopTimer);
    window.clearTimeout(this.bendTimer);
    this.buffer = buffer;
    this.name = name;
    this.playing = false;
    this.autoStop = false;
    this.pausedAt = 0;
    this.offset = 0;
    this.onState?.();
  }

  clear(): void {
    this.stopSource();
    window.clearTimeout(this.stopTimer);
    window.clearTimeout(this.bendTimer);
    this.buffer = null;
    this.name = '';
    this.playing = false;
    this.autoStop = false;
    this.pausedAt = 0;
    this.offset = 0;
    this.onState?.();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.buffer) return;
    if (this.playing) {
      // Ein latenter Jog-Lauf wird durch Play festgehalten.
      this.autoStop = false;
      return;
    }
    const at = this.pausedAt >= this.duration - 0.02 ? 0 : this.pausedAt;
    this.startAt(at, false);
  }

  pause(): void {
    if (!this.playing) return;
    const at = this.position;
    this.stopSource();
    this.playing = false;
    this.autoStop = false;
    this.pausedAt = at;
    this.onState?.();
  }

  cue(): void {
    this.stopSource();
    window.clearTimeout(this.stopTimer);
    this.playing = false;
    this.autoStop = false;
    this.pausedAt = 0;
    this.onState?.();
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    const at = clamp(seconds, 0, Math.max(0, this.duration - 0.01));
    if (this.playing) {
      this.startAt(at, this.autoStop);
    } else {
      this.pausedAt = at;
      this.onState?.();
    }
  }

  /** Jog-Delta (positiv = vorwärts), wie vom FLX4 gesendet. */
  jog(delta: number): void {
    if (!this.buffer || delta === 0) return;

    if (this.mode === 'vinyl') {
      if (delta > 0) {
        if (!this.playing) this.startAt(this.pausedAt, true);
        if (this.autoStop) this.armAutoStop();
      } else {
        if (this.playing) this.pause();
        this.pausedAt = clamp(this.pausedAt + delta * 0.012, 0, this.duration);
        this.onState?.();
      }
      return;
    }

    if (this.playing) {
      this.bend(delta);
    } else {
      this.pausedAt = clamp(this.pausedAt + delta * 0.012, 0, this.duration);
      this.onState?.();
    }
  }

  private startAt(offset: number, autoStop: boolean): void {
    if (!this.buffer) return;
    this.stopSource();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.autoStop = false;
      this.pausedAt = 0;
      this.offset = 0;
      this.onState?.();
    };
    try {
      source.start(0, offset);
    } catch {
      source.start();
    }
    this.source = source;
    this.offset = offset;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
    this.autoStop = autoStop;
    this.onState?.();
  }

  private stopSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* bereits gestoppt */
    }
    try {
      source.disconnect();
    } catch {
      /* bereits getrennt */
    }
  }

  private armAutoStop(): void {
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      if (this.playing && this.autoStop) this.pause();
    }, 160);
  }

  private bend(delta: number): void {
    const source = this.source;
    if (!source) return;
    const rate = clamp(1 + delta * 0.035, 0.4, 2.2);
    source.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.02);
    window.clearTimeout(this.bendTimer);
    this.bendTimer = window.setTimeout(() => {
      if (this.source) this.source.playbackRate.setTargetAtTime(1, this.ctx.currentTime, 0.06);
    }, 130);
  }
}
