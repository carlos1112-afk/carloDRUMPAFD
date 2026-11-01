/* ------------------------------------------------------------------
 * PADFORGE – Set-/Track-Recorder
 *
 * Nimmt den kompletten Master (nach Limiter und Master-FX) über einen
 * MediaStream-Tap auf. MediaRecorder schreibt komprimiertes WebM/Opus,
 * damit auch lange Sets nicht den Speicher sprengen. Beim Stoppen wird
 * eine Download-Datei mit Kit/BPM/Datum erzeugt.
 * ------------------------------------------------------------------ */

import type { AudioEngine } from './audio/engine';

export type SetRecorderState = 'idle' | 'recording' | 'processing';

export interface SetRecording {
  blob: Blob;
  url: string;
  filename: string;
  mimeType: string;
  duration: number;
  size: number;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export class SetRecorder {
  state: SetRecorderState = 'idle';
  last: SetRecording | null = null;

  onState: (() => void) | null = null;
  onFinished: ((recording: SetRecording) => void) | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private destination: MediaStreamAudioDestinationNode | null = null;
  private startedAt = 0;
  private lastDuration = 0;
  private label = 'PADFORGE';

  constructor(
    private readonly ctx: AudioContext,
    private readonly engine: AudioEngine,
  ) {}

  get supported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof this.ctx.createMediaStreamDestination === 'function'
    );
  }

  get elapsed(): number {
    if (this.state === 'recording') return (performance.now() - this.startedAt) / 1000;
    return this.lastDuration;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  start(): boolean {
    if (this.state !== 'idle' || !this.supported) return false;

    const destination = this.ctx.createMediaStreamDestination();
    this.engine.connectRecording(destination);

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        destination.stream,
        mimeType ? { mimeType, audioBitsPerSecond: 192_000 } : undefined,
      );
    } catch {
      this.engine.disconnectRecording(destination);
      return false;
    }

    if (this.last) {
      URL.revokeObjectURL(this.last.url);
      this.last = null;
    }

    this.chunks = [];
    this.recorder = recorder;
    this.destination = destination;
    this.startedAt = performance.now();
    this.lastDuration = 0;
    this.state = 'recording';

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => this.abort();
    recorder.onstop = () => this.finish();

    try {
      recorder.start(1000);
    } catch {
      this.abort();
      return false;
    }

    this.onState?.();
    return true;
  }

  stop(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    this.lastDuration = (performance.now() - this.startedAt) / 1000;
    this.state = 'processing';
    this.onState?.();
    try {
      this.recorder.stop();
    } catch {
      this.abort();
    }
  }

  downloadLast(): void {
    if (!this.last) return;
    triggerDownload(this.last.url, this.last.filename);
  }

  private abort(): void {
    const recorder = this.recorder;
    this.recorder = null;
    try {
      recorder?.stop();
    } catch {
      /* bereits gestoppt */
    }
    this.chunks = [];
    this.disconnect();
    this.state = 'idle';
    this.onState?.();
  }

  private finish(): void {
    const recorder = this.recorder;
    if (!recorder) return;

    const duration = this.lastDuration || (performance.now() - this.startedAt) / 1000;
    const mimeType = recorder.mimeType || this.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    const stamp = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(
      stamp.getHours(),
    )}-${pad(stamp.getMinutes())}`;
    const safeLabel = this.label
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'Set';
    const filename = `PADFORGE_${safeLabel}_${date}.${extension}`;
    const url = URL.createObjectURL(blob);

    this.last = { blob, url, filename, mimeType, duration, size: blob.size };
    this.recorder = null;
    this.chunks = [];
    this.disconnect();
    this.state = 'idle';
    this.onFinished?.(this.last);
    this.onState?.();
  }

  private disconnect(): void {
    if (!this.destination) return;
    this.engine.disconnectRecording(this.destination);
    this.destination = null;
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
