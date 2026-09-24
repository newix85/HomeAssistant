// Vstupní bod: načte konfiguraci, spustí scénu, overlay a spojení s HA.

import { HAClient } from './ha.js';
import { HouseScene } from './scene.js';
import { Overlay } from './overlay.js';
import { cloudiness, numericState } from './format.js';

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
  const { sun: sunId, weather: weatherId } = config.entities;
  let envKey = '';

  const client = new HAClient({
    url: config.ha.url,
    token: config.ha.token,
    entityIds: [...new Set(Object.values(config.entities).filter(Boolean))],
    onStatus: (status, detail) => overlay.setStatus(status, detail),
    onStates: (changed, states) => {
      overlay.update(states);
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
