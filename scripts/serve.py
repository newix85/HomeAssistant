#!/usr/bin/env python3
"""Statický server pro appku: jako `python3 -m http.server`, ale s Cache-Control: no-cache.

Bez této hlavičky si Chromium soubory heuristicky cachuje a po `git pull` může
kombinovat staré a nové moduly (např. starý ha.js s novým irrigation.js).
no-cache = prohlížeč se vždy zeptá; nezměněné soubory dostane jako levné 304.
"""

import argparse
import functools
import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 - podpis z knihovny
        pass  # tichý provoz (hlášky stránky jdou přes log Chromia)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--directory", default="app")
    args = parser.parse_args()

    handler = functools.partial(NoCacheHandler, directory=args.directory)
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
