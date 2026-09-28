# Provozní poznámky k desce

Tento soubor drží ověřená zjištění, která se snadno ztratí mezi konverzacemi.
Stavy a běžící procesy jsou časové snímky; před další akcí přes SSH je znovu ověř.
Nikdy sem neukládej HA token, SSH passphrase ani soukromý klíč.

## Přístup

- Cílová deska: `ha@10.0.0.34`; projekt: `~/HomeAssistant`.
- Přihlášení veřejným klíčem funguje. Klíč `~/.ssh/id_ed25519` je chráněný passphrase; pro neinteraktivní SSH z Codexu je potřeba jej odemknout v macOS Keychain/agentu příkazem `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`. Passphrase zadává uživatel pouze do lokálního terminálu; nikdy ji neukládat ani neposílat do chatu.
- `app/config.json` na desce je ignorovaný a nesledovaný Gitem. Při nasazení ho zachovat.

## Ověřený stav 2026-09-28

- Deska měla commit `a393074` a starý `scripts/run-app.sh` spouštěl `python3 -m http.server`; `scripts/serve.py` chyběl. Odpovědi serveru neměly `Cache-Control: no-cache`, takže po aktualizaci mohlo Chromium kombinovat staré a nové ES moduly.
- Proveden `git pull --ff-only` na commit `25f312a`. Pracovní strom zůstal čistý a `app/config.json` zachovaný. Aktualizovaný `scripts/run-app.sh` používá `scripts/serve.py` a maže starou cache profilu Chromium.
- Po spuštění přes `bash scripts/run-app.sh` bylo na desce ověřeno `Cache-Control: no-cache`, HTTP 200, připojení HA WebSocketu a přijetí všech 29 z 29 nakonfigurovaných entit; v logu nebyly chyby `callService` ani „V HA neexistuje“.
- Při živém pozorování HA ukázal aktivní zónu `stromky`, průběh postoupil z 26 % na 82 % a potom přešel do klidu (`sensor.irrisense_2_progress = unknown`, aktivní zóna `Idle`). UI zobrazilo výsledek „Hotovo“. HA zaznamenal změnu tlačítka Start v 11:59:48 UTC; původ tohoto stisku nebyl potvrzen a agent žádné volání Start/Stop neposlal. Uživatel požádal nechat běh dokončit. Fyzické tlačítko Stop na skutečném IrriSense zůstává neověřené.
- Při první kontrole po restartu desky neběželo Chromium. Aplikace byla následně spuštěna ručně. Kiosk autostart zůstává vypnutý; nezapínat bez nového pokynu.

## Terasa Anenji

- Baterie: `sensor.anenji_4_2kw_anenji_4_2kw_battery_state_of_charge`.
- Výstupní priorita: `select.anenji_4_2kw_anenji_4_2kw_output_priority`.
- Automatické přepínání: `automation.anenji_prepnout_na_suf_pri_vyssim_pv_nez_load_bez_pomocneho_senzoru`.
- Při čtení HA 2026-09-28 měla baterie stav `100.0 %`, automatizace `off` a výstupní priorita `PV-Battery-Utility (SBU)`. Dostupné volby režimu byly `Utility-PV-Battery (UTI)`, `PV-Utility-Battery (SOL)`, `PV-Battery-Utility (SBU)`, `PV-Utility-Battery (SUB)` a `PV-Battery-Feedback (SUF)`.
- V UI ovládání automatizace používej samostatné služby `automation.turn_on` a `automation.turn_off`; ovladač měniče je `select.select_option`. Nevolat je během vizuálního ověřování panelu.
- Detail terasy byl 2026-09-28 nasazen přenosem souborů `app/index.html`, `app/style.css`, `app/src/main.js`, `app/src/property.js` a `app/src/terrace.js`. Na desce zůstává Git HEAD `25f312a`; tyto soubory jsou tedy v pracovním stromu mimo commit a před příštím `git pull` je potřeba změny zachovat/začlenit.
- Do existujícího `app/config.json` byly aditivně přidány role `terraceOutputPriority` a `terraceAutomation`; token zůstal zachován a nebyl vypsán. Po restartu 2026-09-28 Chromium běželo přes `scripts/run-app.sh`, server vracel `Cache-Control: no-cache` a HA spojení přijalo všech 31 z 31 nakonfigurovaných entit. V konzolovém logu nebyly chyby aplikace ani `callService` / „V HA neexistuje“; objevil se jen Chromium `QUOTA_EXCEEDED` pro Google GCM.
- Dne 2026-09-28 byl detail doplněn o průběžně aktualizovanou výrobu FVE `sensor.anenji_4_2kw_anenji_4_2kw_pv_average_power`, formátovanou ve W/kW. Používá stávající roli `pvTerrace`, která už byla v konfiguraci a odběru HA; konfiguraci nebylo potřeba dále měnit.
- Po nasazení výroby a restartu 2026-09-28 server vracel HTTP 200 a `Cache-Control: no-cache`, HA se připojilo a přijalo 31 z 31 entit. V logu nebyly chyby aplikace ani `callService` / „V HA neexistuje“. Agent při restartu nevolal služby měniče, automatizace ani zavlažování.
- Při posledním nasazení zůstává Git HEAD desky `25f312a`; změny aplikace jsou přímo v jejím pracovním stromu. Před dalším `git pull` je třeba změny začlenit nebo bezpečně zachovat.

## Nasazení

Na desce zachovej `app/config.json`, ověř stav aplikace a pracovního stromu, ukonči starý kiosk, proveď `git pull --ff-only` a spusť `bash scripts/run-app.sh`. Nepoužívej `python -m http.server`; ověř hlavičku `Cache-Control: no-cache` po startu.
