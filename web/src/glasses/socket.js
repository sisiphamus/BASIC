// WebSocket that keeps coming back. Field Wi-Fi drops; the crew should never have to reload.

export class LiveSocket {
  constructor(url, { onMessage, onState }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onState = onState || (() => {});
    this.ws = null;
    this.tries = 0;
    this.closed = false;
    this.pingTimer = null;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    this.onState(this.tries ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.onState('online');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), 10_000);
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (!this.closed) this.retry();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  retry() {
    this.onState('reconnecting');
    this.tries += 1;
    const delay = Math.min(8000, 400 * 2 ** Math.min(this.tries, 5)) + Math.random() * 300;
    setTimeout(() => this.connect(), delay);
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
