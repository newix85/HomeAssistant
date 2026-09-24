# Dům 3D – Home Assistant dashboard

Minimalistická 3D aplikace pro Armbian 13 (XFCE), napojená na lokální Home Assistant.
Pohledy: dům a počasí, průřez domem, zahrada, kamery, energie (FVE).

## Spuštění appky (na desce)

```bash
cp app/config.example.json app/config.json   # doplnit ha.url a ha.token
bash scripts/run-app.sh
```

`app/config.json` obsahuje token, je v `.gitignore` a **nikdy se necommituje** (repo je veřejné).

## Dokumentace a nástroje

- Platforma a zdůvodnění: [docs/platform.md](docs/platform.md)
- Kontrola zařízení: `bash scripts/check-armbian.sh`
- Test výkonu 3D (na desce, výsledky do terminálu): `bash scripts/run-bench.sh` (`MODE=vsync|paced|unlimited`)
- Kandidáti na entity pro pohled Dům a počasí: `python3 scripts/ha_find_entities.py`
- Zátěž z HA (změny/s, nejhlučnější entity): `HA_URL=… HA_TOKEN=… python3 scripts/ha_event_rate.py [--label dum3d]`
