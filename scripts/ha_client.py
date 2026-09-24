"""Společné připojení k Home Assistant WebSocket API pro skripty v tomto adresáři.

Závislost: websockets (Debian: apt install python3-websockets).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

import websockets

DEFAULT_URL = "http://homeassistant.local:8123"


def ws_url(http_url: str) -> str:
    base = http_url.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return base + "/api/websocket"


def add_connection_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--url", default=os.environ.get("HA_URL", DEFAULT_URL),
                        help="adresa HA (výchozí $HA_URL)")


async def connect(url: str, token: str):
    """Otevře WebSocket a přihlásí se. Vrací spojení připravené k použití."""
    ws = await websockets.connect(ws_url(url), max_size=None)
    await ws.recv()  # auth_required
    await ws.send(json.dumps({"type": "auth", "access_token": token}))
    auth = json.loads(await ws.recv())
    if auth.get("type") != "auth_ok":
        await ws.close()
        sys.exit(f"Autentizace selhala: {auth}")
    return ws


def run(url: str, main: Callable[[str, str], Awaitable[None]]) -> None:
    """Ověří token a adresu, spustí main(url, token) a chyby spojení vypíše česky."""
    token = os.environ.get("HA_TOKEN")
    if not token:
        sys.exit("Nastav HA_TOKEN (long-lived access token).")

    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or "://" in parts.netloc + parts.path:
        sys.exit(f"Neplatná adresa HA: {url!r}\n"
                 "Očekávám např. http://192.168.1.10:8123 nebo http://homeassistant.local:8123")
    try:
        asyncio.run(main(url, token))
    except websockets.exceptions.WebSocketException as e:
        sys.exit(f"Server na {url} nepřijal WebSocket spojení: {e}\n"
                 "Je to opravdu adresa Home Assistantu (port 8123)?")
    except OSError as e:
        sys.exit(f"Nelze se připojit k {url}: {e}\n"
                 f"Ověř adresu (getent hosts {parts.hostname}) a že HA běží.")
