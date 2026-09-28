# Pokyny pro další práci

## Cíl projektu

Vytváříme minimalistickou 3D aplikaci pro dotykový displej na Armbianu 13 s XFCE. Aplikace zobrazuje dům a zahradu kolem domu, stav domácnosti z Home Assistantu, zavlažování, kamery a později energii/FVE. „Zahrádka“ v entitách označuje jiné místo a do projektu nepatří.

## Rozhodnutí a důvody

- Zobrazovací platforma: Chromium v kiosk režimu, Three.js a čisté HTML/CSS/ES moduly. Bez buildu a CDN, aby šlo nasazovat přes `git pull` i na slabém ARM zařízení.
- Home Assistant: vlastní WebSocket klient v `app/src/ha.js`; odebírat jen entity ze štítku HA `dum3d` (a případných štítků pro další pohledy). Nevyžadovat kompletní seznam tisíců entit ani `get_states`.
- Cílová deska zdokumentovaná v `docs/platform.md`: Rockchip RK3288, ARMv7, 2 GB RAM, Mali-T760/Panfrost, XFCE/X11. Výkon a paměť jsou omezené: renderovat při změně, držet scénu low-poly, omezit aktualizace DOM a streamovat nejvýše jednu kameru současně. Ověřená konfigurace a benchmarky jsou v `docs/platform.md`; před změnou výkonových voleb je znovu změř na zařízení.
- HA token patří pouze do necommitovaného `app/config.json` na zařízení. Nikdy ho nevypisuj do logu, výstupů ani commitu.
- Zavlažovač IrriSense 2 je v exteriérové scéně vedle domu na svahu, aby nebyl zakryt střechou. Za běhu se zobrazuje vodní vějíř a kruh postřiku.

## Historie a stav funkcí

- Aplikace má být rozšiřitelná o pohled na dům s počasím, průřez domu, zahradu s ovládacími body, kamery a samostatný pohled Energie.
- Zavlažování je implementované v `app/src/irrigation.js`: klepnutí na objekt/štítek otevře detail s mapou zón z HA, stavem a průběhem, výběrem programu a dávky načteným z HA, a tlačítky Spustit/Zastavit. Výsledek služby se ukazuje v detailu; po minutě bez dotyku se zavře.
- V pracovním kódu má terasa Anenji klikací detail z altánu/FVE i z terasového a bateriového štítku. Zobrazuje stav baterie `sensor.anenji_4_2kw_anenji_4_2kw_battery_state_of_charge`, aktuální výrobu `sensor.anenji_4_2kw_anenji_4_2kw_pv_average_power`, režim `select.anenji_4_2kw_anenji_4_2kw_output_priority` a automatizaci `automation.anenji_prepnout_na_suf_pri_vyssim_pv_nez_load_bez_pomocneho_senzoru`; režim se mění přes `select.select_option`, automatizace explicitně přes `automation.turn_on` / `automation.turn_off`. Provozní stav a ověřené volby jsou v `docs/device-status.md`.
- Simulovaný HA ověřil otevření detailu oběma způsoby, načtení mapy a voleb, změnu programu/dávky, spuštění, průběh a zastavení. Simulace zaznamenala čtyři očekávaná volání služeb. Na zařízení HA 2026-09-28 ukázal průběh 26 → 82 %, zónu `stromky` a následně klidový stav (`unknown` / `Idle`); agent neposlal Start ani Stop a fyzický vodní proud nebyl přímo pozorován. Podrobnosti jsou v `docs/device-status.md`.
- Předpoklad běhu: číselný `sensor.irrisense_2_progress` pod 100 znamená, že zavlažování běží. Na zařízení byl pozorován postup a klidový stav po běhu; při příštím výslovném fyzickém testu ještě ověř skutečný vodní proud a tlačítko `Zastavit`.
- Na desce se objevila chyba `this.client.callService is not a function`, protože Chromium smíchalo cachovanou starou `ha.js` s novou `irrigation.js`. Oprava v konverzaci: `scripts/serve.py` posílá `Cache-Control: no-cache`, `scripts/run-app.sh` ho používá a maže starou cache profilu. Kód už byl podle historie commitnut a pushnut. Nevracej nasazení k `python -m http.server`.
- Při opravě panelu byla mapa zón upravena tak, aby se vešla do panelu; `Idle` se zobrazuje jako pomlčka a typy voleb jako `(Point)` jsou vizuálně podružné.
- Autostart/kiosk byl výslovně odložen: skripty zůstávají v repozitáři, ale samy nic nespouštějí. Neinstaluj ani nezapínej autostart bez nového pokynu.

## Nasazení a ověřování na zařízení

- Tentokrát máš oprávnění připojit se na cílovou desku přes SSH a provádět tam potřebné ověřování sám; předchozí postupy, které žádaly uživatele o ruční spuštění příkazů, jsou zastaralé.
- SSH cílový host je `ha@10.0.0.34` jako výchozí hodnota v `scripts/screenshot.sh`, ale ověř dostupnost/aktuální alias z repo-skriptů, SSH configu o kterém víš, nebo předchozích údajů. Nezobrazuj soukromé klíče ani citlivý obsah konfigurace.
- Na desce je projekt v `~/HomeAssistant`. Obvyklé nasazení: ukončit běžící appku, `git pull`, znovu spustit `bash scripts/run-app.sh`. Zachovej `app/config.json` na desce; nepřepisuj jej vzorovou konfigurací ani nevypisuj jeho token.
- Ověřený přístup, nasazený commit a provozní pozorování ukládej do `docs/device-status.md`. Je to časový snímek: stav desky před další akcí znovu ověř. Nikdy tam neukládej heslo, passphrase SSH klíče ani HA token.
- Nejdřív zkontroluj stav appky a logy přes SSH. Po změně kódu můžeš nasadit a sám pořídit snímek přes `bash scripts/screenshot.sh [uživatel@host] [složka]`.
- Ovládání `Spustit` opravdu spouští vodu. Při fyzickém testu zvol nejkratší/nejnižší dávku, sleduj, že běží, a následně ověř `Zastavit`; zkontroluj stav v HA i UI. Nespouštěj zálivku opakovaně ani dlouhý program jako pouhý test.
- Ověř v konzoli, že se neopakuje chyba `callService`, `V HA neexistuje` ani chyba volání služby. Zkontroluj také mapu zón, hodnoty a změny programu/dávky, štítek ve 3D, detail a chování senzoru po skončení.
- Při SSH akci, která může fyzicky ovládat zařízení, nejprve dbej na to, že požadavek uživatele skutečně zahrnuje tento test. Samotné čtení logů, snímky a nasazení opravy jsou běžné ověřovací kroky; fyzické spuštění zalévání proveď jen v rámci výslovně zamýšleného testu.

## Pracovní pravidla

- Před změnou prohlédni relevantní zdroj, konfiguraci a `docs/platform.md`; neodvozuj aktuální stav jen z této historie.
- Zachovej rozdělení scény/renderu, HA klienta a UI. Změny dělej úsporně s ohledem na hardware.
- Když se lokální vývoj liší od desky, reprodukuj problém na zařízení přes SSH, pokud je dostupné. Rozlišuj mezi ověřeným na simulaci a ověřeným na skutečném hardware.
- Nepřidávej testy, pokud o ně uživatel nepožádá; provozní ověření aplikace na desce je v tomto projektu součást práce, když o něj požádá.
- Kiosk autostart je zatím odložen. Vždy zachovej token mimo Git.
