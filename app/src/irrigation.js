// Zavlažování (IrriSense): štítek s průběhem ve scéně a detail s mapkou a ovládáním.
// Detail se otevře klepnutím na zavlažovač nebo jeho štítek, po minutě nečinnosti se zavře.

import { formatNumber, numericState } from './format.js';

const AUTO_CLOSE_MS = 60_000;
const NOT_RUNNING = new Set(['unavailable', 'unknown', 'idle', 'off', 'none', '']);

/** Běží zalévání? Průběh je číslo (%), když neběží, bývá text nebo nedostupný. */
export function irrigationRunning(progressEntity) {
  const p = numericState(progressEntity);
  return p !== null && p < 100;
}

export class Irrigation {
  /**
   * @param {HTMLElement} tag  štítek ve scéně
   * @param {HTMLElement} panel  detail
   * @param {object} config  konfigurace appky (ha.url, entities.irrigation*)
   * @param {import('./ha.js').HAClient} client
   */
  constructor(tag, panel, config, client) {
    Object.assign(this, { tag, panel, config, client });
    this.e = config.entities;
    this.states = new Map();
    this.q = (sel) => panel.querySelector(sel);

    tag.addEventListener('click', () => this.open());
    this.q('[data-action=close]').addEventListener('click', () => this.close());
    this.q('[data-action=start]').addEventListener('click', () =>
      this.#call('Spouštím…', 'button', 'press', { entity_id: this.e.irrigationStart }));
    this.q('[data-action=stop]').addEventListener('click', () =>
      this.#call('Zastavuji…', 'button', 'press', { entity_id: this.e.irrigationStop }));
    panel.addEventListener('pointerdown', () => this.#armAutoClose());
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  open() {
    this.panel.hidden = false;
    this.#render();
    this.#armAutoClose();
  }

  close() {
    this.panel.hidden = true;
    clearTimeout(this.closeTimer);
  }

  #armAutoClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), AUTO_CLOSE_MS);
  }

  update(states) {
    this.states = states;
    this.#renderTag();
    if (this.isOpen) this.#render();
  }

  #get(role) {
    return this.states.get(this.e[role]);
  }

  #statusText() {
    const progress = this.#get('irrigationProgress');
    if (irrigationRunning(progress)) return `běží ${formatNumber(numericState(progress), 0)} %`;
    if (!progress || progress.state === 'unavailable') return 'nedostupné';
    return 'neběží';
  }

  #renderTag() {
    const text = this.#statusText();
    const status = this.tag.querySelector('[data-irrigation=status]');
    if (status.textContent !== text) status.textContent = text;
    const p = numericState(this.#get('irrigationProgress'));
    const width = `${irrigationRunning(this.#get('irrigationProgress')) ? p : 0}%`;
    const bar = this.tag.querySelector('[data-irrigation=bar]');
    if (bar.style.width !== width) bar.style.width = width;
    this.tag.classList.toggle('running', irrigationRunning(this.#get('irrigationProgress')));
  }

  #render() {
    this.q('[data-irrigation=status]').textContent = this.#statusText();
    const zone = this.#get('irrigationActiveZone');
    const zoneText = zone && !NOT_RUNNING.has(zone.state.toLowerCase()) ? zone.state : '—';
    this.q('[data-irrigation=active]').textContent = zoneText;

    const p = numericState(this.#get('irrigationProgress'));
    this.q('[data-irrigation=progress]').style.width =
      `${irrigationRunning(this.#get('irrigationProgress')) ? p : 0}%`;

    this.#renderMap();
    this.#renderChoices('[data-irrigation=zones]', 'irrigationZoneSelect');
    this.#renderChoices('[data-irrigation=doses]', 'irrigationDoseSelect');
  }

  #renderMap() {
    const img = this.q('[data-irrigation=map]');
    const picture = this.#get('irrigationZoneMap')?.attributes.entity_picture;
    // entity_picture = /api/image_proxy/…?token=… (token rotuje, proto se src obnovuje)
    const src = picture ? this.config.ha.url.replace(/\/+$/, '') + picture : '';
    if (src && img.getAttribute('src') !== src) img.src = src;
    img.hidden = !src;
    this.q('[data-irrigation=map-missing]').hidden = Boolean(src);
  }

  /** Volby selectu jako velká tlačítka; aktuální volba zvýrazněná. */
  #renderChoices(selector, role) {
    const box = this.q(selector);
    const entity = this.#get(role);
    const options = entity?.attributes.options ?? [];
    const key = JSON.stringify([options, entity?.state]);
    if (box.dataset.key === key) return; // beze změny, DOM nesahat
    box.dataset.key = key;
    box.replaceChildren(...options.map((option) => {
      const button = document.createElement('button');
      // „stromky (Point)“ -> název + menší typ
      const [, name, kind] = option.match(/^(.*?)\s*\(([^)]*)\)\s*$/) ?? [null, option, null];
      button.append(name);
      if (kind) {
        const small = document.createElement('small');
        small.textContent = kind;
        button.append(small);
      }
      button.classList.toggle('selected', option === entity.state);
      button.addEventListener('click', () => this.#call(`Nastavuji ${option}…`, 'select', 'select_option', {
        entity_id: this.e[role], option,
      }));
      return button;
    }));
    if (!options.length) box.textContent = entity ? 'bez voleb' : 'entita nenalezena';
  }

  async #call(pendingText, domain, service, data) {
    const note = this.q('[data-irrigation=note]');
    note.textContent = pendingText;
    note.className = 'note';
    try {
      await this.client.callService(domain, service, data);
      note.textContent = 'Hotovo';
      note.className = 'note ok';
    } catch (e) {
      note.textContent = `Chyba: ${e.message}`;
      note.className = 'note error';
      console.warn('Zavlažování:', e.message);
    }
  }
}
