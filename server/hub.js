// Live push to the glasses page and the dashboard over WebSocket.
//   /ws?role=dashboard            gets everything
//   /ws?role=glasses&session=<id> gets only its own session

import { WebSocketServer } from 'ws';

export class Hub {
  constructor() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.clients = new Set();
    this.onClientMessage = null;
    this.snapshot = null; // (sessionId|null) => payload sent on connect
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          /* ignore */
        }
      }
    }, 15_000);
    this.heartbeat.unref?.();
  }

  attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, 'http://x');
      } catch {
        return socket.destroy(); // a junk request must never take the server down
      }
      if (url.pathname !== '/ws') return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, url));
    });
  }

  accept(ws, url) {
    const client = {
      ws,
      alive: true,
      role: url.searchParams.get('role') === 'glasses' ? 'glasses' : 'dashboard',
      sessionId: url.searchParams.get('session') || null,
    };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));
    ws.on('message', (data) => {
      client.alive = true;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'ping') return this.sendTo(client, { type: 'pong', t: msg.t });
      if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
        client.sessionId = msg.sessionId;
        if (this.snapshot) this.sendTo(client, this.snapshot(client.sessionId));
        return;
      }
      this.onClientMessage?.(client, msg);
    });
    this.sendTo(client, { type: 'hello', role: client.role, sessionId: client.sessionId });
    if (this.snapshot) this.sendTo(client, this.snapshot(client.role === 'glasses' ? client.sessionId : null));
  }

  sendTo(client, payload) {
    if (client.ws.readyState !== 1) return;
    try {
      client.ws.send(JSON.stringify(payload));
    } catch {
      /* a dead socket is cleaned up by the heartbeat */
    }
  }

  /** Send to dashboards and to glasses on this session. */
  publish(sessionId, payload) {
    for (const c of this.clients) {
      if (c.role === 'dashboard' || c.sessionId === sessionId) this.sendTo(c, payload);
    }
  }

  counts() {
    let glasses = 0;
    let dashboards = 0;
    for (const c of this.clients) c.role === 'glasses' ? glasses++ : dashboards++;
    return { glasses, dashboards };
  }

  glassesOnline(sessionId) {
    for (const c of this.clients) if (c.role === 'glasses' && c.sessionId === sessionId) return true;
    return false;
  }

  close() {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.ws.terminate();
    this.wss.close();
  }
}
