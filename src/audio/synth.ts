/* ------------------------------------------------------------------
 * PADFORGE – Sample-Synthese
 *
 * Die fünf Werkspacks werden komplett offline im Browser gerendert
 * (OfflineAudioContext). So braucht das Projekt keine Binär-Assets,
 * klingt aber wie echte Drum-Samples.
 * ------------------------------------------------------------------ */

type Ctx = OfflineAudioContext;

export interface RecipeParams {
  freq?: number;
  dur?: number;
  tune?: number;
  drive?: number;
  bright?: number;
  peak?: number;
  [key: string]: number | undefined;
}

interface RecipeSpec {
  duration: number;
  parts: (ctx: Ctx, dest: AudioNode, t0: number) => void;
}

const TAU = Math.PI * 2;

/* ----------------------------- Helfer ----------------------------- */

function env(
  ctx: Ctx,
  dest: AudioNode,
  t0: number,
  peak: number,
  attack: number,
  decay: number,
  hold = 0,
): GainNode {
  const g = ctx.createGain();
  const p = Math.max(peak, 0.0003);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(p, t0 + Math.max(attack, 0.0008));
  if (hold > 0) g.gain.setValueAtTime(p, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + Math.max(decay, 0.005));
  g.gain.linearRampToValueAtTime(0, t0 + attack + hold + decay + 0.004);
  g.connect(dest);
  return g;
}

function noise(ctx: Ctx, dur: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.ceil(dur * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function osc(
  ctx: Ctx,
  type: OscillatorType,
  freq: number,
  t0: number,
  dur: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  return o;
}

function filt(
  ctx: Ctx,
  type: BiquadFilterType,
  freq: number,
  q: number,
  dest: AudioNode,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

function shaper(ctx: Ctx, amount: number, dest: AudioNode): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '2x';
  ws.connect(dest);
  return ws;
}

function vibrato(ctx: Ctx, target: AudioParam, rate: number, depth: number, t0: number, dur: number) {
  const lfo = osc(ctx, 'sine', rate, t0, dur);
  const amount = ctx.createGain();
  amount.gain.value = depth;
  lfo.connect(amount);
  amount.connect(target);
}

/* ---------------------- Einzelne Trommel-Sounds -------------------- */

function kickHit(ctx: Ctx, dest: AudioNode, t0: number, o: Required<Pick<RecipeParams, 'freq'>> & Record<string, number>) {
  const dur = o.dur ?? 0.55;
  const f0 = o.f0 ?? 170;
  const f1 = o.f1 ?? 46;
  const click = o.click ?? 0.5;
  const drive = o.drive ?? 1;

  const body = ctx.createGain();
  body.gain.value = 1;
  if (drive > 0) {
    body.connect(shaper(ctx, drive * 0.35, dest));
  } else {
    body.connect(dest);
  }

  const o1 = osc(ctx, 'sine', f0, t0, dur);
  o1.frequency.exponentialRampToValueAtTime(f1, t0 + 0.055);
  o1.frequency.exponentialRampToValueAtTime(Math.max(f1 * 0.94, 20), t0 + dur);
  o1.connect(env(ctx, body, t0, 1, 0.003, dur));

  if (click > 0) {
    const n = noise(ctx, 0.035);
    n.connect(
      filt(ctx, 'highpass', 1800, 0.8, env(ctx, body, t0, 0.55 * click, 0.0008, 0.024)),
    );
    n.start(t0);
  }
  // zweite, tiefe Sinus-Komponente für Bauch
  const sub = osc(ctx, 'sine', f1 * 0.5, t0, dur);
  sub.connect(env(ctx, dest, t0, 0.35, 0.01, dur * 0.9));
}

function snareHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.24;
  const tone = o.tone ?? 188;
  const n = noise(ctx, dur + 0.2);
  n.connect(filt(ctx, 'bandpass', 1850, 0.85, env(ctx, dest, t0, 0.85, 0.001, dur)));
  const n2 = noise(ctx, dur + 0.25);
  n2.connect(filt(ctx, 'highpass', 4200, 0.7, env(ctx, dest, t0, 0.32, 0.001, dur * 1.35)));
  n.start(t0);
  n2.start(t0);
  const body = osc(ctx, 'triangle', tone, t0, 0.18);
  body.frequency.exponentialRampToValueAtTime(tone * 0.82, t0 + 0.12);
  body.connect(env(ctx, dest, t0, 0.42, 0.001, 0.1));
}

function clapHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const bright = o.bright ?? 1100;
  const spread = o.spread ?? 0.0105;
  for (let i = 0; i < 3; i++) {
    const n = noise(ctx, 0.06);
    n.connect(filt(ctx, 'bandpass', bright + i * 130, 2.4, env(ctx, dest, t0 + i * spread, 0.5, 0.0008, 0.02)));
    n.start(t0 + i * spread);
  }
  const tail = noise(ctx, 0.4);
  tail.connect(filt(ctx, 'bandpass', bright * 0.85, 1.5, env(ctx, dest, t0 + 0.028, 0.55, 0.002, 0.2 + (o.dur ?? 0))));
  tail.start(t0 + 0.028);
}

function hatHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const decay = o.decay ?? 0.045;
  const n = noise(ctx, decay + 0.08);
  const f = filt(ctx, 'highpass', o.hp ?? 7600, 0.7, env(ctx, dest, t0, o.peak ?? 0.55, 0.0008, decay));
  const bp = filt(ctx, 'bandpass', 10500, 0.9, dest);
  n.connect(f);
  const n2 = noise(ctx, decay + 0.08);
  n2.connect(filt(ctx, 'bandpass', 9800, 1.4, env(ctx, dest, t0, 0.2, 0.0008, decay * 0.8)));
  n2.start(t0);
  void bp;
  n.start(t0);
}

function tomHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.32;
  const f0 = o.f0 ?? 240;
  const f1 = o.f1 ?? 110;
  const body = osc(ctx, 'sine', f0, t0, dur);
  body.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6);
  body.connect(env(ctx, dest, t0, 0.8, 0.003, dur));
  const n = noise(ctx, 0.08);
  n.connect(filt(ctx, 'bandpass', 1400, 1.2, env(ctx, dest, t0, 0.2, 0.001, 0.05)));
  n.start(t0);
}

function metalHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const decay = o.decay ?? 0.9;
  const base = o.freq ?? 3300;
  const ratios = [1, 1.34, 1.79, 2.31, 2.86, 3.42];
  ratios.forEach((r, i) => {
    const p = osc(ctx, 'sine', base * r, t0, decay);
    p.connect(env(ctx, dest, t0, (o.peak ?? 0.16) / (1 + i * 0.35), 0.001, decay * (1 - i * 0.09)));
  });
  const n = noise(ctx, decay + 0.2);
  n.connect(filt(ctx, 'highpass', 5200, 0.8, env(ctx, dest, t0, 0.3, 0.001, decay)));
  n.start(t0);
}

function bassHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const freq = o.freq ?? 55;
  const dur = o.dur ?? 1.1;
  const drive = o.drive ?? 1;
  const g = ctx.createGain();
  g.gain.value = 0.8;
  g.connect(shaper(ctx, drive * 0.5, dest));

  const o1 = osc(ctx, 'sine', freq * 1.9, t0, dur);
  o1.frequency.exponentialRampToValueAtTime(freq, t0 + 0.06);
  o1.connect(env(ctx, g, t0, 1, 0.004, dur));
  const o2 = osc(ctx, 'triangle', freq, t0, dur);
  o2.connect(env(ctx, g, t0, 0.35, 0.006, dur * 0.85));
  const click = noise(ctx, 0.02);
  click.connect(filt(ctx, 'highpass', 2400, 0.7, env(ctx, dest, t0, 0.16, 0.0008, 0.012)));
  click.start(t0);
}

function stabHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const freq = o.freq ?? 220;
  const dur = o.dur ?? 0.45;
  const drive = o.drive ?? 0.4;
  const bus = ctx.createGain();
  bus.gain.value = 0.5;
  const lp = filt(ctx, 'lowpass', 2600, 1.1, bus);
  lp.frequency.setValueAtTime(Math.max(freq * 9, 900), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 2.4, 300), t0 + dur * 0.8);
  bus.connect(shaper(ctx, drive, dest));
  [1, 1.19, 1.5, 2].forEach((m, i) => {
    const voice = osc(ctx, i === 3 ? 'triangle' : 'sawtooth', freq * m * (1 + i * 0.0015), t0, dur);
    voice.connect(env(ctx, lp, t0, 0.35 / (1 + i * 0.4), 0.008, dur));
  });
}

function voxHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const freq = o.freq ?? 220;
  const dur = o.dur ?? 0.28;
  const src = osc(ctx, 'sawtooth', freq, t0, dur);
  vibrato(ctx, src.frequency, 5.5, 3.5, t0, dur);
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(dest);
  const formants = o.formants ?? 0;
  const sets =
    formants > 0
      ? [
          [520, 1.4],
          [1180, 1.1],
        ]
      : [
          [780, 1.3],
          [1250, 1.6],
          [2600, 1.8],
        ];
  sets.forEach(([f, q]) => {
    src.connect(filt(ctx, 'bandpass', f, q, env(ctx, out, t0, 0.75, 0.012, dur)));
  });
  const breath = noise(ctx, dur);
  breath.connect(filt(ctx, 'bandpass', 2200, 1.2, env(ctx, out, t0, 0.12, 0.006, dur * 0.6)));
  breath.start(t0);
}

function riserHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 1.8;
  const n = noise(ctx, dur + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 4.5;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(7800, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.55, t0 + dur);
  g.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
  bp.connect(g);
  g.connect(dest);
  n.connect(bp);
  n.start(t0);
  n.stop(t0 + dur + 0.05);

  const tone = osc(ctx, 'sine', 180, t0, dur);
  tone.frequency.exponentialRampToValueAtTime(1400, t0 + dur);
  tone.connect(
    (() => {
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.exponentialRampToValueAtTime(0.18, t0 + dur);
      tg.gain.linearRampToValueAtTime(0, t0 + dur + 0.05);
      tg.connect(dest);
      return tg;
    })(),
  );
}

function zapHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const f0 = o.f0 ?? 2600;
  const f1 = o.f1 ?? 70;
  const dur = o.dur ?? 0.16;
  const s = osc(ctx, 'sawtooth', f0, t0, dur);
  s.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.85);
  const lp = filt(ctx, 'lowpass', 5200, 4, env(ctx, dest, t0, 0.5, 0.002, dur));
  s.connect(lp);
  const n = noise(ctx, dur);
  n.connect(filt(ctx, 'highpass', 2000, 1, env(ctx, dest, t0, 0.18, 0.001, dur * 0.5)));
  n.start(t0);
}

function sirenHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.9;
  const s = osc(ctx, 'sine', 700, t0, dur);
  const lfo = osc(ctx, 'triangle', 3.2, t0, dur);
  const depth = ctx.createGain();
  depth.gain.value = 260;
  lfo.connect(depth);
  depth.connect(s.frequency);
  s.connect(env(ctx, dest, t0, 0.32, 0.02, dur));
}

function hornHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.55;
  const bus = ctx.createGain();
  bus.gain.value = 0.35;
  const lp = filt(ctx, 'lowpass', 2800, 0.9, bus);
  bus.connect(dest);
  [220, 277, 330].forEach((f, i) => {
    const v = osc(ctx, 'sawtooth', f, t0, dur);
    vibrato(ctx, v.frequency, 6 + i * 0.4, 2.2, t0, dur);
    v.connect(env(ctx, lp, t0, 0.4, 0.02, dur));
  });
  const n = noise(ctx, dur);
  n.connect(filt(ctx, 'bandpass', 1800, 0.8, env(ctx, dest, t0, 0.1, 0.02, dur)));
  n.start(t0);
}

function bellHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const freq = o.freq ?? 880;
  const dur = o.dur ?? 1.1;
  const carrier = osc(ctx, 'sine', freq, t0, dur);
  const mod = osc(ctx, 'sine', freq * 2.01, t0, dur);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freq * 1.6, t0);
  modGain.gain.exponentialRampToValueAtTime(2, t0 + dur * 0.6);
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(env(ctx, dest, t0, 0.4, 0.002, dur));
}

function pluckHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const freq = o.freq ?? 440;
  const dur = o.dur ?? 0.32;
  const v = osc(ctx, 'triangle', freq, t0, dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(6000, t0);
  lp.frequency.exponentialRampToValueAtTime(700, t0 + dur);
  lp.Q.value = 2;
  lp.connect(env(ctx, dest, t0, 0.5, 0.002, dur));
  v.connect(lp);
}

function scratchHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.22;
  for (let i = 0; i < 2; i++) {
    const n = noise(ctx, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(900 + i * 400, t0 + i * 0.08);
    bp.frequency.exponentialRampToValueAtTime(3200, t0 + i * 0.08 + 0.06);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + i * 0.08 + 0.11);
    n.connect(bp);
    bp.connect(env(ctx, dest, t0 + i * 0.08, 0.5, 0.004, 0.09));
    n.start(t0 + i * 0.08);
  }
  const tone = osc(ctx, 'sine', 300, t0, dur);
  tone.frequency.linearRampToValueAtTime(120, t0 + dur);
  tone.connect(env(ctx, dest, t0, 0.12, 0.01, dur));
}

function vinylStopHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.55;
  const s = osc(ctx, 'sawtooth', 420, t0, dur);
  s.frequency.exponentialRampToValueAtTime(38, t0 + dur);
  s.connect(filt(ctx, 'lowpass', 1800, 1, env(ctx, dest, t0, 0.3, 0.01, dur)));
  const n = noise(ctx, dur);
  n.connect(filt(ctx, 'lowpass', 2400, 0.7, env(ctx, dest, t0, 0.2, 0.01, dur)));
  n.start(t0);
}

function impactHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 1.1;
  const sub = osc(ctx, 'sine', 90, t0, dur);
  sub.frequency.exponentialRampToValueAtTime(32, t0 + dur * 0.8);
  sub.connect(env(ctx, dest, t0, 0.95, 0.004, dur));
  const n = noise(ctx, 0.5);
  n.connect(filt(ctx, 'lowpass', 900, 0.8, env(ctx, dest, t0, 0.6, 0.002, 0.35)));
  n.start(t0);
  metalHit(ctx, dest, t0, { decay: 0.7, peak: 0.08, freq: 2600 });
}

function noiseHit(ctx: Ctx, dest: AudioNode, t0: number, o: Record<string, number>) {
  const dur = o.dur ?? 0.4;
  const n = noise(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(o.freq ?? 1800, t0);
  bp.frequency.exponentialRampToValueAtTime((o.freq ?? 1800) * 0.5, t0 + dur);
  n.connect(bp);
  bp.connect(env(ctx, dest, t0, 0.45, 0.004, dur));
  n.start(t0);
}

/* --------------------------- Pattern-Loops ------------------------- */

const STEP = 0.125; // 1/16 bei 120 BPM

function loopHats(ctx: Ctx, dest: AudioNode, t0: number) {
  for (let i = 0; i < 16; i++) {
    const acc = i % 4 === 2 ? 0.7 : 0.45;
    hatHit(ctx, dest, t0 + i * STEP, { decay: 0.035, peak: acc });
  }
  hatHit(ctx, dest, t0 + STEP * 2, { decay: 0.24, peak: 0.3 });
  hatHit(ctx, dest, t0 + STEP * 6, { decay: 0.24, peak: 0.3 });
  hatHit(ctx, dest, t0 + STEP * 10, { decay: 0.24, peak: 0.32 });
  hatHit(ctx, dest, t0 + STEP * 14, { decay: 0.24, peak: 0.32 });
}

function loopPerc(ctx: Ctx, dest: AudioNode, t0: number) {
  const pattern = [0, 3, 6, 8, 10, 13];
  pattern.forEach((s) => tomHit(ctx, dest, t0 + s * STEP, { f0: 420, f1: 260, dur: 0.14 }));
  for (let i = 0; i < 8; i++) {
    const n = noise(ctx, 0.06);
    n.connect(filt(ctx, 'highpass', 6800, 0.8, env(ctx, dest, t0 + i * STEP * 2 + STEP, 0.16, 0.001, 0.05)));
    n.start(t0 + i * STEP * 2 + STEP);
  }
}

function loopBreak(ctx: Ctx, dest: AudioNode, t0: number) {
  [0, 6, 10].forEach((s) => kickHit(ctx, dest, t0 + s * STEP, { freq: 55, dur: 0.32, f0: 160, f1: 50, drive: 0.6 }));
  [4, 12].forEach((s) => snareHit(ctx, dest, t0 + s * STEP, { dur: 0.16 }));
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) hatHit(ctx, dest, t0 + i * STEP, { decay: 0.03, peak: 0.35 });
  }
}

function loopTop(ctx: Ctx, dest: AudioNode, t0: number) {
  for (let i = 0; i < 16; i++) {
    hatHit(ctx, dest, t0 + i * STEP, { decay: i % 4 === 2 ? 0.1 : 0.03, peak: i % 4 === 2 ? 0.4 : 0.24 });
  }
  [4, 12].forEach((s) => clapHit(ctx, dest, t0 + s * STEP, { bright: 1200 }));
  [7, 15].forEach((s) => {
    const n = noise(ctx, 0.2);
    n.connect(filt(ctx, 'highpass', 5200, 0.9, env(ctx, dest, t0 + s * STEP, 0.18, 0.005, 0.12)));
    n.start(t0 + s * STEP);
  });
}

function loop808(ctx: Ctx, dest: AudioNode, t0: number) {
  const notes: [number, number][] = [
    [0, 55],
    [3, 55],
    [6, 73.42],
    [10, 49],
    [14, 65.41],
  ];
  notes.forEach(([s, f]) => bassHit(ctx, dest, t0 + s * STEP, { freq: f, dur: 0.38, drive: 1.1 }));
}

function loopConga(ctx: Ctx, dest: AudioNode, t0: number) {
  const hits: [number, number][] = [
    [0, 380],
    [2, 300],
    [3, 420],
    [6, 300],
    [8, 380],
    [10, 260],
    [11, 380],
    [14, 300],
  ];
  hits.forEach(([s, f]) => tomHit(ctx, dest, t0 + s * STEP, { f0: f, f1: f * 0.72, dur: 0.16 }));
  for (let i = 0; i < 8; i++) {
    const n = noise(ctx, 0.05);
    n.connect(filt(ctx, 'highpass', 7000, 0.9, env(ctx, dest, t0 + i * STEP * 2, 0.12, 0.001, 0.035)));
    n.start(t0 + i * STEP * 2);
  }
}

/* ----------------------------- Registry ---------------------------- */

const RECIPES: Record<string, (p: RecipeParams) => RecipeSpec> = {
  kick: (p) => ({
    duration: 0.55,
    parts: (c, d, t) =>
      kickHit(c, d, t, { freq: 55, f0: p.f0 ?? 170, f1: p.f1 ?? 46, click: p.click ?? 0.55, drive: p.drive ?? 0.8, dur: p.dur ?? 0.5 }),
  }),
  kickSoft: (p) => ({
    duration: 0.5,
    parts: (c, d, t) =>
      kickHit(c, d, t, { freq: 55, f0: 130, f1: 44, click: 0.18, drive: 0.25, dur: p.dur ?? 0.45 }),
  }),
  kickBoom: () => ({
    duration: 0.75,
    parts: (c, d, t) => {
      kickHit(c, d, t, { freq: 50, f0: 120, f1: 38, click: 0.3, drive: 1.2, dur: 0.7 });
      snareHit(c, d, t, { dur: 0.1, tone: 210 });
    },
  }),
  kickTrap: () => ({
    duration: 0.4,
    parts: (c, d, t) => kickHit(c, d, t, { freq: 60, f0: 210, f1: 52, click: 0.9, drive: 1.6, dur: 0.36 }),
  }),
  kickSub: () => ({
    duration: 0.85,
    parts: (c, d, t) => {
      kickHit(c, d, t, { freq: 40, f0: 90, f1: 33, click: 0.1, drive: 0.5, dur: 0.8 });
      const s = osc(c, 'sine', 55, t, 0.8);
      s.connect(env(c, d, t, 0.5, 0.01, 0.78));
    },
  }),
  snare: (p) => ({ duration: 0.35, parts: (c, d, t) => snareHit(c, d, t, { dur: p.dur ?? 0.22, tone: p.freq ?? 190 }) }),
  snareTight: () => ({ duration: 0.22, parts: (c, d, t) => snareHit(c, d, t, { dur: 0.13, tone: 240 }) }),
  clap: (p) => ({ duration: 0.4, parts: (c, d, t) => clapHit(c, d, t, { bright: p.freq ?? 1100 }) }),
  hatClosed: () => ({ duration: 0.1, parts: (c, d, t) => hatHit(c, d, t, { decay: 0.04, peak: 0.5 }) }),
  hatPedal: () => ({ duration: 0.07, parts: (c, d, t) => hatHit(c, d, t, { decay: 0.025, peak: 0.42 }) }),
  hatOpen: () => ({ duration: 0.45, parts: (c, d, t) => hatHit(c, d, t, { decay: 0.36, peak: 0.42, hp: 6800 }) }),
  rim: () => ({
    duration: 0.12,
    parts: (c, d, t) => {
      const s = osc(c, 'square', 1750, t, 0.05);
      s.connect(filt(c, 'bandpass', 2200, 6, env(c, d, t, 0.4, 0.001, 0.035)));
      const n = noise(c, 0.04);
      n.connect(filt(c, 'highpass', 3000, 0.8, env(c, d, t, 0.3, 0.0008, 0.02)));
      n.start(t);
    },
  }),
  tom: (p) => ({ duration: 0.45, parts: (c, d, t) => tomHit(c, d, t, { f0: p.freq ?? 240, f1: (p.freq ?? 240) * 0.45, dur: 0.34 }) }),
  tomLow: () => ({ duration: 0.55, parts: (c, d, t) => tomHit(c, d, t, { f0: 150, f1: 72, dur: 0.45 }) }),
  congaHi: () => ({ duration: 0.3, parts: (c, d, t) => tomHit(c, d, t, { f0: 420, f1: 320, dur: 0.16 }) }),
  congaLo: () => ({ duration: 0.35, parts: (c, d, t) => tomHit(c, d, t, { f0: 270, f1: 195, dur: 0.2 }) }),
  bongoHi: () => ({ duration: 0.22, parts: (c, d, t) => tomHit(c, d, t, { f0: 540, f1: 430, dur: 0.09 }) }),
  bongoLo: () => ({ duration: 0.24, parts: (c, d, t) => tomHit(c, d, t, { f0: 360, f1: 280, dur: 0.11 }) }),
  timbale: () => ({
    duration: 0.4,
    parts: (c, d, t) => {
      const s = osc(c, 'triangle', 620, t, 0.3);
      s.connect(env(c, d, t, 0.3, 0.001, 0.28));
      const n = noise(c, 0.3);
      n.connect(filt(c, 'bandpass', 3400, 1.6, env(c, d, t, 0.35, 0.001, 0.25)));
      n.start(t);
    },
  }),
  cowbell: () => ({
    duration: 0.5,
    parts: (c, d, t) => {
      const bus = filt(c, 'bandpass', 880, 1.4, env(c, d, t, 0.35, 0.002, 0.42));
      [540, 800].forEach((f) => {
        const s = osc(c, 'square', f, t, 0.45);
        s.connect(bus);
      });
    },
  }),
  shaker: () => ({
    duration: 0.18,
    parts: (c, d, t) => {
      const n = noise(c, 0.16);
      const g = env(c, d, t, 0.32, 0.004, 0.11);
      const trem = c.createGain();
      trem.gain.value = 0.55;
      const lfo = osc(c, 'sine', 52, t, 0.16);
      const depth = c.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth);
      depth.connect(trem.gain);
      n.connect(filt(c, 'highpass', 6200, 0.8, trem));
      trem.connect(g);
      n.start(t);
    },
  }),
  tambourine: () => ({
    duration: 0.35,
    parts: (c, d, t) => {
      metalHit(c, d, t, { decay: 0.22, peak: 0.09, freq: 4200 });
      const n = noise(c, 0.25);
      n.connect(filt(c, 'highpass', 7200, 0.8, env(c, d, t, 0.28, 0.002, 0.18)));
      n.start(t);
    },
  }),
  claves: () => ({
    duration: 0.14,
    parts: (c, d, t) => {
      const s = osc(c, 'sine', 2500, t, 0.08);
      s.connect(env(c, d, t, 0.4, 0.001, 0.05));
      const n = noise(c, 0.02);
      n.connect(filt(c, 'highpass', 4000, 1, env(c, d, t, 0.15, 0.0008, 0.012)));
      n.start(t);
    },
  }),
  guiro: () => ({
    duration: 0.4,
    parts: (c, d, t) => {
      for (let i = 0; i < 11; i++) {
        const n = noise(c, 0.03);
        n.connect(filt(c, 'bandpass', 2800, 1.5, env(c, d, t + i * 0.032, 0.2, 0.001, 0.022)));
        n.start(t + i * 0.032);
      }
    },
  }),
  agogo: () => ({
    duration: 0.4,
    parts: (c, d, t) => {
      [880, 1320].forEach((f, i) => {
        const s = osc(c, 'sine', f, t, 0.35);
        s.connect(env(c, d, t, 0.28 / (i + 1), 0.002, 0.3));
      });
      metalHit(c, d, t, { decay: 0.2, peak: 0.05, freq: 3600 });
    },
  }),
  djembe: () => ({
    duration: 0.4,
    parts: (c, d, t) => {
      tomHit(c, d, t, { f0: 210, f1: 140, dur: 0.3 });
      const n = noise(c, 0.12);
      n.connect(filt(c, 'bandpass', 1300, 1.2, env(c, d, t, 0.22, 0.001, 0.07)));
      n.start(t);
    },
  }),
  cajon: () => ({
    duration: 0.3,
    parts: (c, d, t) => {
      const n = noise(c, 0.2);
      n.connect(filt(c, 'bandpass', 900, 1.1, env(c, d, t, 0.4, 0.001, 0.11)));
      n.start(t);
      const s = osc(c, 'sine', 110, t, 0.22);
      s.frequency.exponentialRampToValueAtTime(80, t + 0.2);
      s.connect(env(c, d, t, 0.35, 0.002, 0.18));
    },
  }),
  ride: () => ({ duration: 1.4, parts: (c, d, t) => metalHit(c, d, t, { decay: 1.3, peak: 0.14, freq: 3100 }) }),
  crash: () => ({
    duration: 2,
    parts: (c, d, t) => {
      metalHit(c, d, t, { decay: 1.8, peak: 0.18, freq: 2900 });
      const n = noise(c, 1.6);
      n.connect(filt(c, 'highpass', 4200, 0.6, env(c, d, t, 0.3, 0.004, 1.5)));
      n.start(t);
    },
  }),
  metallic: () => ({ duration: 0.9, parts: (c, d, t) => metalHit(c, d, t, { decay: 0.8, peak: 0.3, freq: 1800 }) }),
  noiseHit: (p) => ({ duration: 0.5, parts: (c, d, t) => noiseHit(c, d, t, { dur: 0.42, freq: p.freq ?? 1500 }) }),
  bass808: (p) => ({ duration: 1.2, parts: (c, d, t) => bassHit(c, d, t, { freq: p.freq ?? 55, dur: 1.1, drive: 1.2 }) }),
  bassShort: (p) => ({ duration: 0.4, parts: (c, d, t) => bassHit(c, d, t, { freq: p.freq ?? 65, dur: 0.32, drive: 0.6 }) }),
  subDrop: () => ({
    duration: 1.5,
    parts: (c, d, t) => {
      const s = osc(c, 'sine', 110, t, 1.4);
      s.frequency.exponentialRampToValueAtTime(26, t + 1.1);
      s.connect(env(c, d, t, 0.9, 0.008, 1.35));
    },
  }),
  stab: (p) => ({ duration: 0.5, parts: (c, d, t) => stabHit(c, d, t, { freq: p.freq ?? 220, dur: 0.4 }) }),
  brass: () => ({ duration: 0.7, parts: (c, d, t) => stabHit(c, d, t, { freq: 174, dur: 0.6, drive: 0.7 }) }),
  voxChop: (p) => ({ duration: 0.35, parts: (c, d, t) => voxHit(c, d, t, { freq: p.freq ?? 240, dur: 0.26 }) }),
  voxHey: () => ({ duration: 0.45, parts: (c, d, t) => voxHit(c, d, t, { freq: 200, dur: 0.36, formants: 1 }) }),
  riser: () => ({ duration: 1.9, parts: (c, d, t) => riserHit(c, d, t, { dur: 1.8 }) }),
  downlifter: () => ({
    duration: 1.2,
    parts: (c, d, t) => {
      const s = osc(c, 'sine', 900, t, 1.1);
      s.frequency.exponentialRampToValueAtTime(60, t + 1.05);
      s.connect(env(c, d, t, 0.35, 0.01, 1.05));
      const n = noise(c, 1);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(6000, t);
      bp.frequency.exponentialRampToValueAtTime(240, t + 1);
      n.connect(bp);
      bp.connect(env(c, d, t, 0.25, 0.01, 0.95));
      n.start(t);
    },
  }),
  zap: () => ({ duration: 0.2, parts: (c, d, t) => zapHit(c, d, t, {}) }),
  laser: () => ({
    duration: 0.35,
    parts: (c, d, t) => {
      const s = osc(c, 'square', 1600, t, 0.3);
      s.frequency.exponentialRampToValueAtTime(180, t + 0.28);
      s.connect(filt(c, 'bandpass', 1400, 2.5, env(c, d, t, 0.35, 0.002, 0.28)));
    },
  }),
  siren: () => ({ duration: 0.95, parts: (c, d, t) => sirenHit(c, d, t, {}) }),
  horn: () => ({ duration: 0.6, parts: (c, d, t) => hornHit(c, d, t, {}) }),
  bell: (p) => ({ duration: 1.2, parts: (c, d, t) => bellHit(c, d, t, { freq: p.freq ?? 880, dur: 1.1 }) }),
  pluck: (p) => ({ duration: 0.38, parts: (c, d, t) => pluckHit(c, d, t, { freq: p.freq ?? 440, dur: 0.32 }) }),
  bleep: () => ({
    duration: 0.12,
    parts: (c, d, t) => {
      const s = osc(c, 'square', 1400, t, 0.07);
      s.connect(filt(c, 'highpass', 600, 0.8, env(c, d, t, 0.22, 0.001, 0.05)));
    },
  }),
  scratch: () => ({ duration: 0.3, parts: (c, d, t) => scratchHit(c, d, t, {}) }),
  vinylStop: () => ({ duration: 0.6, parts: (c, d, t) => vinylStopHit(c, d, t, {}) }),
  impact: () => ({ duration: 1.2, parts: (c, d, t) => impactHit(c, d, t, {}) }),
  loopHats: () => ({ duration: 2, parts: loopHats }),
  loopPerc: () => ({ duration: 2, parts: loopPerc }),
  loopBreak: () => ({ duration: 2, parts: loopBreak }),
  loopTop: () => ({ duration: 2, parts: loopTop }),
  loop808: () => ({ duration: 2, parts: loop808 }),
  loopConga: () => ({ duration: 2, parts: loopConga }),
};

/* ----------------------------- Render ------------------------------ */

const PEAK_BY_GROUP: Record<string, number> = {
  kick: 0.95,
  bass: 0.9,
  snare: 0.85,
  hat: 0.55,
  perc: 0.74,
  fx: 0.8,
  vocal: 0.72,
  tonal: 0.7,
  loop: 0.8,
  other: 0.75,
};

function normalize(buffer: AudioBuffer, peak: number): AudioBuffer {
  const channels = buffer.numberOfChannels;
  let max = 0;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
  }
  if (max < 0.0001) return buffer;
  const gain = peak / max;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return buffer;
}

export async function renderSample(
  recipe: string,
  params: RecipeParams | undefined,
  group: string,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const factory = RECIPES[recipe];
  if (!factory) throw new Error(`Unbekanntes Rezept: ${recipe}`);
  const spec = factory(params ?? {});
  const length = Math.max(64, Math.ceil(spec.duration * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);
  spec.parts(ctx, out, 0);
  const buffer = await ctx.startRendering();
  return normalize(buffer, PEAK_BY_GROUP[group] ?? 0.8);
}

/** Reverse-Kopie (für Pad-Reverse). */
export function reverseBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctxBuffer = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = ctxBuffer.getChannelData(c);
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
  }
  return ctxBuffer;
}

export function recipeExists(recipe: string): boolean {
  return Boolean(RECIPES[recipe]);
}

/** Nur für Debug/Anzeige. */
export const RECIPE_COUNT = Object.keys(RECIPES).length;
void TAU;
