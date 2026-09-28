// Detail terasy: baterie Anenji, volba režimu a automatizace přepínání.

import { formatNumber, formatPower, numericState, powerW } from './format.js';

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

export class Terrace {
  constructor(openers, panel, config, client) {
    Object.assign(this, { panel, config, client });
    this.e = config.entities;
    this.states = new Map();
    this.busy = false;
    this.q = (selector) => panel.querySelector(selector);

    for (const opener of openers.filter(Boolean)) {
      opener.addEventListener('click', () => this.open());
      opener.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.open();
      });
    }

    this.q('[data-action=close]').addEventListener('click', () => this.close());
    this.q('[data-action=automation-on]').addEventListener('click', () =>
      this.#call('Zapínám automatiku…', 'automation', 'turn_on', {
        entity_id: this.e.terraceAutomation,
      }));
    this.q('[data-action=automation-off]').addEventListener('click', () =>
      this.#call('Vypínám automatiku…', 'automation', 'turn_off', {
        entity_id: this.e.terraceAutomation,
      }));
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  open() {
    this.panel.hidden = false;
    this.#render();
  }

  close() {
    this.panel.hidden = true;
  }

  update(states, changed) {
    this.states = states;
    if (!this.isOpen) return;
    if ([this.e.terraceBattery, this.e.pvTerrace, this.e.terraceOutputPriority, this.e.terraceAutomation]
      .some((entityId) => entityId && changed.has(entityId))) this.#render();
  }

  #get(role) {
    return this.states.get(this.e[role]);
  }

  #render() {
    const soc = numericState(this.#get('terraceBattery'));
    setText(this.q('[data-terrace=battery]'), soc === null ? '—' : formatNumber(soc, 0));
    setText(this.q('[data-terrace=production]'), formatPower(powerW(this.#get('pvTerrace'))));
    this.#renderModes();
    this.#renderAutomation();
  }

  #renderModes() {
    const box = this.q('[data-terrace=modes]');
    const entity = this.#get('terraceOutputPriority');
    const options = entity?.attributes.options ?? [];
    const key = JSON.stringify([this.e.terraceOutputPriority, options, entity?.state, this.busy]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;

    if (!this.e.terraceOutputPriority) {
      box.textContent = 'entita není v konfiguraci';
      return;
    }
    if (!entity) {
      box.textContent = 'entita nenalezena';
      return;
    }
    if (!options.length) {
      box.textContent = 'bez voleb';
      return;
    }

    box.replaceChildren(...options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option;
      const selected = option === entity.state;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = this.busy || selected;
      button.addEventListener('click', () => this.#call(`Nastavuji ${option}…`, 'select', 'select_option', {
        entity_id: this.e.terraceOutputPriority,
        option,
      }));
      return button;
    }));
  }

  #renderAutomation() {
    const entity = this.#get('terraceAutomation');
    const state = entity?.state?.toLowerCase();
    const status = this.q('[data-terrace=automation-status]');
    if (!this.e.terraceAutomation) setText(status, 'entita není v konfiguraci');
    else if (!entity) setText(status, 'entita nenalezena');
    else if (state === 'on') setText(status, 'Automatika je zapnutá');
    else if (state === 'off') setText(status, 'Automatika je vypnutá');
    else setText(status, 'Stav není dostupný');

    const unavailable = !entity || UNAVAILABLE.has(state);
    const enable = this.q('[data-action=automation-on]');
    const disable = this.q('[data-action=automation-off]');
    const enableDisabled = this.busy || unavailable || state === 'on';
    const disableDisabled = this.busy || unavailable || state === 'off';
    if (enable.disabled !== enableDisabled) enable.disabled = enableDisabled;
    if (disable.disabled !== disableDisabled) disable.disabled = disableDisabled;
  }

  async #call(pendingText, domain, service, data) {
    if (this.busy) return;
    this.busy = true;
    const note = this.q('[data-terrace=note]');
    note.textContent = pendingText;
    note.className = 'note';
    this.#renderModes();
    this.#renderAutomation();
    try {
      await this.client.callService(domain, service, data);
      note.textContent = 'Hotovo';
      note.className = 'note ok';
    } catch (error) {
      note.textContent = `Chyba: ${error.message}`;
      note.className = 'note error';
      console.warn('Terasa:', error.message);
    } finally {
      this.busy = false;
      this.#renderModes();
      this.#renderAutomation();
    }
  }
}
