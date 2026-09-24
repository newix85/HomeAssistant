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

**Cílové zařízení (ověřeno 2026-09):** Rockchip RK3288, `armv7l` (32 bit), 2 GB RAM,
GPU Mali-T760 (Panfrost, OpenGL ES 3.1, Mesa 25.0), XFCE na X11, Chromium 150 z Debianu.
Znamená to: WebGL 2 ano, ale skromný výkon a fill-rate. Proto platí striktně low-poly,
render on demand a `renderScale` pod 1 na velkých displejích. RAM hlídat (jen jedna
stránka v kiosku, žádná rozšíření).

Zjištění z `chrome://gpu` (Chromium 150):

- **WebGL: Hardware accelerated** přes ANGLE → OpenGL ES (`GL_VERSION` OpenGL ES 3.0
  → WebGL 2 k dispozici). ANGLE nejdřív zkouší desktop GL a selže; v kiosku proto
  spouštět s `--use-angle=gles`, ušetří to chybu i čas při startu.
- **Video decode: Software only.** Debianí Chromium na ARM nepoužije HW dekodér
  RK3288 (VPU). Každý kamerový stream dekóduje CPU (4× Cortex-A17). Důsledky pro
  pohled Kamery:
  - v mřížce jen **snapshoty** (obnova po několika sekundách) nebo substream
    v nízkém rozlišení (≤ 640×360),
  - živý stream vždy jen **jedna** kamera (po kliknutí), ideálně substream H.264,
  - nikdy ne víc živých 1080p streamů současně.
- Aktivní workaround `exit_on_context_lost`: při nedostatku paměti GPU Chromium
  WebGL kontext zahodí. Appka musí zachytit `webglcontextlost` a obnovit se
  (reload), kiosk musí běžet pod dohledem, který ho při pádu znovu spustí.
- Displej 1920×1080 @ 56,6 Hz. Strop je tedy ~56 fps, cílem je stabilních 30.

Měření výkonu: `scripts/run-bench.sh` spustí `bench/index.html` (scéna ve stylu
appky) a změří fps, p95 a **čas GPU na snímek** (`EXT_disjoint_timer_query_webgl2`)
při `renderScale` 1 / 0,75 / 0,5.

Naměřeno na RK3288 (low-poly scéna, 7 draw callů, ~2 200 trojúhelníků):

| Režim | 1920×1080 | 1440×810 | 960×540 |
|---|---|---|---|
| vsync (výchozí Chromium) | 21,9 fps | 22,4 fps | 26,8 fps |
| unlimited (odesílání, ne vykreslení!) | 108,7 | (zaseknutí) | 382 |
| vsync, HUD jen 2× za s | 21,9 | 28,2 | 37,3 |
| paced (`--disable-gpu-vsync`) | 17,8 | 18,5 | 20,1 |

Poučení z měření:

- `--disable-frame-rate-limit` **nepoužívat**: rAF pak běží rychleji, než GPU
  kreslí, fronta příkazů roste a první synchronní operace (např. změna velikosti
  plátna) čeká na její vyprázdnění. Naměřeno ~11 s zaseknutí, reprodukovatelné
  i mimo desku. Fps v tomto režimu ukazuje rychlost odesílání, ne výkon.
- Z doby dohánění fronty vychází skutečný výkon ~50 fps v 1080p (~19 ms/snímek),
  tedy těsně nad 17,7 ms periodou displeje 56,6 Hz. S vsync proto fps padá na
  polovinu (~22–28). Upřesní měření času GPU.
- Kompozitor xfwm4 výkon měřitelně nebere, nechat zapnutý (bez vsync v Chromiu
  zajistí obraz bez trhání).
- Režim `paced` (`--disable-gpu-vsync`) je na desce **horší** než výchozí vsync,
  nepoužívat.
- **Změna DOM každý snímek je drahá**: zpomalení HUDu na 2× za sekundu zvedlo
  fps o 25–40 %. Overlaye appky aktualizovat nejvýš 1–2× za sekundu.
- Model z měření ve vsync: snímek ≈ **20 ms pevně** (skládání 1920×1080 v Chromiu
  a xfwm4) **+ ~12 ms na megapixel** 3D plátna. Brzdí propustnost paměti
  (každá kopie celé obrazovky ~16 MB), ne složitost scény. Zrychlení tedy přes
  méně celoobrazovkových kopií, ne přes jednodušší 3D.
- `EXT_disjoint_timer_query_webgl2` Chromium nabízí, ale Panfrost vrací 0, takže
  čas GPU přímo měřit nejde.
- Teplota při trvalé animaci stoupla na 65–69 °C → appka musí kreslit jen při
  změně a animace omezit (cíl 28 fps = polovina 56,6 Hz, rovnoměrně).

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

1. **Explicitní whitelist entit.** Odběr jen přes `subscribe_entities` s parametrem
   `entity_ids` (filtr probíhá **na straně HA**, ostatní entity po síti vůbec
   nepřijdou). Instalace má **~7000 entit**, appka potřebuje řádově stovku.
   Zdroj pravdy je **štítek (label) v HA**, např. `dum3d`, případně po pohledech
   `dum3d_energie`, `dum3d_zahrada`. Entity se tedy přidávají klikáním v HA, ne úpravou
   kódu. Appka si je při startu vyžádá šablonou
   `{{ label_entities('dum3d') | tojson }}` přes `render_template` (jedna malá
   odpověď). **Nikdy** nevolá `get_states` ani registr entit celý, u 7000 entit
   jde o jednotky MB JSONu.
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
