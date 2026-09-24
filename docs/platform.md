# Platforma pro zobrazení (ADR-001)

**Stav:** navrženo · **Cíl:** Armbian 13 (Debian 13 „Trixie“) + XFCE, lokální síť s Home Assistantem

## Rozhodnutí

| Vrstva | Volba | Proč |
|---|---|---|
| Runtime / displej | **Chromium v kiosk režimu** spuštěný z autostartu XFCE | Nejlepší WebGL na ARM Linuxu (GPU přes Mesa/Panfrost), bez okenních dekorací, snadný restart |
| 3D | **Three.js** (WebGL 2, fallback WebGL 1) | Malý, zralý, glTF loader, ideální pro minimalistický low-poly styl |
| Jazyk / build | **TypeScript + Vite** | Rychlý dev server s hot reloadem na PC, výstup = statické soubory |
| UI nad scénou | Čisté HTML/CSS overlaye (bez velkého frameworku) | Minimalismus, nulová režie; framework lze přidat později, pokud UI naroste |
| Napojení na HA | **WebSocket API** přes `home-assistant-js-websocket` | Push stavů v reálném čase (`subscribe_entities`), volání služeb, oficiální knihovna |
| Kamery | HA stream / **go2rtc (WebRTC nebo MSE)** do `<video>` | Nízká latence, dekódování v prohlížeči, žádná vlastní transkódovací vrstva |
| 3D modely | **glTF/GLB** (Blender, případně export ze Sweet Home 3D) | Standard, komprimovatelný (Draco/meshopt), přímá podpora v Three.js |
| Nasazení | Statický build servírovaný `nginx`/`caddy` na zařízení (nebo z HA `/config/www`) | Žádný běžící Node na zařízení |

Jedna věta: **webová aplikace (Three.js) jako statické soubory, zobrazená v Chromium kiosku, mluvící přímo s HA přes WebSocket.**

## Zvážené alternativy

| Varianta | Plusy | Proč ne (teď) |
|---|---|---|
| **Godot 4** (Compatibility renderer, GLES3) | Nativní, výkonné 3D, ARM64 exporty | Kamery (RTSP/WebRTC) jsou v Godotu bolest; HA klient by se psal ručně; pomalejší iterace UI |
| **PySide6 + Qt Quick 3D** | Python, nativní, QtMultimedia pro kamery | Těžší dependencies na ARM, QML + Python dvojkolejnost, menší ekosystém 3D assetů |
| **Python + Panda3D / moderngl** | Čistý Python | Příliš nízkoúrovňové pro UI, overlaye a video |
| **Electron / Tauri** | Desktop „appka“ | Electron = Chromium navíc (bez přidané hodnoty oproti kiosku); Tauri používá WebKitGTK, jehož WebGL na ARM je slabší |
| **HA custom panel / Lovelace karta** | Autentizace zdarma, jeden systém | Svázanost s HA frontendem a jeho životním cyklem; kiosk by vždy nesl HA chrome |

Python má v projektu místo, jen ne v renderingu – viz „Rozšíření“.

## Realita hardwaru (hlavní riziko)

Výkon celé věci stojí na GPU desky. Armbian 13 nese novou Mesu, takže:

- **Mali G-series (RK3588 – Panthor, RK356x/H6/H616/S905X3 – Panfrost):** WebGL 2 v Chromiu funguje, low-poly scéna při 30–60 fps v pohodě.
- **Mali-400/450 (Lima, starší Allwinner/Amlogic):** jen GLES 2 → WebGL 1, velmi omezený fill-rate. Scéna musí být extrémně jednoduchá, případně renderovat v nižším rozlišení.
- **Bez GPU akcelerace** (chybí ovladač, Wayland/X problém): Chromium spadne na SwiftShader (CPU) → nepoužitelné pro 3D.

Ověření na zařízení: `scripts/check-armbian.sh` a v Chromiu stránka `chrome://gpu` (hledáme `WebGL2: Hardware accelerated`).

## Zásady pro výkon (platí od prvního řádku kódu)

1. **Render on demand** – překreslovat jen při změně stavu, animaci nebo interakci, ne neustálých 60 fps. Šetří CPU/GPU i teplotu SBC.
2. `renderer.setPixelRatio(Math.min(devicePixelRatio, 1))` a možnost globálního `renderScale` (např. 0.75).
3. Žádné dynamické stíny; stíny a AO **zapéct** do textur v Blenderu, materiály `MeshLambert`/`MeshToon`/`MeshBasic`.
4. Obloha jako **gradient shader** (dvě barvy podle času a oblačnosti), ne fyzikální `Sky`.
5. Low-poly modely, jeden GLB na pohled, komprese meshopt, textury max. 1024 px (KTX2, pokud GPU zvládne).
6. Kamery vždy jen **aktivní pohled** – stream se zastaví při odchodu z pohledu.

## Datový tok z HA (proč to nemá sekat jako Lovelace v kiosku)

Standardní HA frontend odebírá **všechny** entity. Každá změna (i jen atributu) přepíše
globální objekt `hass` a spustí přepočet všech karet. Při stovkách entit a senzorech
s aktualizacemi po sekundách (výkony, RSSI, …) je hlavní vlákno prohlížeče pořád zahlcené.
Chromium za to nemůže, dělá to ten vzor. Tady to řešíme takhle:

1. **Explicitní whitelist entit** v konfiguraci. Odběr jen přes
   `subscribe_entities` s parametrem `entity_ids` (filtr probíhá **na straně HA**,
   ostatní entity po síti vůbec nepřijdou).
2. **Store mimo vykreslování**: příchozí změny se jen zapíšou do mapy
   (`entity_id → stav`), nic dalšího se nespouští.
3. **Dávkování**: překreslení nejvýš jednou za snímek (`requestAnimationFrame`),
   pro číselné overlaye stačí jednou za 1 s.
4. **Mrtvé pásmo**: změna, která se po zaokrouhlení na zobrazenou přesnost
   neprojeví (např. 1 234,4 W → 1 234,6 W při zobrazení v kW), nic nespustí.
5. **Jen aktivní pohled**: entity neaktivních pohledů se ukládají, ale
   nepřekreslují se. Kamery a grafy se mimo pohled zastaví.
6. **Historie až na vyžádání** (`history/stream` pro jeden graf), žádné
   trvalé odebírání historie.

Diagnostika: `scripts/ha_event_rate.py` změří, kolik změn za sekundu HA posílá
a které entity jsou nejhlučnější. U těch se vyplatí snížit frekvenci
aktualizací už v HA (interval pollingu integrace, `throttle`/filtr senzoru).

## Pohledy (mapa na architekturu)

Každý pohled = jedna „scéna“ se sdíleným rendererem a sdíleným HA stavem:

1. **Dům** – exteriér, obloha podle času/slunce, overlay: světelnost, čas, teplota, tlak, vlhkost, UV/radiace, vítr, déšť
2. **Průřez domem** – clipping plane v Three.js, místnosti obarvené podle teploty/stavu
3. **Zahrada** – body zájmu (zavlažování, osvětlení, …) jako klikací hotspoty
4. **Kamery** – mřížka `<video>` přes go2rtc
5. **Energie** – FVE, baterie, spotřeba, toky energie (animované „částice“ po drátech), ovládání

## Rozšíření (později, volitelně)

Malý **Python gateway (FastAPI/aiohttp)** na zařízení nebo v síti, pokud přibude potřeba:

- nedržet HA token v prohlížeči (proxy WebSocketu),
- agregace/historie (např. predikce výroby FVE, statistiky),
- AI funkce (shrnutí stavu domu, anomálie spotřeby).

Pro MVP to není potřeba – token bude v lokálním, **necommitovaném** `config.json` na zařízení v důvěryhodné LAN.

## Otevřené otázky

- Jaká deska (SoC/GPU) a jaký displej (rozlišení, dotyk ano/ne)?
- XFCE na X11 (výchozí), nebo Wayland? (X11 je pro kiosk jednodušší.)
- Běží už v HA go2rtc (součást HA od 2024.11) – a jsou kamery v HA?
- Máme půdorys/rozměry domu (pro model v Blenderu / Sweet Home 3D)?
