#!/usr/bin/env bash
#
# padforge-setup.sh – selbsttragende Installation und Paketbau für PADFORGE.
#
#   sudo ./padforge-setup.sh install [--service] [--start]
#   ./padforge-setup.sh package [--outdir DIR] [--rebuild]
#   sudo ./padforge-setup.sh uninstall
#
# Das Skript braucht kein makepkg und keine PKGBUILD-Umgebung: es installiert
# die Dateien selbst oder erzeugt ein pacman-fähiges Paket
# (<name>-<version>-<rel>-any.pkg.tar.zst, Fallback .pkg.tar.xz).
#
# Getestet auf Arch Linux / Artix Linux mit OpenRC.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

PKG_NAME="padforge"
PKG_REL="1"
PKG_DESC="Virtuelles 16-Pad-DJ-DrumPad mit Sample-Pack-Scanner und Pioneer DDJ-FLX4 MIDI-Support"

MODE="install"
PREFIX="/usr"
DESTDIR=""
APP_DIR="${REPO_ROOT}"
OUTDIR="${SCRIPT_DIR}"
FORCE_BUILD=0
ENABLE_SERVICE=0
START_SERVICE=0
VERSION=""

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
PADFORGE – Installation und Paketbau (Arch Linux / Artix, OpenRC)

AUFRUF
  padforge-setup.sh [install] [Optionen]     Systemweit installieren (Standard)
  padforge-setup.sh package [Optionen]       pacman-Paket bauen, nichts installieren
  padforge-setup.sh uninstall [Optionen]     Installierte Dateien entfernen
  padforge-setup.sh --help

OPTIONEN
  --prefix DIR      Installationspräfix (Standard: /usr)
  --destdir DIR     Staging-Wurzel, z. B. für Distributionspakete (kein Root nötig)
  --app-dir DIR     Verzeichnis mit dist/ (Standard: Projektwurzel)
  --outdir DIR      Ablage des Pakets (Standard: Verzeichnis dieses Skripts)
  --rebuild         Build erzwingen (npm ci && npm run build)
  --service         OpenRC-Dienst aktivieren (rc-update add padforge default)
  --start           OpenRC-Dienst direkt starten
  -h, --help        Diese Hilfe

BEISPIELE
  sudo ./padforge-setup.sh install --service --start
  sudo ./padforge-setup.sh install --prefix /usr/local
  ./padforge-setup.sh package --rebuild
  sudo pacman -U padforge-1.0.0-1-any.pkg.tar.zst
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    install|package|uninstall) MODE="$1"; shift ;;
    --prefix)    PREFIX="${2:?--prefix braucht einen Wert}"; shift 2 ;;
    --prefix=*)  PREFIX="${1#*=}"; shift ;;
    --destdir)   DESTDIR="${2:?--destdir braucht einen Wert}"; shift 2 ;;
    --destdir=*) DESTDIR="${1#*=}"; shift ;;
    --app-dir)   APP_DIR="${2:?--app-dir braucht einen Wert}"; shift 2 ;;
    --app-dir=*) APP_DIR="${1#*=}"; shift ;;
    --outdir)    OUTDIR="${2:?--outdir braucht einen Wert}"; shift 2 ;;
    --outdir=*)  OUTDIR="${1#*=}"; shift ;;
    --rebuild)   FORCE_BUILD=1; shift ;;
    --service)   ENABLE_SERVICE=1; shift ;;
    --start)     START_SERVICE=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           die "Unbekannte Option: $1 (siehe --help)" ;;
  esac
done

case "$PREFIX" in
  /*) ;;
  *) die "--prefix muss ein absoluter Pfad sein." ;;
esac
PREFIX="${PREFIX%/}"
[ -n "$PREFIX" ] || die "--prefix darf nicht / sein."

[ -d "$APP_DIR" ] || die "App-Verzeichnis fehlt: $APP_DIR"
APP_DIR="$(cd -- "$APP_DIR" && pwd)"

resolve_version() {
  local file="${APP_DIR}/package.json"
  [ -f "$file" ] || file="${REPO_ROOT}/package.json"
  [ -f "$file" ] || return 0
  VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$file" 2>/dev/null || true)"
  if [ -z "$VERSION" ]; then
    VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n1)"
  fi
}
resolve_version
[ -n "$VERSION" ] || VERSION="1.0.0"

need_root() {
  [ -n "$DESTDIR" ] && return 0
  [ "$(id -u)" -eq 0 ] || die "Root nötig: mit sudo starten oder --destdir DIR verwenden."
}

build_app() {
  if [ "$FORCE_BUILD" -eq 0 ] && [ -f "${APP_DIR}/dist/index.html" ]; then
    log "Vorhandener Build: ${APP_DIR}/dist"
    return 0
  fi
  command -v npm >/dev/null 2>&1 || die "npm fehlt – bitte 'nodejs' und 'npm' installieren."
  [ -f "${APP_DIR}/package.json" ] || die "package.json fehlt in ${APP_DIR}."
  log "Baue Anwendung (npm ci && npm run build) ..."
  (
    cd -- "$APP_DIR"
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
    npm run build
  )
  [ -f "${APP_DIR}/dist/index.html" ] || die "Build fehlgeschlagen: dist/index.html fehlt."
}

stage_files() {
  local root="$1"
  local app="${root}${PREFIX}/share/${PKG_NAME}"
  local f

  for f in padforge.sh padforge-browser.sh padforge-server.py padforge-electron.json \
           padforge.desktop padforge.svg padforge.initd padforge.confd padforge.install; do
    [ -f "${SCRIPT_DIR}/${f}" ] || die "Paketdatei fehlt: ${SCRIPT_DIR}/${f}"
  done
  [ -f "${APP_DIR}/dist/index.html" ] || die "Build fehlt: ${APP_DIR}/dist/index.html"
  [ -f "${REPO_ROOT}/desktop/main.cjs" ] || die "Electron-Shell fehlt: ${REPO_ROOT}/desktop/main.cjs"
  [ -f "${REPO_ROOT}/LICENSE" ] || die "Lizenz fehlt: ${REPO_ROOT}/LICENSE"

  install -d \
    "$app" \
    "${root}${PREFIX}/bin" \
    "${root}${PREFIX}/share/applications" \
    "${root}${PREFIX}/share/icons/hicolor/scalable/apps" \
    "${root}${PREFIX}/share/doc/${PKG_NAME}" \
    "${root}${PREFIX}/share/licenses/${PKG_NAME}"

  cp -a "${APP_DIR}/dist/." "$app/"

  install -m644 "${REPO_ROOT}/desktop/main.cjs"          "$app/main.cjs"
  install -m644 "${SCRIPT_DIR}/padforge-electron.json"   "$app/package.json"
  install -m755 "${SCRIPT_DIR}/padforge-server.py"       "$app/server.py"

  install -m755 "${SCRIPT_DIR}/padforge.sh"          "${root}${PREFIX}/bin/padforge"
  install -m755 "${SCRIPT_DIR}/padforge-browser.sh"  "${root}${PREFIX}/bin/padforge-browser"
  install -m644 "${SCRIPT_DIR}/padforge.desktop"     "${root}${PREFIX}/share/applications/padforge.desktop"
  install -m644 "${SCRIPT_DIR}/padforge.svg"         "${root}${PREFIX}/share/icons/hicolor/scalable/apps/padforge.svg"
  install -m644 "${REPO_ROOT}/README.md"             "${root}${PREFIX}/share/doc/${PKG_NAME}/README.md"
  install -m644 "${REPO_ROOT}/LICENSE"               "${root}${PREFIX}/share/licenses/${PKG_NAME}/LICENSE"

  if [ "$PREFIX" = "/usr" ]; then
    install -d "${root}/etc/init.d" "${root}/etc/conf.d"
    install -m755 "${SCRIPT_DIR}/padforge.initd" "${root}/etc/init.d/padforge"
    install -m644 "${SCRIPT_DIR}/padforge.confd" "${root}/etc/conf.d/padforge"
  fi
}

refresh_caches() {
  if [ -z "$DESTDIR" ] && command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${PREFIX}/share/applications" >/dev/null 2>&1 || true
  fi
  if [ -z "$DESTDIR" ] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f "${PREFIX}/share/icons/hicolor" >/dev/null 2>&1 || true
  fi
}

enable_openrc() {
  if [ "$PREFIX" != "/usr" ]; then
    warn "OpenRC-Dienst wird nur mit --prefix /usr installiert – übersprungen."
    return 0
  fi
  if command -v rc-update >/dev/null 2>&1; then
    rc-update add padforge default
  else
    warn "rc-update fehlt (kein OpenRC?) – Dienst nicht aktiviert."
  fi
}

start_openrc() {
  if [ "$PREFIX" != "/usr" ]; then
    return 0
  fi
  if command -v rc-service >/dev/null 2>&1; then
    rc-service padforge start
  else
    warn "rc-service fehlt (kein OpenRC?) – Dienst nicht gestartet."
  fi
}

mode_install() {
  need_root
  build_app
  log "Installiere nach ${DESTDIR}${PREFIX} ..."
  stage_files "$DESTDIR"
  refresh_caches
  if [ -z "$DESTDIR" ] && [ "$ENABLE_SERVICE" -eq 1 ]; then enable_openrc; fi
  if [ -z "$DESTDIR" ] && [ "$START_SERVICE" -eq 1 ]; then start_openrc; fi
  log "Fertig. Desktop-GUI: padforge · Browser: padforge-browser"
}

mode_package() {
  build_app
  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf -- "${WORK_DIR:-}"' EXIT
  local root installed_size base tmp_tar out
  root="${WORK_DIR}/root"
  mkdir -p "$root"
  log "Baue Paket ${PKG_NAME} ${VERSION}-${PKG_REL} ..."
  stage_files "$root"
  install -m644 "${SCRIPT_DIR}/padforge.install" "${root}/.INSTALL"

  installed_size="$(python3 - "$root" <<'PY'
import os, sys
total = 0
for dirpath, _dirs, files in os.walk(sys.argv[1]):
    for name in files:
        path = os.path.join(dirpath, name)
        if os.path.isfile(path) and not os.path.islink(path):
            total += os.path.getsize(path)
print(total)
PY
)"

  mkdir -p "$OUTDIR"
  OUTDIR="$(cd -- "$OUTDIR" && pwd)"
  base="${OUTDIR}/${PKG_NAME}-${VERSION}-${PKG_REL}-any.pkg.tar"
  tmp_tar="${WORK_DIR}/${PKG_NAME}.tar"

  python3 - "$root" "$tmp_tar" "$PKG_NAME" "$VERSION" "$PKG_REL" "$installed_size" "$PKG_DESC" <<'PY'
import gzip
import hashlib
import os
import stat
import sys
import tarfile
import time

root, out_tar, name, version, rel, size, desc = sys.argv[1:8]
builddate = int(os.environ.get("SOURCE_DATE_EPOCH") or time.time())
pkgver = f"{version}-{rel}"


def digest(path, algo):
    h = hashlib.new(algo)
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


info = "\n".join([
    "# Generated by padforge-setup.sh",
    f"pkgname = {name}",
    f"pkgbase = {name}",
    f"pkgver = {pkgver}",
    f"pkgdesc = {desc}",
    f"builddate = {builddate}",
    "packager = PADFORGE",
    f"size = {size}",
    "arch = any",
    "license = MIT",
    "depend = electron",
    "depend = python",
    "depend = xdg-utils",
]) + "\n"
with open(os.path.join(root, ".PKGINFO"), "w", encoding="utf-8") as fh:
    fh.write(info)
os.chmod(os.path.join(root, ".PKGINFO"), 0o644)

entries = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for d in sorted(dirnames):
        p = os.path.join(dirpath, d)
        entries.append(("./" + os.path.relpath(p, root).replace(os.sep, "/"), True, p))
    for f in sorted(filenames):
        p = os.path.join(dirpath, f)
        entries.append(("./" + os.path.relpath(p, root).replace(os.sep, "/"), False, p))
entries.sort(key=lambda item: item[0])

lines = ["#mtree", "/set type=file uid=0 gid=0 mode=644"]
for arc, is_dir, path in entries:
    st = os.stat(path)
    mode = format(stat.S_IMODE(st.st_mode), "o")
    if is_dir:
        lines.append(f"{arc} type=dir mode={mode} time={int(st.st_mtime)}")
    else:
        lines.append(
            f"{arc} mode={mode} time={int(st.st_mtime)} size={st.st_size} "
            f"md5digest={digest(path, 'md5')} sha256digest={digest(path, 'sha256')}"
        )
mtree_path = os.path.join(root, ".MTREE")
with open(mtree_path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
    gz.write(("\n".join(lines) + "\n").encode("utf-8"))
os.chmod(mtree_path, 0o644)


def add(tar, path, arcname, is_dir, mode):
    ti = tar.gettarinfo(path, arcname=arcname + ("/" if is_dir else ""))
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = "root"
    ti.mtime = builddate
    ti.mode = mode
    if is_dir:
        tar.addfile(ti)
    else:
        with open(path, "rb") as fh:
            tar.addfile(ti, fh)


with tarfile.open(out_tar, "w", format=tarfile.GNU_FORMAT) as tar:
    for name in (".PKGINFO", ".INSTALL", ".MTREE"):
        path = os.path.join(root, name)
        add(tar, path, name, False, stat.S_IMODE(os.stat(path).st_mode))
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for d in sorted(dirnames):
            p = os.path.join(dirpath, d)
            add(tar, p, os.path.relpath(p, root), True, 0o755)
        for f in sorted(filenames):
            p = os.path.join(dirpath, f)
            if f in (".PKGINFO", ".INSTALL", ".MTREE") and dirpath == root:
                continue
            add(tar, p, os.path.relpath(p, root), False, stat.S_IMODE(os.stat(p).st_mode))
PY

  if command -v zstd >/dev/null 2>&1; then
    out="${base}.zst"
    zstd -q -f -19 --threads=0 -o "$out" "$tmp_tar"
  else
    out="${base}.xz"
    xz -6 -T0 -c "$tmp_tar" > "$out"
  fi

  chmod 644 "$out"
  log "Paket erstellt: $out"
  if command -v pacman >/dev/null 2>&1; then
    printf '    Installieren:  sudo pacman -U %q\n' "$out"
  else
    printf '    Inhalt:        tar -tf %q\n' "$out"
  fi
}

mode_uninstall() {
  need_root
  if [ -z "$DESTDIR" ] && command -v rc-service >/dev/null 2>&1; then
    rc-service padforge stop >/dev/null 2>&1 || true
  fi
  if [ -z "$DESTDIR" ] && command -v rc-update >/dev/null 2>&1; then
    rc-update del padforge default >/dev/null 2>&1 || true
  fi
  local paths=(
    "${DESTDIR}${PREFIX}/share/${PKG_NAME}"
    "${DESTDIR}${PREFIX}/bin/padforge"
    "${DESTDIR}${PREFIX}/bin/padforge-browser"
    "${DESTDIR}${PREFIX}/share/applications/padforge.desktop"
    "${DESTDIR}${PREFIX}/share/icons/hicolor/scalable/apps/padforge.svg"
    "${DESTDIR}${PREFIX}/share/doc/${PKG_NAME}"
    "${DESTDIR}${PREFIX}/share/licenses/${PKG_NAME}"
    "${DESTDIR}/etc/init.d/padforge"
    "${DESTDIR}/etc/conf.d/padforge"
  )
  local p
  for p in "${paths[@]}"; do
    if [ -e "$p" ] || [ -L "$p" ]; then
      rm -rf -- "$p"
      printf '  entfernt: %s\n' "$p"
    fi
  done
  refresh_caches
  log "PADFORGE entfernt."
}

case "$MODE" in
  install)   mode_install ;;
  package)   mode_package ;;
  uninstall) mode_uninstall ;;
  *)         die "Unbekannter Modus: $MODE" ;;
esac
