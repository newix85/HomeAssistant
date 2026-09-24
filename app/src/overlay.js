// HTML overlay nad scénou: čas, počasí, stav spojení.
// DOM se mění jen při změně zobrazeného textu a nejvýš jednou za sekundu
// (každá změna DOM stojí na RK3288 citelný výkon, viz docs/platform.md).

import {
  cardinal, conditionText, formatAge, formatDate, formatNumber, formatTime, numericState, seaLevelPressure,
} from './format.js';

const FLUSH_MS = 1000;

export class Overlay {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.el = Object.fromEntries(
      [...root.querySelectorAll('[data-field]')].map((node) => [node.dataset.field, node]),
    );
    this.dirty = false;
    this.states = new Map();
    this.#tickClock();
  }

  #set(field, text) {
    const node = this.el[field];
    if (node && node.textContent !== text) node.textContent = text;
  }

  #tickClock() {
    const now = new Date();
    this.#set('time', formatTime(now));
    this.#set('date', formatDate(now));
    // i bez nových dat přepočítat stáří hodnot (senzor mohl přestat posílat)
    if (this.states.size) this.#render();
    // další aktualizace přesně na začátku příští minuty
    setTimeout(() => this.#tickClock(), 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  setStatus(status, detail) {
    const labels = {
      connecting: 'připojuji k HA…',
      connected: 'HA připojeno',
      disconnected: 'HA odpojeno',
      auth_invalid: 'HA odmítl token',
    };
    this.root.dataset.status = status;
    this.#set('status', labels[status] + (detail ? ` (${detail})` : ''));
  }

  update(states) {
    this.states = states;
    if (this.dirty) return;
    this.dirty = true;
    setTimeout(() => {
      this.dirty = false;
      this.#render();
    }, FLUSH_MS);
  }

  #entity(role) {
    const id = this.config.entities[role];
    return id ? this.states.get(id) : undefined;
  }

  /** Hodnota role jako text; null když chybí. Stará data označí. */
  #value(role, decimals) {
    const entity = this.#entity(role);
    const n = numericState(entity);
    const node = this.el[role];
    if (n === null) {
      node?.classList.add('missing');
      return '—';
    }
    node?.classList.remove('missing');
    const age = Date.now() / 1000 - entity.lastUpdated;
    const stale = age > (this.config.staleMinutes ?? 30) * 60;
    node?.classList.toggle('stale', stale);
    if (node) node.title = stale ? `data ${formatAge(age)}` : '';
    return formatNumber(n, decimals);
  }

  #unit(role, fallback) {
    return this.#entity(role)?.attributes.unit_of_measurement ?? fallback;
  }

  #render() {
    this.#set('temperature', this.#value('temperature', 1));
    this.#set('humidity', this.#value('humidity', 0));

    const pressure = numericState(this.#entity('pressure'));
    const altitude = this.config.pressureAltitudeM;
    if (pressure !== null && altitude) {
      const qnh = seaLevelPressure(pressure, altitude, numericState(this.#entity('temperature')));
      this.#value('pressure', 0); // jen kvůli označení stáří
      this.#set('pressure', formatNumber(qnh, 0));
    } else {
      this.#set('pressure', this.#value('pressure', 0));
    }

    this.#set('illuminance', this.#value('illuminance', 0));
    this.#set('irradiance', this.#value('irradiance', 0));
    this.#set('uv', this.#value('uv', 0));

    this.#set('windSpeed', this.#value('windSpeed', 1));
    this.#set('windGust', this.#value('windGust', 1));
    this.#set('windUnit', this.#unit('windSpeed', 'km/h'));
    const dir = numericState(this.#entity('windDirection'));
    this.#set('windDirection', dir === null ? '—' : `${cardinal(dir)} ${formatNumber(dir, 0)}°`);
    const arrow = this.el.windArrow;
    if (arrow && dir !== null) {
      // šipka ukazuje, KAM vítr vane (meteorologický směr je odkud)
      const transform = `rotate(${Math.round(dir + 180)}deg)`;
      if (arrow.style.transform !== transform) arrow.style.transform = transform;
    }

    this.#set('rainRate', this.#value('rainRate', 1));
    this.#set('rainToday', this.#value('rainToday', 1));

    const weather = this.#entity('weather');
    this.#set('condition', (weather && conditionText(weather.state)) ?? '');

    const sun = this.#entity('sun');
    if (sun) {
      const up = sun.state === 'above_horizon';
      const next = new Date(up ? sun.attributes.next_setting : sun.attributes.next_rising);
      this.#set('sunEvent', Number.isNaN(next.getTime()) ? '' : `${up ? 'západ' : 'východ'} ${formatTime(next)}`);
    }
  }
}
