// One WebSocket for the whole dashboard. Holds every crew's latest state plus a short
// tail of recent events per crew (enough to decide who needs the supervisor).
// Reconnects with backoff and re-fetches on every reconnect so nothing is missed.

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';

const TAIL = 80;
// The floor only needs events that change what a crew needs; frames and model readings are
// hundreds per job and would push those out of the tail.
const NOISY = new Set(['frame', 'analysis']);
const PING_MS = 15000;
const PONG_GRACE_MS = 8000;

function createLive() {
  let state = {
    sessions: {},
    recent: {},
    frameAt: {},
    conn: { state: 'connecting', retryAt: null, since: null },
    loaded: false,
    health: null,
    acks: {},
  };
  const subs = new Set();
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };

  let ws = null;
  let attempt = 0;
  let timer = null;
  let pingTimer = null;
  let pongTimer = null;
  let stopped = false;

  function mergeEvents(id, events) {
    const cur = state.recent[id] || [];
    let frameAt = state.frameAt[id];
    for (const e of events) if (e.type === 'frame' && (!frameAt || e.ts > frameAt)) frameAt = e.ts;
    const notable = events.filter((e) => !NOISY.has(e.type));
    let next = cur;
    if (notable.length) {
      const last = cur.length ? cur[cur.length - 1].seq : -1;
      if (notable.every((e) => e.seq > last)) next = cur.concat(notable).slice(-TAIL);
      else {
        const seen = new Set(cur.map((e) => e.seq));
        next = cur.concat(notable.filter((e) => !seen.has(e.seq))).sort((a, b) => a.seq - b.seq).slice(-TAIL);
      }
    }
    if (next === cur && frameAt === state.frameAt[id]) return;
    set({ recent: next === cur ? state.recent : { ...state.recent, [id]: next }, frameAt: frameAt ? { ...state.frameAt, [id]: frameAt } : state.frameAt });
  }

  async function backfill(sessions) {
    // Recent events for crews still working, so the floor can show fails and rule hits from before we connected.
    const active = sessions.filter((s) => s.status === 'active' || Date.now() - s.updatedAt < 30 * 60e3);
    await Promise.all(
      active.map(async (s) => {
        try {
          const { events } = await api.events(s.id, 0, TAIL * 4);
          mergeEvents(s.id, events);
          if (s.lastFrameAt) set({ frameAt: { ...state.frameAt, [s.id]: Math.max(state.frameAt[s.id] || 0, s.lastFrameAt) } });
        } catch {
          /* the next reconnect tries again */
        }
      }),
    );
  }

  function onMessage(msg) {
    if (msg.type === 'pong') {
      clearTimeout(pongTimer);
      return;
    }
    if (msg.type === 'snapshot') {
      const sessions = {};
      for (const s of msg.sessions) sessions[s.id] = s;
      set({ sessions, loaded: true });
      backfill(msg.sessions);
    } else if (msg.type === 'session') {
      set({ sessions: { ...state.sessions, [msg.session.id]: msg.session } });
    } else if (msg.type === 'event') {
      mergeEvents(msg.sessionId, [msg.event]);
    } else if (msg.type === 'frame') {
      const s = state.sessions[msg.sessionId];
      set({
        sessions: s ? { ...state.sessions, [s.id]: { ...s, lastFrameId: msg.frameId, lastFrameAt: msg.ts, frames: s.frames + 1 } } : state.sessions,
        frameAt: { ...state.frameAt, [msg.sessionId]: msg.ts },
      });
    }
    listeners.forEach((f) => f(msg));
  }

  function connect() {
    if (stopped) return;
    clearTimeout(timer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws?role=dashboard`);
    ws = sock;
    set({ conn: { ...state.conn, state: attempt ? 'reconnecting' : 'connecting', retryAt: null } });
    sock.onopen = () => {
      attempt = 0;
      set({ conn: { state: 'live', retryAt: null, since: Date.now() } });
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (sock.readyState !== 1) return;
        sock.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => sock.close(), PONG_GRACE_MS);
      }, PING_MS);
      listeners.forEach((f) => f({ type: 'reconnected' }));
    };
    sock.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore a bad frame, keep the socket */
      }
    };
    sock.onclose = () => {
      clearInterval(pingTimer);
      clearTimeout(pongTimer);
      if (ws !== sock || stopped) return;
      attempt += 1;
      const wait = Math.min(15000, 800 * 2 ** (attempt - 1)) + Math.random() * 400;
      set({ conn: { state: 'offline', retryAt: Date.now() + wait, since: state.conn.since } });
      timer = setTimeout(connect, wait);
    };
  }

  return {
    get: () => state,
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    listen(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    start() {
      stopped = false;
      connect();
      api.health().then((health) => set({ health }), () => {});
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(pingTimer);
      ws?.close();
    },
    retryNow() {
      attempt = Math.max(attempt, 1);
      connect();
    },
    upsert(session) {
      set({ sessions: { ...state.sessions, [session.id]: session } });
    },
    /** Supervisor has seen this crew's warnings; hide the ones raised before now. */
    ack(id) {
      set({ acks: { ...state.acks, [id]: Date.now() } });
    },
  };
}

const LiveContext = createContext(null);

export function LiveProvider({ children }) {
  const [live] = useState(createLive);
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, [live]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const live = useContext(LiveContext);
  const state = useSyncExternalStore(live.subscribe, live.get);
  return [state, live];
}

/**
 * One crew's slice of the live store, e.g. useLiveSlice('sessions', id). The component only
 * re-renders when that slice changes, not on every other crew's traffic.
 */
export function useLiveSlice(key, id) {
  const live = useContext(LiveContext);
  const get = useCallback(() => live.get()[key][id], [live, key, id]);
  return useSyncExternalStore(live.subscribe, get);
}

export function useLiveApi() {
  return useContext(LiveContext);
}

/** Re-render every `ms` so "12s ago" labels stay honest. */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
