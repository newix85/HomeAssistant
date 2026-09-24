#!/usr/bin/env python3
"""Najde kandidáty na entity pro pohled „Dům a počasí“ a seřadí je podle vhodnosti.

Použití:
    export HA_URL=http://homeassistant.local:8123
    export HA_TOKEN=...
    python3 scripts/ha_find_entities.py            # max. 12 kandidátů na roli
    python3 scripts/ha_find_entities.py --limit 0  # všichni kandidáti
    python3 scripts/ha_find_entities.py --role rain --role wind_direction --limit 0
    python3 scripts/ha_find_entities.py --exclude kolna      # vyřadit další entity

Entity Zahrádky (samostatné místo mimo dům) projekt nepoužívá, proto jsou
vyřazené vždy (DEFAULT_EXCLUDE).

★ = jméno napovídá venkovnímu/meteo senzoru. „stáří“ = kdy entita naposledy
něco nahlásila (last_reported); vysoké stáří prozradí mrtvou/zdvojenou kopii.
Skript jen čte, nic nemění.
"""

from __future__ import annotations

import argparse
import json
import unicodedata
from datetime import datetime, timezone

import ha_client

# Role pohledu: (popis, device_class, klíčová slova v entity_id/jménu)
ROLES: dict[str, tuple[str, set[str], tuple[str, ...]]] = {
    "temperature": ("Teplota", {"temperature"}, ()),
    "humidity": ("Vlhkost", {"humidity"}, ()),
    "pressure": ("Tlak", {"pressure", "atmospheric_pressure"}, ()),
    "illuminance": ("Osvětlení (lx)", {"illuminance"}, ()),
    "irradiance": ("Sluneční záření (W/m²)", {"irradiance"}, ("solar_rad", "radiation", "zareni")),
    "uv": ("UV index", set(), ("uv",)),
    "wind_speed": ("Rychlost větru", {"wind_speed"}, ()),
    "wind_direction": ("Směr větru", {"wind_direction"}, ("wind_dir", "wind_bearing", "smer_vetru")),
    "rain": ("Srážky", {"precipitation", "precipitation_intensity"}, ("rain", "dest", "srazk")),
}

# Nápovědy, že jde o venkovní / meteo senzor (bez diakritiky, malými písmeny)
# „zahrada“ = zahrada u domu; „zahradka“ je jiné místo, proto ne obecné „zahrad“
OUTDOOR_HINTS = ("venk", "outdoor", "outside", "exterior", "zahrada", "garden", "meteo",
                 "weather", "pocasi", "station", "stanice", "ecowitt", "netatmo", "davis")

# Zahrádka je jiné místo než dům, projekt ji nepoužívá (rozhodnutí uživatele)
DEFAULT_EXCLUDE = ("zahradka",)

# Tyhle domény nejsou měření (např. number.*_temperature je nastavení)
SENSOR_DOMAINS = ("sensor",)


def plain(text: str) -> str:
    """Malá písmena bez diakritiky, aby šlo porovnávat „Venkovní“ i „venkovni“."""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def matches(role: str, state: dict) -> bool:
    _, classes, keywords = ROLES[role]
    entity_id = state["entity_id"]
    if entity_id.split(".", 1)[0] not in SENSOR_DOMAINS:
        return False
    attrs = state.get("attributes", {})
    if attrs.get("device_class") in classes:
        return True
    text = plain(entity_id + " " + str(attrs.get("friendly_name", "")))
    if role == "uv":
        # „uv“ je krátké: jen jako samostatné slovo (uv_index, UV index), ne „uvnitr“
        words = text.replace(".", " ").replace("_", " ").split()
        return "uv" in words or "uvi" in words
    return any(k in text for k in keywords)


def outdoor_score(state: dict) -> int:
    text = plain(state["entity_id"] + " " + str(state.get("attributes", {}).get("friendly_name", "")))
    return sum(h in text for h in OUTDOOR_HINTS)


def fmt_age(state: dict) -> str:
    stamp = state.get("last_reported") or state.get("last_updated")
    if not stamp:
        return "?"
    seconds = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()
    for unit, size in (("d", 86400), ("h", 3600), ("min", 60)):
        if seconds >= size:
            return f"{seconds / size:.0f} {unit}"
    return f"{seconds:.0f} s"


def fmt_state(state: dict) -> str:
    unit = state.get("attributes", {}).get("unit_of_measurement", "")
    return f"{state['state']} {unit}".strip()


async def find(url: str, token: str, limit: int, roles: list[str], exclude: list[str]) -> None:
    async with await ha_client.connect(url, token) as ws:
        await ws.send(json.dumps({"id": 1, "type": "get_states"}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == 1 and msg.get("type") == "result":
                states = msg.get("result") or []
                break

    print(f"Entit v HA: {len(states)}")
    exclude = [*DEFAULT_EXCLUDE, *exclude]
    states = [s for s in states if not any(x in s["entity_id"] for x in exclude)]
    print(f"Po vyřazení entit obsahujících {', '.join(exclude)}: {len(states)}")
    for role, (title, classes, _) in ROLES.items():
        if roles and role not in roles:
            continue
        found = [s for s in states if matches(role, s)]
        # Venkovní napřed, pak nedostupné na konec, pak podle entity_id
        found.sort(key=lambda s: (-outdoor_score(s), s["state"] in ("unavailable", "unknown"), s["entity_id"]))
        shown = found if limit <= 0 else found[:limit]
        cls = ", ".join(sorted(classes)) or "podle jména"
        print(f"\n== {title} [{role}] ({cls}): {len(found)} kandidátů"
              + (f", zobrazeno {len(shown)}" if len(shown) < len(found) else "") + " ==")
        for s in shown:
            star = "★" if outdoor_score(s) else " "
            name = s.get("attributes", {}).get("friendly_name", "")
            print(f" {star} {s['entity_id']:<55} {fmt_state(s):>14}  {fmt_age(s):>6}  {name}")

    if roles:
        return
    weather = sorted(s["entity_id"] for s in states if s["entity_id"].startswith("weather."))
    print(f"\n== Předpověď [weather.*]: {len(weather)} ==")
    for entity_id in weather:
        print(f"   {entity_id}")
    has_sun = any(s["entity_id"] == "sun.sun" for s in states)
    print(f"\n== Slunce: sun.sun {'✓ je k dispozici' if has_sun else '✗ chybí (integrace Sun)'} ==")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ha_client.add_connection_args(parser)
    parser.add_argument("--limit", type=int, default=12, help="max. kandidátů na roli (0 = všichni)")
    parser.add_argument("--role", action="append", choices=list(ROLES), default=[],
                        help="jen tahle role (lze opakovat)")
    parser.add_argument("--exclude", action="append", default=[],
                        help="vyřadit entity, jejichž entity_id obsahuje tento text (lze opakovat)")
    args = parser.parse_args()
    ha_client.run(args.url, lambda url, token: find(url, token, args.limit, args.role, args.exclude))


if __name__ == "__main__":
    main()
