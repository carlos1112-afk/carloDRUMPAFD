# PADFORGE für Arch Linux / Artix Linux (OpenRC)

Das Paket installiert eine **Desktop-GUI auf Basis von Electron**, die gebaute
Web-App, einen kleinen Python-Server, Launcher sowie einen **OpenRC**-Dienst.
Es gibt keine systemd-Abhängigkeit.

## Bauen und installieren

```bash
cd packaging/arch
makepkg -si
```

`makepkg` installiert die Build-Abhängigkeiten (`nodejs`, `npm`) und baut die
App mit `npm ci && npm run build`. Zur Laufzeit werden `electron`, `python`
und `xdg-utils` benötigt. Das Ergebnis liegt als
`padforge-1.0.0-1-any.pkg.tar.zst` daneben.

### Ohne makepkg

`padforge-setup.sh` ist selbsttragend und braucht keine PKGBUILD-Umgebung:

```bash
sudo ./padforge-setup.sh install --service   # direkt nach /usr
./padforge-setup.sh package                  # nur bauen, nichts installieren
sudo pacman -U padforge-1.0.0-1-any.pkg.tar.zst
sudo ./padforge-setup.sh uninstall
```

Optionen: `--prefix DIR` (z. B. `/usr/local`), `--destdir DIR` (Staging, ohne
Root), `--app-dir DIR`, `--outdir DIR`, `--rebuild`, `--service`, `--start`.

## Starten

**Desktop-GUI (empfohlen):**

```bash
padforge
```

Öffnet ein eigenständiges Fenster (kein Browser-Chrome). Die GUI lädt die App
über das interne, sichere Protokoll `padforge://app` und erlaubt Web MIDI
sowie SysEx für den DDJ-FLX4.

**Browser-Fallback:**

```bash
padforge-browser
```

Startet den lokalen Server, falls er nicht läuft, und öffnet
`http://127.0.0.1:8787/` im Standardbrowser.

**OpenRC-Dienst (systemweit, Port 8787):**

```bash
sudo rc-service padforge start
sudo rc-update add padforge default
```

## Warum localhost bzw. ein eigenes Protokoll?

Web MIDI ist nur in einem *sicheren Kontext* erlaubt. Die GUI erfüllt das über
das privilegierte `padforge://`-Schema, der Browser über `127.0.0.1` bzw.
`localhost`. Eine öffentliche IP funktioniert nicht; der Server bindet deshalb
standardmäßig nur an `127.0.0.1`.

## Dienst anpassen

```bash
# /etc/conf.d/padforge
PADFORGE_PORT="8787"
```

Danach:

```bash
sudo rc-service padforge restart
```

## Deinstallation

```bash
sudo rc-service padforge stop
sudo rc-update del padforge default
sudo pacman -R padforge
```

## Dateien

| Pfad | Inhalt |
| --- | --- |
| `/usr/share/padforge/` | Electron-App (`package.json`, `main.cjs`, `dist/`) |
| `/usr/share/padforge/index.html` | Einstiegspunkt der gebauten Web-App |
| `/usr/share/padforge/server.py` | lokaler Static-Server (Browser-Fallback) |
| `/usr/bin/padforge` | Launcher für die Desktop-GUI |
| `/usr/bin/padforge-browser` | Launcher für den Browser-Fallback |
| `/etc/init.d/padforge` | OpenRC-Dienst |
| `/etc/conf.d/padforge` | Host/Port des Dienstes (Konfigurationsdatei) |
| `/usr/share/applications/padforge.desktop` | Desktop-Eintrag |
