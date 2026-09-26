// Vstupní bod: načte konfiguraci, spustí scénu, overlay a spojení s HA.

import { HAClient } from './ha.js';
import { HouseScene } from './scene.js';
import { Overlay } from './overlay.js';
import { cloudiness, numericState, powerW } from './format.js';

const PV_ROLES = { house: 'pvHouse', east: 'pvEast', west: 'pvWest', terrace: 'pvTerrace' };
const PHASE_ROLES = ['phaseA', 'phaseB', 'phaseC'];

/** Stav energie pro 3D scénu: podíl výroby 0–1, výkon fází, nabití baterie. */
function energyState(config, states) {
  const get = (role) => states.get(config.entities[role]);
  const pv = {};
  for (const [name, role] of Object.entries(PV_ROLES)) {
    const w = get(role) ? powerW(get(role)) : null;
    const peak = config.pvPeakW?.[name];
    pv[name] = w === null || !peak ? null : w / peak;
  }
  return {
    pv,
    phasesW: PHASE_ROLES.map((role) => (get(role) ? powerW(get(role)) : null)),
    soc: numericState(get('terraceBattery')),
  };
}

const overlayRoot = document.getElementById('overlay');

function fail(message) {
  document.getElementById('setup').hidden = false;
  document.getElementById('setup-message').textContent = message;
  console.error(message);
}

async function loadConfig() {
  const res = await fetch('config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Chybí app/config.json. Zkopíruj config.example.json a doplň token.');
  const config = await res.json();
  if (!config.ha?.url || !config.ha?.token || config.ha.token.startsWith('VLOZ')) {
    throw new Error('V app/config.json chybí ha.url nebo ha.token.');
  }
  return config;
}

async function start() {
  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    fail(e.message);
    return;
  }

  const scene = new HouseScene(document.getElementById('scene'), { renderScale: config.renderScale });
  const overlay = new Overlay(overlayRoot, config);
  const placeTags = () => overlay.placeTags(scene.anchorPositions());
  placeTags();
  addEventListener('resize', placeTags);
  const energyIds = new Set([...Object.values(PV_ROLES), ...PHASE_ROLES, 'terraceBattery']
    .map((role) => config.entities[role]).filter(Boolean));
  const { sun: sunId, weather: weatherId } = config.entities;
  let envKey = '';
  let reportedMissing = false;
  const entityIds = [...new Set(Object.values(config.entities).filter(Boolean))];

  const client = new HAClient({
    url: config.ha.url,
    token: config.ha.token,
    entityIds,
    onStatus: (status, detail) => {
      console.log(`HA: ${status}${detail ? ` (${detail})` : ''}`);
      overlay.setStatus(status, detail);
    },
    onStates: (changed, states) => {
      if (!reportedMissing) {
        // první dávka = všechny existující entity; co chybí, je překlep v configu
        reportedMissing = true;
        const missing = entityIds.filter((id) => !states.has(id));
        console.log(`Přijato ${states.size} z ${entityIds.length} entit`);
        if (missing.length) console.warn(`V HA neexistuje: ${missing.join(', ')}`);
      }
      overlay.update(states);
      if ([...changed].some((id) => energyIds.has(id))) scene.setEnergy(energyState(config, states));
      if (!changed.has(sunId) && !changed.has(weatherId)) return;
      const sun = states.get(sunId);
      const elevation = numericState({ state: sun?.attributes.elevation }) ?? 30;
      const azimuth = numericState({ state: sun?.attributes.azimuth }) ?? 180;
      const clouds = cloudiness(states.get(weatherId)?.state);
      // scénu překreslit jen při viditelné změně (sun.sun posílá i drobné posuny)
      const key = `${elevation.toFixed(1)}|${azimuth.toFixed(0)}|${clouds}`;
      if (key === envKey) return;
      envKey = key;
      scene.setEnvironment({ elevation, azimuth, cloudiness: clouds });
    },
  });
  client.start();
  Object.assign(window, { dum3d: { client, scene, overlay, config } }); // pro ladění v konzoli
}

addEventListener('error', (e) => console.error('Chyba:', e.message));
start();
