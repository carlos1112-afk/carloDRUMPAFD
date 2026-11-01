#!/bin/sh
# PADFORGE Desktop-GUI starten (Electron-Fenster, kein Browser-Chrome).

self=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
APP_DIR="${PADFORGE_APP_DIR:-$(dirname "$self")/../share/padforge}"

if [ ! -f "${APP_DIR}/index.html" ]; then
  APP_DIR="/usr/share/padforge"
fi

if ! command -v electron >/dev/null 2>&1; then
  echo "PADFORGE: 'electron' fehlt. Bitte das Paket 'electron' installieren." >&2
  exit 1
fi

if [ ! -f "${APP_DIR}/index.html" ]; then
  echo "PADFORGE: Anwendung nicht installiert (${APP_DIR}/index.html fehlt)." >&2
  exit 1
fi

exec electron "${APP_DIR}" "$@"
