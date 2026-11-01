# PADFORGE — virtuelles DJ-DrumPad

16 frei belegbare Pads, fünf fertige Sampler-Packs, ein Sample-Pack-Scanner, audio-reaktives Licht in Gruppenfarben und ein echter Web-MIDI-Treiber für den Pioneer DJ **DDJ-FLX4** (der im Umlauf befindliche Name „DDJ-FLX400“ existiert offiziell nicht).

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # Typprüfung + Produktionsbuild
```

> Web MIDI und `setSinkId` brauchen Chrome/Edge/Opera (Safari hat kein Web MIDI). Die Seite muss über `https://` oder `localhost` laufen.

## Desktop-GUI

`npm run desktop` startet PADFORGE in einem eigenen nativen Fenster (Electron) – ohne Browser-Chrome, mit Menüleiste und eigener `padforge://`-Origin. Voraussetzung ist Electron (`pacman -S electron` oder `npm i -D electron`); vorher `npm run build` ausführen.

Die Shell (`desktop/main.cjs`) liefert die gebaute App über ein privilegiertes, sicheres Schema aus und gibt ausschließlich `midi`/`midiSysex` frei. Dadurch funktionieren Web MIDI, SysEx und `setSinkId` wie im Browser, aber in einem eigenständigen Programm. Externe Links werden im Systembrowser geöffnet.

---

## Was drin ist

### 5 vorinstallierte Sampler-Packs
| Pack | BPM | Charakter |
| --- | --- | --- |
| Club House | 124 | Garage/House-Starter, Congas, Vox-Chop, Top-Loop |
| Techno Bunker | 132 | harte Kick, Siren, Metallic, Hat-/Perc-Loops |
| Boom Bap Dust | 90 | Boom-Kick, 808, Scratch, Vinyl-Stop, Break-Loop |
| Trap Pressure | 140 | 808 long, Trap-Kick, Bell/Pluck, 808-Loop |
| Latin Afro | 108 | Conga/Bongo/Timbale/Cowbell/Clave/Guiro/Djembe/Cajon |

Alle 80 Sounds werden **im Browser synthetisiert** (`src/audio/synth.ts`, OfflineAudioContext) – keine Binär-Assets, dafür sofort einsatzbereit. Jedes Pad ist danach vollständig frei editierbar.

### Funktionen eines echten DJ-DrumPads
- **Pad-Modi**: One-Shot, Gate (klingt nur beim Halten), Toggle (Start/Stop), Loop (BPM-synchron, phasengleich)
- **16-stufige Velocity** über MIDI-Anschlag oder Mausposition (oben leise → unten laut)
- **Choke-Gruppen** (4), damit z. B. die Open-Hat die Closed-Hat abschneidet
- **Tuning** (±24 Halbtöne), Level, Pan, Start-Offset, Reverse
- **Attack / Decay / Release** und Filter (LP/HP/BP mit Cutoff) pro Pad
- **Reverb-/Delay-Sends** pro Pad, Master-Reverb und tempo-synchrones Delay (3/16)
- **Quantize** 1/4 … 1/32 (nächster Rasterpunkt wird präzise geplant)
- **Roll / Retrigger** pro Pad (1/16, 1/32) – auch per `Shift`+Pad oder `Shift`+Taste
- **Master-FX** momentary: LP-Filter, HP-Filter, Echo-Throw, Beat-Gate
- **Kit-Persistenz** (localStorage), **eigene Samples** dauerhaft in IndexedDB
- Tastatur: `1–4`, `Q–R`, `A–F`, `Z–V`; `Esc` stoppt alles, `Entf` leert das Pad

### Decks & Beat Sync
- Im Tab **Decks** lassen sich zwei komplette Tracks laden (Player/Deck 1 und 2). Play/Pause, Cue und die Fortschrittsleiste steuern den Track; er läuft über denselben Master, inklusive Master-FX, Limiter und Set-Aufnahme.
- **Jog-Modus pro Deck**: „Dauerlauf“ (Jog pitch-bendet beim Laufen, scrubbed im Stand) oder **„Nur beim Drehen“** (vorwärts drehen spielt, Loslassen stoppt, rückwärts spult zurück). Die Wahl wird gespeichert.
- **Beat Sync** am FLX4 (Note `0x58`) oder der **Shuffle**-Button belegt die 16 Pads zufällig neu; `Ctrl`+`Z` macht den letzten Shuffle rückgängig (bis zu 20 Schritte).
- FLX4-Jog: `CC 0x21` (Side), `CC 0x22/0x23` (Platter) auf Kanal 1/2. Play/Cue steuern das Deck, wenn ein Track geladen ist – sonst wie bisher den Pad-Loop bzw. Stop.

### Performance: Aufnahme, Profile, Melodien
- **Aufnahme**: `REC` (oder `Shift`+`Leertaste`, am FLX4 `Beat FX ON/OFF`) nimmt Pad-Hits über 1, 2, 4 oder 8 Bars auf, quantisiert aufs Raster und loopt sie danach automatisch. Der Loop läuft weiter, während du darüber spielst; `Clear` löscht die Sequenz.
- **Loop**: `Leertaste` oder `Play` startet/stoppt die Sequenz. **Hot Cue halten + Play** startet sie neu von vorn.
- **Set-/Track-Aufnahme**: `● Set REC` oder `Alt`+`R` schneidet den kompletten Master mit – Pads, Loops, Melodie und Master-FX. Die Aufnahme läuft als WebM/Opus (192 kbit/s), wird beim Stoppen automatisch heruntergeladen und lässt sich über „Speichern“ erneut laden. Aufgenommen wird der fertige Mix nach Limiter und Master-Regler; eine Mikrofon-Berechtigung ist nicht nötig.
- **Profile 1/2**: `P` oder **Hot Cue kurz** wechselt zwischen zwei unabhängigen 16-Pad-Belegungen (inkl. Kit, BPM und Pads). Beide werden getrennt gespeichert.
- **Zufalls-Melodie**: `M` oder die FLX4-Tasten **Loop In / Loop Out** schalten eine pentatonische Zufallsmelodie aus den tonalen/bass-Pads an bzw. aus.
- **Cue** stoppt alles (Panic), **4 Beat** wechselt die Loop-Länge zwischen 1 und 2 Bars.

> Beim Spielen über MIDI oder Tastatur bleibt die Pad-Auswahl im Editor stehen – nur ein Klick auf ein Pad wechselt den bearbeiteten Slot. Dadurch springt der Inspector beim Jammen nicht mehr.

### Sample-Pack-Scanner
- Ordner per Klick oder Drag & Drop einlesen (auch verschachtelt, bis 800 Dateien)
- **Funktionserkennung am Dateinamen** (EN/DE + Abkürzungen): Kick/Bd/Boom, Snare, Clap/Rim, Hat/HH/CHH/OHH, Perc/Conga/Bongo/Tom/Shaker…, Bass/808/Sub, Vox/Acap/Chop, FX/Riser/Impact/Zap, Loop/Top/Break
- **WAV-Header-Parsing**: Samplerate, Bit-Tiefe, Kanäle, Dauer
- **BPM-Erkennung** aus dem Dateinamen (`_128bpm`)
- Gruppierte Vorschau, Einzel-Preview per Klick
- Automatischer **16-Pad-Belegungsvorschlag** (Kick, Snare, Clap, Hats, Perc, Bass, Tonal, Vox, FX, Loops) und Übernahme als eigenes Kit

### Licht
Jedes Pad hat einen eigenen `AnalyserNode`. Die Beleuchtung folgt also dem **tatsächlichen Audiosignal**: Glow, Innen-Ring und LED-Leiste atmen mit dem Pegel, die Farbe kommt aus der Sound-Gruppe (Kick rot, Snare orange, Hat cyan, Perc grün, Bass violett, Vocal pink, FX blau, Loop gelb). Dieselben Pegel gehen als Helligkeit an die Hardware-LEDs.

---

## Pioneer DDJ-FLX4 / „DDJ-FLX400“

### Treiber
Der FLX4 ist **USB Class Compliant** – Audio und MIDI funktionieren unter macOS und Linux ohne Treiber. Unter Windows funktioniert er ebenfalls treiberlos (USB Audio 2.0 seit Win10); AlphaTheta bietet zusätzlich einen Windows-Treiber für niedrigere Latenz an. Der Browser braucht **keinen** Hersteller-Treiber, nur Web MIDI.

### So wird er angesprochen
`src/midi.ts` enthält das Mapping, das aus der offiziellen MIDI-Liste und dem Mixxx-Mapping abgeleitet ist:

| Funktion | MIDI-Kanal | Status | Noten |
| --- | --- | --- | --- |
| Deck 1, Pads 1–8 (Bank folgt dem Modus) | 8 | `0x97` | `0x00–0x07` / `0x30–0x37` … |
| Deck 2, Pads 9–16 (Bank folgt dem Modus) | 10 | `0x99` | `0x00–0x07` / `0x30–0x37` … |
| Shift-Layer (Pad stoppen) | 9 / 11 | `0x98` / `0x9A` | `0x30–0x37` |
| Sampler-Modus-Taste | 1 / 2 | `0x90` / `0x91` | `0x22` |
| Hot Cue / Pad FX / Beat Jump | 1 / 2 | `0x90` / `0x91` | `0x1B` / `0x1E` / `0x20` |
| Beat Loop / Keyboard / Key Shift | 1 / 2 | `0x90` / `0x91` | `0x6D` / `0x69` / `0x6F` |
| Shift | 1 / 2 | `0x90` / `0x91` | `0x3F` |
| Hot Cue (kurz = Profil 1/2) | 1 / 2 | `0x90` / `0x91` | `0x1B` |
| Play / Cue (Loop / Stop) | 1 / 2 | `0x90` / `0x91` | `0x0B` / `0x0C` |
| Loop In / Loop Out (Melodie) | 1 / 2 | `0x90` / `0x91` | `0x10` / `0x11` |
| Beat FX ON/OFF (Aufnahme) | 5 / 6 | `0x94` / `0x95` | `0x47` |
| 4 Beat (Loop-Länge) | 1 / 2 | `0x90` / `0x91` | `0x4D` |
| Beat Sync (Pad-Shuffle) | 1 / 2 | `0x90` / `0x91` | `0x58` |
| Jog Wheel (Track/Scrub) | 1 / 2 | `0xB0` / `0xB1` | `CC 0x21 / 0x22 / 0x23` |

- Sampler-Pad n (Deck 1) = `0x97`, Note `0x30 + (n-1)`, Velocity `0x7F` = Druck, `0x00` = Release.
- LEDs: dieselbe Note/Status mit Velocity `0x00–0x7F`. Die LED-Bank folgt dem aktiven Gerätemodus (Hot Cue `0x00`, Sampler `0x30` …), sonst leuchten die Pads ins Leere. Belegte Pads sind gedimmt (`0x20`), Hits kurz hell (`0x7F`).
- Der FLX4 sendet im Shift-Layer andere **Kanäle** (9/11), nicht nur andere Noten – deshalb wertet der Treiber beide Ebenen aus.
- Die Pad-Modus-Tasten schalten im Tool die aktive Hardware-Bank um und leuchten passend.
- Optionales SysEx-Keepalive (`F0 00 40 05 00 00 04 05 00 50 02 F7`) wird alle 5 s gesendet, wenn SysEx erlaubt wurde; ohne SysEx funktioniert das Pad-Mapping weiterhin.
- **MIDI Learn**: Jedes Pad kann eine beliebige Note/Kanal-Bindung bekommen (Hardware-Tab → Learn). Generische Controller triggern zusätzlich Noten 36–51 (MPC-Standard).

### Verbindungsmanager
Im Hardware-Tab (Einstellungen) sitzt ein eigener Verbindungsmanager:

- **Eingang (Pads)** und **Ausgang (LEDs)** werden getrennt gewählt – der FLX4 erscheint automatisch als erster Port.
- **Verbinden / Trennen / Neu scannen**, inklusive Status, Port-Liste und Live-Anzeige des aktiven Paars.
- Die Auswahl wird gespeichert und beim nächsten Start wiederhergestellt; fällt ein Port weg, wird automatisch der FLX4 gewählt.
- Trennen gibt die Ports frei, ohne die Browser-Berechtigung zu verlieren.
- Der LED-Ausgang ist separat wählbar, damit z. B. ein anderer Controller die Pads spielt.

### LED-Ansteuerung
- Pad-LEDs: Deck 1 auf Kanal 8 (`0x97`), Deck 2 auf Kanal 10 (`0x99`), Noten `0x30–0x37`.
- Standardmodus **Stufen** nutzt die von Pioneer dokumentierten Pegel: `0x00` aus, `0x20` gedimmt, `0x7F` hell.
- Belegte Pads leuchten im Ruhezustand gedimmt, freie Pads sind aus; beim Spielen geht das Pad auf hell.
- Optionaler Modus **Helligkeit** sendet kontinuierliche Velocity-Werte als Pegelanzeige.
- Die Modus-Taste (z. B. Sampler) leuchtet mit; nach einem Moduswechsel zeichnet die App die Pad-LEDs neu, weil der FLX4 sie dabei löscht.
- `LED-Test` im Hardware-Tab prüft alle 16 Pads und die Modus-Taste.

### Audio-Ausgang
Über den Button „Audio Out“ lässt sich der Browser-Ausgang per `AudioContext.setSinkId()` direkt auf die FLX4-Soundkarte legen (Master = Kanäle 1/2, Kopfhörer = 3/4).

### Grenzen (ehrlich)
- Getestet wurde hier ohne angeschlossenes Gerät: Web MIDI, Mapping-Logik, LED-Ausgabe und die Simulation sind implementiert, die physische Verifikation am FLX4 muss am Gerät erfolgen. Der MIDI-Monitor im Hardware-Tab zeigt genau, was ankommt.
- PAD-FX-Pads 7/8 (`0x16/0x17`) sind in der Community-Doku nur interpoliert und werden nicht benötigt.
- Safari unterstützt Web MIDI nicht.

### Quellen
- Pioneer DJ Produktseite DDJ-FLX4: <https://www.pioneerdj.com/en/product/dj-controllers/ddj-flx4/>
- Mixxx-Handbuch (Class-Compliant, Pad-Modi, Kanalbelegung): <https://manual.mixxx.org/2.4/en/hardware/controllers/pioneer_ddj_flx4>
- Mixxx-Mapping (Noten/Statusbytes): <https://github.com/mixxxdj/mixxx/blob/main/res/controllers/Pioneer-DDJ-FLX4.midi.xml>
- FLX4-MIDI-Doku (Pad-Bänke, Kanäle, gemessene Noten): <https://github.com/protocol-works/lsdj/blob/main/docs/midi-ddj-flx4.md>
- AlphaTheta Support (MIDI-kompatible Software / MIDI-Liste): <https://support.alphatheta.com/en-us/articles/12294087060377>
- MDN Web MIDI API: <https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API>

---

## Installation auf Arch Linux / Artix (OpenRC)

Das Paket liegt unter `packaging/arch` und enthält **keine systemd-Abhängigkeit**: Electron-Desktop-GUI, gebaute Web-App, Python-Static-Server, Launcher, Desktop-Eintrag und einen OpenRC-Dienst.

```bash
cd packaging/arch
makepkg -si
```

Ohne `makepkg` geht es mit dem mitgelieferten Setup-Skript – es installiert direkt oder baut ein pacman-Paket:

```bash
sudo ./packaging/arch/padforge-setup.sh install --service
./packaging/arch/padforge-setup.sh package --rebuild   # → padforge-1.0.0-1-any.pkg.tar.zst
sudo pacman -U packaging/arch/padforge-1.0.0-1-any.pkg.tar.zst
```

Danach entweder systemweit über OpenRC:

```bash
sudo rc-service padforge start
sudo rc-update add padforge default
# → http://127.0.0.1:8787/
```

oder als normaler Benutzer ohne Root:

```bash
padforge          # Desktop-GUI (Electron-Fenster)
padforge-browser  # Fallback: Server starten und im Browser öffnen
```

Details, Dateiliste und Konfiguration (`/etc/conf.d/padforge`): [packaging/arch/README.md](packaging/arch/README.md)

Der Server bindet bewusst nur an `127.0.0.1`, weil Web MIDI einen sicheren Kontext verlangt. Beim Bauen werden `nodejs`/`npm` als Build-Abhängigkeiten benötigt, zur Laufzeit nur `python` und `xdg-utils`.

---

## Aufbau

```
src/
  audio/synth.ts     Sample-Synthese (80 Werkssounds, Rezepte)
  audio/packs.ts     die fünf Packs
  audio/engine.ts    Stimmen, Choke, Quantize, Sends, Master-FX, Pegel
  scanner.ts         Datei-Klassifikation, WAV-Header, Pad-Plan
  midi.ts            Web MIDI + DDJ-FLX4-Profil, LEDs, Learn
  store.ts           State, IndexedDB-Samples, Bindings
  ui/                Pad-Grid, Inspector, Hardware-Panel, DOM-Helfer
  main.ts            Verdrahtung
desktop/main.cjs     Electron-GUI (eigenes sicheres Protokoll, MIDI-Permissions)
packaging/arch/      PKGBUILD, OpenRC-Dienst, Launcher, Static-Server, Icon
```
