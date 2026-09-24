// Minimální klient Home Assistant WebSocket API.
// Odebírá jen zadané entity (subscribe_entities s entity_ids = filtr na straně HA),
// dekóduje komprimovaný formát stavů, sám se znovu připojuje a hlídá mrtvé spojení.

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function wsUrl(httpUrl) {
  return httpUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket';
}

/**
 * @typedef {{ state: string, attributes: Record<string, any>, lastChanged: number, lastUpdated: number }} EntityState
 * Časy jsou epoch sekundy (jak je posílá HA).
 */

export class HAClient {
  /**
   * @param {object} opts
   * @param {string} opts.url  http(s)://host:8123
   * @param {string} opts.token  long-lived access token
   * @param {string[]} opts.entityIds  entity, které se mají odebírat
   * @param {(changed: Set<string>, states: Map<string, EntityState>) => void} opts.onStates
   * @param {(status: 'connecting'|'connected'|'disconnected'|'auth_invalid', detail?: string) => void} opts.onStatus
   */
  constructor({ url, token, entityIds, onStates, onStatus }) {
    Object.assign(this, { url, token, entityIds, onStates, onStatus });
    /** @type {Map<string, EntityState>} */
    this.states = new Map();
    this.nextId = 1;
    this.retryMs = RECONNECT_MIN_MS;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  #connect() {
    this.onStatus('connecting');
    const ws = new WebSocket(wsUrl(this.url));
    this.ws = ws;
    ws.onmessage = (e) => this.#onMessage(JSON.parse(e.data));
    ws.onclose = () => this.#onClose(ws);
    ws.onerror = () => {}; // následuje onclose
  }

  #send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  #onMessage(msg) {
    switch (msg.type) {
      case 'auth_required':
        this.#send({ type: 'auth', access_token: this.token });
        return;
      case 'auth_invalid':
        this.stopped = true; // opakování nepomůže, token je špatně
        this.onStatus('auth_invalid', msg.message);
        this.ws.close();
        return;
      case 'auth_ok':
        this.retryMs = RECONNECT_MIN_MS;
        this.subscriptionId = this.nextId++;
        this.#send({ id: this.subscriptionId, type: 'subscribe_entities', entity_ids: this.entityIds });
        this.#startPing();
        this.onStatus('connected');
        return;
      case 'pong':
        clearTimeout(this.pongTimer);
        return;
      case 'event':
        if (msg.id === this.subscriptionId) this.#applyEvent(msg.event);
        return;
      case 'result':
        if (!msg.success) console.warn('HA chyba', msg.id, msg.error);
    }
  }

  // Formát subscribe_entities: a = přidané (plné), c = změny (diff), r = odebrané
  #applyEvent(ev) {
    const changed = new Set();
    if (ev.a) {
      for (const [id, s] of Object.entries(ev.a)) {
        this.states.set(id, {
          state: s.s,
          attributes: s.a ?? {},
          lastChanged: s.lc,
          lastUpdated: s.lu ?? s.lc,
        });
        changed.add(id);
      }
    }
    if (ev.c) {
      for (const [id, diff] of Object.entries(ev.c)) {
        const cur = this.states.get(id);
        if (!cur) continue;
        const add = diff['+'];
        if (add) {
          if ('s' in add) cur.state = add.s;
          if (add.a) Object.assign(cur.attributes, add.a);
          if (add.lc) cur.lastChanged = cur.lastUpdated = add.lc;
          else if (add.lu) cur.lastUpdated = add.lu;
        }
        for (const key of diff['-']?.a ?? []) delete cur.attributes[key];
        changed.add(id);
      }
    }
    for (const id of ev.r ?? []) {
      this.states.delete(id);
      changed.add(id);
    }
    if (changed.size) this.onStates(changed, this.states);
  }

  #startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.#send({ id: this.nextId++, type: 'ping' });
      clearTimeout(this.pongTimer);
      // Bez odpovědi = mrtvé spojení (např. HA restart bez zavření socketu)
      this.pongTimer = setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  #onClose(ws) {
    if (ws !== this.ws) return;
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    if (this.stopped) return;
    this.onStatus('disconnected', `nové spojení za ${Math.round(this.retryMs / 1000)} s`);
    this.reconnectTimer = setTimeout(() => this.#connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
  }
}
