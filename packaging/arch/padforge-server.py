#!/usr/bin/env python3
"""Kleiner Static-Server für PADFORGE.

Web MIDI benötigt einen sicheren Kontext. Die Seite wird deshalb an
127.0.0.1 gebunden – http://127.0.0.1 gilt in Chrome/Edge als sicher.
"""

import argparse
import os
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
        ".wasm": "application/wasm",
    }

    def send_head(self):
        path = self.translate_path(self.path)
        missing = not os.path.exists(path)
        if not missing and os.path.isdir(path):
            missing = not os.path.exists(os.path.join(path, "index.html"))
        if missing:
            # SPA-Fallback: alle unbekannten Routen liefern index.html
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        if self.path in ("/", "/index.html") or self.path.startswith("/?"):
            self.send_header("Cache-Control", "no-store")
        elif "/assets/" in self.path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("padforge: %s\n" % (fmt % args))


def main() -> int:
    parser = argparse.ArgumentParser(description="PADFORGE lokaler Webserver")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--root", default=None, help="Verzeichnis mit index.html")
    parser.add_argument("--open", action="store_true", help="Browser nach dem Start öffnen")
    args = parser.parse_args()

    root = os.path.abspath(args.root or os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isfile(os.path.join(root, "index.html")):
        print(f"padforge: index.html fehlt in {root}", file=sys.stderr)
        return 1

    handler = partial(Handler, directory=root)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"PADFORGE läuft auf {url}", flush=True)

    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
