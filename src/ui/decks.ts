import type { DeckPlayer } from '../deck';
import type { DeckMode } from '../types';
import { h } from './dom';

export interface DeckHandlers {
  load: (index: number, file: File) => void;
  toggle: (index: number) => void;
  cue: (index: number) => void;
  seek: (index: number, seconds: number) => void;
  mode: (index: number, mode: DeckMode) => void;
}

interface DeckCard {
  root: HTMLElement;
  title: HTMLElement;
  time: HTMLElement;
  duration: HTMLElement;
  progress: HTMLInputElement;
  play: HTMLButtonElement;
  cue: HTMLButtonElement;
  mode: HTMLSelectElement;
  hint: HTMLElement;
  seeking: boolean;
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export class DecksPanel {
  private cards: DeckCard[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly decks: DeckPlayer[],
    private readonly handlers: DeckHandlers,
  ) {
    for (let index = 0; index < decks.length; index++) this.build(index);
    this.update();
  }

  private build(index: number): void {
    const root = h('section', 'deck-card');
    const head = h('div', 'deck-head');
    const badge = h('span', 'deck-badge', `DECK ${index + 1}`);
    const fileInput = h('input') as HTMLInputElement;
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.hidden = true;
    const load = h('button', 'btn btn-ghost btn-small', 'Track laden') as HTMLButtonElement;
    load.type = 'button';
    load.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) this.handlers.load(index, file);
    });
    head.append(badge, load, fileInput);

    const title = h('p', 'deck-title', 'Kein Track – Datei laden');
    const meta = h('div', 'deck-meta');
    const time = h('span', 'deck-time', '0:00');
    const duration = h('span', 'deck-time', '0:00');
    meta.append(time, duration);

    const progress = h('input', 'range deck-progress') as HTMLInputElement;
    progress.type = 'range';
    progress.min = '0';
    progress.max = '1000';
    progress.value = '0';
    progress.setAttribute('aria-label', `Deck ${index + 1} Position`);
    progress.addEventListener('pointerdown', () => {
      card.seeking = true;
    });
    const stopSeeking = () => {
      card.seeking = false;
    };
    progress.addEventListener('pointerup', stopSeeking);
    progress.addEventListener('pointercancel', stopSeeking);
    progress.addEventListener('blur', stopSeeking);
    progress.addEventListener('change', () => {
      card.seeking = false;
      this.handlers.seek(index, (Number(progress.value) / 1000) * this.decks[index].duration);
    });

    const actions = h('div', 'deck-actions');
    const play = h('button', 'btn btn-ghost btn-small', 'Play') as HTMLButtonElement;
    play.type = 'button';
    play.addEventListener('click', () => this.handlers.toggle(index));
    const cue = h('button', 'btn btn-ghost btn-small', 'Cue') as HTMLButtonElement;
    cue.type = 'button';
    cue.addEventListener('click', () => this.handlers.cue(index));

    const modeWrap = h('label', 'deck-mode');
    modeWrap.append(h('span', '', 'Jog'));
    const mode = h('select', 'select-inline') as HTMLSelectElement;
    for (const entry of [
      { value: 'play', label: 'Dauerlauf' },
      { value: 'vinyl', label: 'Nur beim Drehen' },
    ]) {
      const option = h('option', '', entry.label) as HTMLOptionElement;
      option.value = entry.value;
      mode.appendChild(option);
    }
    mode.addEventListener('change', () => {
      this.handlers.mode(index, mode.value === 'vinyl' ? 'vinyl' : 'play');
    });
    modeWrap.appendChild(mode);

    actions.append(play, cue, modeWrap);
    const hint = h('p', 'deck-hint');
    root.append(head, title, meta, progress, actions, hint);
    this.host.appendChild(root);

    const card: DeckCard = { root, title, time, duration, progress, play, cue, mode, hint, seeking: false };
    this.cards.push(card);
  }

  update(): void {
    this.cards.forEach((card, index) => {
      const deck = this.decks[index];
      if (!deck) return;
      const hasTrack = deck.hasTrack;
      card.root.classList.toggle('is-playing', deck.playing);
      card.root.classList.toggle('is-vinyl', deck.mode === 'vinyl');
      card.title.textContent = hasTrack ? deck.name : 'Kein Track – Datei laden';
      card.title.title = hasTrack ? deck.name : '';
      card.play.disabled = !hasTrack;
      card.cue.disabled = !hasTrack;
      card.play.textContent = deck.playing ? 'Pause' : 'Play';
      card.time.textContent = clock(deck.position);
      card.duration.textContent = clock(deck.duration);
      if (!card.seeking) card.progress.value = String(Math.round(deck.progress * 1000));
      if (card.mode.value !== deck.mode) card.mode.value = deck.mode;
      card.hint.textContent =
        deck.mode === 'vinyl'
          ? 'Jog: vorwärts drehen spielt, Loslassen stoppt · rückwärts spult zurück.'
          : 'Jog: Pitch-Bend beim Laufen, Scrub im Stand · Play hält den Track dauerhaft.';
    });
  }
}
