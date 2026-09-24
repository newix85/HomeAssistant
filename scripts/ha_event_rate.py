#!/usr/bin/env python3
"""Změří, kolik změn stavů Home Assistant posílá, a kdo je nejhlučnější.

Použití:
    export HA_URL=http://homeassistant.local:8123
    export HA_TOKEN=...            # long-lived access token (profil v HA)
    python3 scripts/ha_event_rate.py --seconds 300
    python3 scripts/ha_event_rate.py --label dum3d   # jen entity se štítkem

S --label ukáže zátěž, kterou uvidí aplikace (odebírá jen štítkované entity).

Závislost: websockets (Debian: apt install python3-websockets).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter

import ha_client


async def measure(url: str, token: str, seconds: float, top: int, label: str | None) -> None:
    async with await ha_client.connect(url, token) as ws:
        await ws.send(json.dumps({"id": 1, "type": "get_states"}))
        await ws.send(json.dumps({"id": 2, "type": "subscribe_events", "event_type": "state_changed"}))
        labeled: set[str] | None = None
        if label:
            template = "{{ label_entities(%s) | tojson }}" % json.dumps(label)
            await ws.send(json.dumps({"id": 3, "type": "render_template", "template": template}))

        entity_count = 0
        per_entity: Counter[str] = Counter()
        attr_only: Counter[str] = Counter()
        event_bytes: Counter[str] = Counter()
        deadline = time.monotonic() + seconds
        print(f"Měřím {seconds:.0f} s …", file=sys.stderr)

        while (remaining := deadline - time.monotonic()) > 0:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if msg.get("id") == 1 and msg.get("type") == "result":
                entity_count = len(msg.get("result") or [])
            elif msg.get("id") == 3 and msg.get("type") == "event":
                result = msg["event"].get("result")
                labeled = set(json.loads(result) if isinstance(result, str) else result or [])
            elif msg.get("id") == 2 and msg.get("type") == "event":
                data = msg["event"]["data"]
                entity_id = data["entity_id"]
                per_entity[entity_id] += 1
                event_bytes[entity_id] += len(raw)
                old, new = data.get("old_state") or {}, data.get("new_state") or {}
                if old.get("state") == new.get("state"):
                    attr_only[entity_id] += 1

    if label:
        if labeled is None:
            sys.exit(f"Štítek '{label}' se nepodařilo načíst (HA 2024.4+?).")
        per_entity = Counter({e: n for e, n in per_entity.items() if e in labeled})
        attr_only = Counter({e: n for e, n in attr_only.items() if e in labeled})
        event_bytes = Counter({e: n for e, n in event_bytes.items() if e in labeled})
        print(f"\nŠtítek '{label}':        {len(labeled)} entit")

    total = sum(per_entity.values())
    per_domain = Counter()
    for entity_id, n in per_entity.items():
        per_domain[entity_id.split(".", 1)[0]] += n

    print(f"\nEntit v HA:            {entity_count}")
    print(f"Změn za {seconds:.0f} s:          {total}  ({total / seconds:.1f}/s)")
    print(f"Z toho jen atributy:   {sum(attr_only.values())}  (stav se nezměnil)")
    print(f"Objem událostí:        {sum(event_bytes.values()) / seconds / 1024:.1f} KiB/s")
    print(f"Aktivních entit:       {len(per_entity)}")

    print(f"\nTop {top} entit (změn/min, podíl jen-atributy):")
    for entity_id, n in per_entity.most_common(top):
        print(f"  {n * 60 / seconds:7.1f}  {attr_only[entity_id] / n:4.0%}  {entity_id}")

    print("\nPodle domény (změn/min):")
    for domain, n in per_domain.most_common():
        print(f"  {n * 60 / seconds:7.1f}  {domain}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ha_client.add_connection_args(parser)
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--label", help="měřit jen entity s tímto štítkem (label_id)")
    args = parser.parse_args()

    ha_client.run(args.url, lambda url, token: measure(url, token, args.seconds, args.top, args.label))


if __name__ == "__main__":
    main()
