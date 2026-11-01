/* ------------------------------------------------------------------
 * PADFORGE – Performance-Loop
 *
 * Nimmt Pad-Hits mit Audio-Zeitstempel auf, quantisiert sie optional aufs
 * Raster und spielt sie als nahtlose Schleife wieder ab. Die Planung läuft
 * über die AudioContext-Uhr (Lookahead), damit die Hits nicht am Timer
 * hängen.
 * ------------------------------------------------------------------ */

import { clamp } from './types';

export interface LoopHit {
  pad: number;
  velocity: number;
  /** Sekunden ab Loop-Start */
  at: number;
}

export type LoopState = 'empty' | 'recording' | 'playing' | 'stopped';

export class PerformanceLoop {
  bars = 2;
  bpm = 124;
  /** Aufnahme-Raster in Beats (0 = nicht quantisieren). */
  quantizeBeats = 0.25;

  events: LoopHit[] = [];
  state: LoopState = 'empty';

  onHit: ((hit: LoopHit, when: number) => void) | null = null;
  onStateChange: (() => void) | null = null;

  private recStart = 0;
  private playStart = 0;
  private tickTimer: number | null = null;
  private finishTimer: number | null = null;
  private scheduled = new Set<string>();

  constructor(private readonly now: () => number) {}

  get beatSeconds(): number {
    return 60 / this.bpm;
  }

  get loopSeconds(): number {
    return this.bars * 4 * this.beatSeconds;
  }

  /** Aufnahme scharf schalten – die nächste Runde wird eingespielt. */
  arm(): void {
    this.stopTimers();
    this.events = [];
    this.recStart = this.now();
    this.state = 'recording';
    this.finishTimer = window.setTimeout(() => this.finishRecording(), this.loopSeconds * 1000);
    this.emitState();
  }

  /** Einen Live-Hit aufnehmen (nur während der Aufnahme). */
  capture(pad: number, velocity: number): void {
    if (this.state !== 'recording') return;
    const length = this.loopSeconds;
    let at = Math.max(0, this.now() - this.recStart);
    if (at >= length) return;
    if (this.quantizeBeats > 0) {
      const grid = this.quantizeBeats * this.beatSeconds;
      at = Math.round(at / grid) * grid;
    }
    this.events.push({
      pad,
      velocity: clamp(velocity, 0.05, 1),
      at: clamp(at, 0, length - 0.002),
    });
    this.emitState();
  }

  /** Aufnahme beenden und sofort loopen. */
  finishRecording(): void {
    if (this.state !== 'recording') return;
    this.stopTimers();
    if (!this.events.length) {
      this.state = 'empty';
      this.emitState();
      return;
    }
    this.startPlayback();
  }

  toggle(): void {
    if (this.state === 'recording') this.finishRecording();
    else if (this.state === 'playing') this.stop();
    else if (this.events.length) this.startPlayback();
  }

  startPlayback(): void {
    if (!this.events.length) {
      this.state = 'empty';
      this.emitState();
      return;
    }
    this.stopTimers();
    this.playStart = this.now() + 0.06;
    this.scheduled.clear();
    this.state = 'playing';
    this.tickTimer = window.setInterval(() => this.tick(), 25);
    this.tick();
    this.emitState();
  }

  stop(): void {
    this.stopTimers();
    this.state = this.events.length ? 'stopped' : 'empty';
    this.emitState();
  }

  clear(): void {
    this.stopTimers();
    this.events = [];
    this.state = 'empty';
    this.emitState();
  }

  setBars(bars: number): void {
    const next = clamp(Math.round(bars), 1, 8);
    if (next === this.bars) return;
    const wasRecording = this.state === 'recording';
    this.bars = next;
    this.trimEvents();
    if (wasRecording) this.finishRecording();
    else if (this.state === 'playing') this.startPlayback();
    else this.emitState();
  }

  setBpm(bpm: number): void {
    const next = clamp(Math.round(bpm), 40, 240);
    if (next === this.bpm) return;
    const wasActive = this.state === 'playing' || this.state === 'recording';
    if (this.state === 'recording') this.finishRecording();
    this.bpm = next;
    this.trimEvents();
    if (wasActive && this.state === 'playing') this.startPlayback();
    else this.emitState();
  }

  private tick(): void {
    if (this.state !== 'playing') return;
    const now = this.now();
    const length = this.loopSeconds;
    const until = now + 0.16;
    const firstCycle = Math.floor((now - this.playStart) / length) - 1;
    const lastCycle = Math.floor((until - this.playStart) / length) + 1;

    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      for (let index = 0; index < this.events.length; index++) {
        const hit = this.events[index];
        const when = this.playStart + cycle * length + hit.at;
        if (when < now || when >= until) continue;
        const key = `${cycle}:${index}`;
        if (this.scheduled.has(key)) continue;
        this.scheduled.add(key);
        this.onHit?.(hit, when);
      }
    }

    if (this.scheduled.size > 512) {
      const minimum = Math.floor((now - this.playStart) / length) - 2;
      for (const key of this.scheduled) {
        if (Number(key.split(':')[0]) < minimum) this.scheduled.delete(key);
      }
    }
  }

  private trimEvents(): void {
    const maximum = this.loopSeconds - 0.002;
    this.events = this.events.filter((hit) => hit.at < maximum);
  }

  private stopTimers(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }

  private emitState(): void {
    this.onStateChange?.();
  }
}
