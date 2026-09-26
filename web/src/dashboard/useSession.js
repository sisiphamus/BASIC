import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useLiveApi, useLiveSlice } from './live.jsx';

// Events a long job piles up: a frame and a model reading every couple of seconds. Those go
// into lookup maps; the list components render from holds only what people act on.
const KEEP = 2000;

function fresh() {
  return { events: [], frames: [], frameSet: new Set(), frameTs: new Map(), analysisBy: new Map(), lastSeq: 0, lastNotable: 0 };
}

/**
 * One crew in full: session state, events, and the frame list. Kept current from the shared
 * socket; after a reconnect it fetches whatever was missed.
 */
export function useSession(id) {
  const live = useLiveApi();
  const session = useLiveSlice('sessions', id);
  const store = useRef(fresh());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  // live: true for frames pushed over the socket. Frame events from a fetch only give times;
  // the frame list itself comes from /frames, which leaves out pictures the server pruned.
  const ingest = useCallback((list, live = false) => {
    const d = store.current;
    const add = [];
    const late = [];
    let framesChanged = false;
    for (const e of list) {
      if (e.seq > d.lastSeq) d.lastSeq = e.seq;
      if (e.type === 'frame') {
        d.frameTs.set(e.frameId, e.ts);
        if (live && !d.frameSet.has(e.frameId)) {
          d.frameSet.add(e.frameId);
          d.frames.push(e.frameId);
          framesChanged = true;
        }
      } else if (e.type === 'analysis') d.analysisBy.set(e.frameId, e);
      else if (e.seq > d.lastNotable) {
        add.push(e);
        d.lastNotable = e.seq;
      } else late.push(e);
    }
    if (framesChanged) d.frames = d.frames.slice(); // new identity so memos see it
    if (late.length) {
      const seen = new Set(d.events.map((e) => e.seq));
      d.events = d.events.concat(add, late.filter((e) => !seen.has(e.seq))).sort((a, b) => a.seq - b.seq).slice(-KEEP);
    } else if (add.length) {
      d.events = d.events.length + add.length > KEEP ? d.events.concat(add).slice(-KEEP) : d.events.concat(add);
    }
    setVersion((v) => v + 1);
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, ev, fr] = await Promise.all([api.session(id), api.events(id, store.current.lastSeq), api.frames(id)]);
      live.upsert(s);
      const d = store.current;
      // Frames that arrived on the socket while /frames was in flight are newer than its last one.
      const lastListed = fr.frames[fr.frames.length - 1] || '';
      d.frames = fr.frames.concat(d.frames.filter((f) => f > lastListed));
      d.frameSet = new Set(d.frames);
      ingest(ev.events);
      setError(null);
    } catch (e) {
      setError(e);
    }
    setReady(true);
  }, [id, live, ingest]);

  useEffect(() => {
    store.current = fresh();
    setReady(false);
    load();
  }, [load]);

  useEffect(
    () =>
      live.listen((msg) => {
        if (msg.type === 'reconnected') load();
        else if (msg.sessionId !== id) return;
        else if (msg.type === 'event') ingest([msg.event]);
        else if (msg.type === 'frame') ingest([{ seq: msg.seq ?? 0, type: 'frame', frameId: msg.frameId, ts: msg.ts }], true);
      }),
    [live, id, load, ingest],
  );

  const d = store.current;
  return {
    session: session || null,
    events: d.events,
    frames: d.frames,
    frameTs: d.frameTs,
    analysisBy: d.analysisBy,
    version,
    error,
    ready,
    reload: load,
    setSession: live.upsert,
  };
}
