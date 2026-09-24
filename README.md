# Dům 3D – Home Assistant dashboard

Minimalistická 3D aplikace pro Armbian 13 (XFCE), napojená na lokální Home Assistant.
Pohledy: dům a počasí, průřez domem, zahrada, kamery, energie (FVE).

- Platforma a zdůvodnění: [docs/platform.md](docs/platform.md)
- Kontrola zařízení: `bash scripts/check-armbian.sh`
- Zátěž z HA (změny/s, nejhlučnější entity): `HA_URL=… HA_TOKEN=… python3 scripts/ha_event_rate.py`
