#!/bin/sh
# PADFORGE im Browser öffnen (Fallback ohne Electron).
# Startet den lokalen Server, falls er noch nicht läuft.

self=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
APP_DIR="${PADFORGE_APP_DIR:-$(dirname "$self")/../share/padforge}"
[ -f "${APP_DIR}/server.py" ] || APP_DIR="/usr/share/padforge"

PORT="${PADFORGE_PORT:-8787}"
URL="http://127.0.0.1:${PORT}/"

if python3 - "$PORT" <<'PY'
import socket
import sys

sock = socket.socket()
sock.settimeout(0.4)
sys.exit(0 if sock.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
PY
then
  exec xdg-open "$URL"
fi

exec python3 "${APP_DIR}/server.py" --host 127.0.0.1 --port "$PORT" --open
