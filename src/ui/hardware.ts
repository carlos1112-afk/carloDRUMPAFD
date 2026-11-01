import type { MidiController } from '../midi';
import { flx4MappingTable } from '../midi';
import type { MidiSettings, PadBank } from '../types';
import { PAD_BANKS } from '../types';
import { button, clear, h } from './dom';

export interface HardwareHandlers {
  connect: () => void;
  disconnect: () => void;
  rescan: () => void;
  selectInput: (id: string) => void;
  selectOutput: (id: string) => void;
  update: (patch: Partial<MidiSettings>) => void;
  learn: () => void;
  cancelLearn: () => void;
  testLeds: () => void;
  clearLog: () => void;
}

export class HardwarePanel {
  private statusEl!: HTMLElement;
  private subEl!: HTMLElement;
  private connectBtn!: HTMLButtonElement;
  private deviceList!: HTMLElement;
  private inputSelect!: HTMLSelectElement;
  private outputSelect!: HTMLSelectElement;
  private connNote!: HTMLElement;
  private learnBox!: HTMLElement;
  private monitor!: HTMLElement;
  private portSignature = '';

  constructor(
    private host: HTMLElement,
    private midi: MidiController,
    private handlers: HardwareHandlers,
  ) {
    this.build();
  }

  private build(): void {
    clear(this.host);

    /* Status */
    const status = h('div', 'hw-status');
    const dot = h('span', 'hw-dot');
    const info = h('div', 'hw-info');
    this.statusEl = h('strong', 'hw-title', 'MIDI');
    this.subEl = h('p', 'hw-sub', 'Verbinde dein DDJ-FLX4 per USB.');
    info.append(this.statusEl, this.subEl);
    this.connectBtn = button('Verbinden', 'btn btn-ghost btn-small', () => this.handlers.connect());
    status.append(dot, info, this.connectBtn);
    this.host.appendChild(status);

    /* Verbindungsmanager */
    const connSection = h('section', 'hw-section');
    connSection.append(h('h3', '', 'FLX4-Verbindungsmanager'));

    const inRow = h('label', 'hw-row');
    inRow.append(h('span', '', 'Eingang · Pads'));
    this.inputSelect = h('select', 'select-inline') as HTMLSelectElement;
    this.inputSelect.addEventListener('change', () => {
      if (this.inputSelect.value) this.handlers.selectInput(this.inputSelect.value);
    });
    inRow.appendChild(this.inputSelect);

    const outRow = h('label', 'hw-row');
    outRow.append(h('span', '', 'Ausgang · LEDs'));
    this.outputSelect = h('select', 'select-inline') as HTMLSelectElement;
    this.outputSelect.addEventListener('change', () => {
      if (this.outputSelect.value) this.handlers.selectOutput(this.outputSelect.value);
    });
    outRow.appendChild(this.outputSelect);

    const connActions = h('div', 'hw-actions');
    connActions.append(
      button('Verbinden', 'btn btn-ghost btn-small', () => this.handlers.connect()),
      button('Trennen', 'btn btn-ghost btn-small', () => this.handlers.disconnect()),
      button('Neu scannen', 'btn btn-ghost btn-small', () => this.handlers.rescan()),
    );
    this.connNote = h('p', 'note', '');
    connSection.append(inRow, outRow, connActions, this.connNote);
    this.host.appendChild(connSection);

    /* Geräte */
    const deviceSection = h('section', 'hw-section');
    deviceSection.append(h('h3', '', 'Erkannte Ports'));
    this.deviceList = h('div', 'device-list');
    deviceSection.appendChild(this.deviceList);
    this.host.appendChild(deviceSection);

    /* Mapping */
    const mapSection = h('section', 'hw-section');
    mapSection.append(h('h3', '', 'DDJ-FLX4 Mapping'));
    const table = h('div', 'map-table');
    const head = h('div', 'map-row map-head');
    head.append(h('span', '', 'Funktion'), h('span', '', 'Kanal'), h('span', '', 'Status'), h('span', '', 'Noten'));
    table.appendChild(head);
    for (const row of flx4MappingTable) {
      const line = h('div', 'map-row');
      line.append(
        h('span', 'map-label', row.label),
        h('span', 'map-mono', row.channel),
        h('span', 'map-mono', row.status),
        h('span', 'map-mono', row.notes),
      );
      table.appendChild(line);
    }
    mapSection.appendChild(table);
    const note = h('p', 'note');
    note.innerHTML =
      'Der Name <b>DDJ-FLX400</b> existiert offiziell nicht – das Gerät heißt <b>DDJ-FLX4</b>. ' +
      'Pads senden auf Kanal 8 (Deck 1) bzw. 10 (Deck 2); die Sampler-Bank nutzt 0x30–0x37. ' +
      'Pad-LEDs werden mit derselben Note angesteuert: <b>0x00</b> aus, <b>0x20</b> gedimmt, <b>0x7F</b> hell. ' +
      '<b>Play/Cue</b> steuern das geladene Deck (ohne Track wie bisher Loop/Stop), ' +
      '<b>Beat Sync</b> mischt die Pads, <b>Jog</b> spielt bzw. scrubbt das Deck, ' +
      '<b>Loop In/Out</b> schaltet die Zufalls-Melodie an/aus, <b>Hot Cue</b> kurz wechselt das Pad-Profil, ' +
      '<b>Hot Cue halten + Play</b> loopt die Sequenz, <b>Beat FX ON/OFF</b> startet die Aufnahme.';
    mapSection.appendChild(note);
    this.host.appendChild(mapSection);

    /* Optionen */
    const options = h('section', 'hw-section');
    options.append(h('h3', '', 'Optionen'));

    const bankRow = h('label', 'hw-row');
    bankRow.append(h('span', '', 'Pad-Bank (Hardware)'));
    const bankSelect = h('select', 'select-inline') as HTMLSelectElement;
    for (const bank of PAD_BANKS) {
      const option = h('option', '', bank.label) as HTMLOptionElement;
      option.value = bank.id;
      option.selected = bank.id === this.midi.settings.padBank;
      bankSelect.appendChild(option);
    }
    bankSelect.addEventListener('change', () =>
      this.handlers.update({ padBank: bankSelect.value as PadBank }),
    );
    bankRow.appendChild(bankSelect);
    options.appendChild(bankRow);

    const ledRow = h('label', 'hw-row');
    ledRow.append(h('span', '', 'LED-Modus'));
    const ledSelect = h('select', 'select-inline') as HTMLSelectElement;
    [
      { value: 'binary', label: 'Stufen (kompatibel)' },
      { value: 'brightness', label: 'Helligkeit (Meter)' },
    ].forEach((entry) => {
      const option = h('option', '', entry.label) as HTMLOptionElement;
      option.value = entry.value;
      option.selected = this.midi.settings.ledMode === entry.value;
      ledSelect.appendChild(option);
    });
    ledSelect.addEventListener('change', () => {
      this.handlers.update({ ledMode: ledSelect.value === 'brightness' ? 'brightness' : 'binary' });
      this.midi.repaintLeds(true);
    });
    ledRow.appendChild(ledSelect);
    options.appendChild(ledRow);

    options.appendChild(this.checkbox('Alle Pad-Bänke auslösen', this.midi.settings.allBanks, (value) =>
      this.handlers.update({ allBanks: value }),
    ));
    options.appendChild(this.checkbox('Shift-Layer stoppt Pads', this.midi.settings.shiftStops, (value) =>
      this.handlers.update({ shiftStops: value }),
    ));
    options.appendChild(this.checkbox('LED-Feedback zum FLX4', this.midi.settings.ledFeedback, (value) =>
      this.handlers.update({ ledFeedback: value }),
    ));
    options.appendChild(this.checkbox('SysEx (FLX4-Keepalive)', this.midi.settings.sysex, (value) =>
      this.handlers.update({ sysex: value }),
    ));

    const ledActions = h('div', 'hw-actions');
    ledActions.append(
      button('LED-Test', 'btn btn-ghost btn-small', () => this.handlers.testLeds()),
      button('Monitor leeren', 'btn btn-ghost btn-small', () => this.handlers.clearLog()),
    );
    options.appendChild(ledActions);
    this.host.appendChild(options);

    /* Learn */
    const learnSection = h('section', 'hw-section');
    learnSection.append(h('h3', '', 'MIDI Learn'));
    this.learnBox = h('div', 'learn-box');
    learnSection.appendChild(this.learnBox);
    this.host.appendChild(learnSection);

    /* Monitor */
    const monitorSection = h('section', 'hw-section');
    monitorSection.append(h('h3', '', 'MIDI-Monitor'));
    this.monitor = h('div', 'monitor');
    monitorSection.appendChild(this.monitor);
    this.host.appendChild(monitorSection);

    this.update(0, 'Pad 1');
  }

  private checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
    const row = h('label', 'switch-row');
    row.append(h('span', 'switch-label', label));
    const wrap = h('span', 'switch');
    const input = h('input') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(input, h('span', 'switch-track'));
    row.appendChild(wrap);
    return row;
  }

  private fillPorts(): void {
    const signature = [
      ...this.midi.portsIn.map((port) => `i${port.id}:${port.name}:${port.state}`),
      '|',
      ...this.midi.portsOut.map((port) => `o${port.id}:${port.name}:${port.state}`),
    ].join('#');
    if (signature === this.portSignature) return;
    this.portSignature = signature;

    clear(this.inputSelect);
    if (!this.midi.portsIn.length) {
      const empty = h('option', '', 'Kein Eingang gefunden') as HTMLOptionElement;
      empty.value = '';
      this.inputSelect.appendChild(empty);
    } else {
      for (const port of this.midi.portsIn) {
        const option = h(
          'option',
          '',
          `${port.name}${port.state === 'connected' ? '' : ' (getrennt)'}`,
        ) as HTMLOptionElement;
        option.value = port.id;
        this.inputSelect.appendChild(option);
      }
    }

    clear(this.outputSelect);
    if (!this.midi.portsOut.length) {
      const empty = h('option', '', 'Kein Ausgang gefunden') as HTMLOptionElement;
      empty.value = '';
      this.outputSelect.appendChild(empty);
    } else {
      for (const port of this.midi.portsOut) {
        const option = h(
          'option',
          '',
          `${port.name}${port.state === 'connected' ? '' : ' (getrennt)'}`,
        ) as HTMLOptionElement;
        option.value = port.id;
        this.outputSelect.appendChild(option);
      }
    }
  }

  update(selectedPad: number, selectedLabel: string): void {
    const { state, profile, learnTarget } = this.midi;

    this.host.dataset.state = state;
    this.connectBtn.hidden = state === 'ready' && this.midi.connected;

    switch (state) {
      case 'unsupported':
        this.statusEl.textContent = 'Web MIDI nicht unterstützt';
        this.subEl.textContent = 'Bitte Chrome, Edge oder Opera verwenden (Safari unterstützt Web MIDI nicht).';
        break;
      case 'denied':
        this.statusEl.textContent = 'MIDI-Zugriff verweigert';
        this.subEl.textContent = 'Berechtigung in der Adressleiste erlauben und erneut verbinden.';
        break;
      case 'error':
        this.statusEl.textContent = 'MIDI-Fehler';
        this.subEl.textContent = 'Controller trennen, neu anstecken und erneut verbinden.';
        break;
      case 'requesting':
        this.statusEl.textContent = 'MIDI wird verbunden …';
        this.subEl.textContent = 'Berechtigungsdialog bestätigen.';
        break;
      case 'ready':
        if (this.midi.connected && profile === 'flx4') {
          this.statusEl.textContent = 'DDJ-FLX4 verbunden';
          this.subEl.textContent = `Eingang: ${this.inputName()} · LEDs: ${this.outputName()} · ${
            this.midi.sysex ? 'SysEx aktiv' : 'ohne SysEx'
          }`;
        } else if (this.midi.connected) {
          this.statusEl.textContent = 'MIDI-Gerät verbunden';
          this.subEl.textContent = `Eingang: ${this.inputName()} · generisches Mapping (Noten 36–51).`;
        } else if (this.midi.portsIn.length) {
          this.statusEl.textContent = 'MIDI getrennt';
          this.subEl.textContent = 'Eingang wählen und „Verbinden“ drücken.';
        } else {
          this.statusEl.textContent = 'MIDI bereit – kein Gerät';
          this.subEl.textContent = 'DDJ-FLX4 per USB-C anschließen; das Gerät erscheint automatisch.';
        }
        break;
      default:
        this.statusEl.textContent = 'MIDI getrennt';
        this.subEl.textContent = 'DDJ-FLX4 anschließen und „Verbinden“ drücken.';
    }

    /* Verbindungsmanager */
    this.fillPorts();
    this.inputSelect.disabled = this.midi.portsIn.length === 0;
    this.outputSelect.disabled = this.midi.portsOut.length === 0;
    if (this.midi.inputId && this.inputSelect.value !== this.midi.inputId) {
      this.inputSelect.value = this.midi.inputId;
    }
    if (this.midi.outputId && this.outputSelect.value !== this.midi.outputId) {
      this.outputSelect.value = this.midi.outputId;
    }
    const linked = this.midi.connected;
    this.connNote.textContent = linked
      ? `Aktiv: ${this.inputName()} → ${this.outputName()}. Pad-Layer: ${
          this.midi.settings.padBank
        }${this.midi.settings.allBanks ? ' (alle Bänke)' : ''}.`
      : this.midi.portsIn.length
        ? 'Gerät erkannt, aber nicht verbunden. Eingang wählen oder „Verbinden“ drücken.'
        : 'Kein MIDI-Port gefunden. FLX4 anschließen und „Neu scannen“ drücken.';

    /* Geräte */
    clear(this.deviceList);
    if (!this.midi.portsIn.length && !this.midi.portsOut.length) {
      this.deviceList.appendChild(h('p', 'empty-note', 'Keine MIDI-Ports gefunden.'));
    } else {
      for (const port of this.midi.portsIn) {
        this.deviceList.appendChild(this.portItem(port.name, 'IN', port.state === 'connected' && port.id === this.midi.inputId));
      }
      for (const port of this.midi.portsOut) {
        this.deviceList.appendChild(this.portItem(port.name, 'OUT', port.state === 'connected' && port.id === this.midi.outputId));
      }
    }

    /* Learn */
    clear(this.learnBox);
    if (learnTarget !== null) {
      this.learnBox.classList.add('is-learning');
      this.learnBox.append(
        h('span', 'learn-pulse'),
        h('span', 'learn-text', `Warte auf Taste für Pad ${learnTarget + 1} …`),
        button('Abbrechen', 'btn btn-ghost btn-small', () => this.handlers.cancelLearn()),
      );
    } else {
      this.learnBox.classList.remove('is-learning');
      const binding = this.midi.bindingFor(selectedPad);
      const text = binding
        ? `Pad ${selectedPad + 1} (${selectedLabel}): Kanal ${binding.channel + 1} · Note ${binding.note}`
        : `Pad ${selectedPad + 1} (${selectedLabel}): FLX4-Standardbelegung`;
      this.learnBox.append(
        h('span', 'learn-text', text),
        button('Learn starten', 'btn btn-ghost btn-small', () => this.handlers.learn()),
      );
    }

    /* Monitor */
    clear(this.monitor);
    if (!this.midi.log.length) {
      this.monitor.appendChild(h('p', 'empty-note', 'Noch keine MIDI-Events. Pad drücken zum Testen.'));
    } else {
      for (const entry of this.midi.log.slice(0, 12)) {
        const line = h('div', `mon-line mon-${entry.tone}`);
        line.append(h('span', 'mon-time', entry.time), h('span', 'mon-text', entry.text));
        this.monitor.appendChild(line);
      }
    }
  }

  private portItem(name: string, kind: 'IN' | 'OUT', active: boolean): HTMLElement {
    const item = h('div', `device-item${active ? ' is-active' : ''}`);
    item.append(h('span', 'device-name', name), h('span', 'device-port', kind));
    return item;
  }

  private inputName(): string {
    const port = this.midi.portsIn.find((entry) => entry.id === this.midi.inputId);
    return port?.name ?? 'kein Eingang';
  }

  private outputName(): string {
    const port = this.midi.portsOut.find((entry) => entry.id === this.midi.outputId);
    return port?.name ?? 'kein Ausgang';
  }
}
