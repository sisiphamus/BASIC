import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useLive } from './live.jsx';

/**
 * One crew in full: session state, every event, and the frame list. Kept current from the
 * shared socket; after a reconnect it fetches whatever was missed.
 */
export function useSession(id) {
  const [{ sessions }, live] = useLive();
  const [events, setEvents] = useState([]);
  const [frames, setFrames] = useState([]);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const lastSeq = useRef(0);

  const addEvents = useCallback((list) => {
    if (!list.length) return;
    setEvents((cur) => {
      const seen = new Set(cur.map((e) => e.seq));
      const fresh = list.filter((e) => !seen.has(e.seq));
      if (!fresh.length) return cur;
      const next = cur.concat(fresh).sort((a, b) => a.seq - b.seq);
      lastSeq.current = next[next.length - 1].seq;
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, ev, fr] = await Promise.all([api.session(id), api.events(id, lastSeq.current), api.frames(id)]);
      live.upsert(s);
      addEvents(ev.events);
      setFrames(fr.frames);
      setError(null);
      setReady(true);
    } catch (e) {
      setError(e);
      setReady(true);
    }
  }, [id, live, addEvents]);

  useEffect(() => {
    lastSeq.current = 0;
    setEvents([]);
    setFrames([]);
    setReady(false);
    load();
  }, [load]);

  useEffect(
    () =>
      live.listen((msg) => {
        if (msg.type === 'reconnected') load();
        else if (msg.sessionId !== id) return;
        else if (msg.type === 'event') addEvents([msg.event]);
        else if (msg.type === 'frame') setFrames((f) => (f.includes(msg.frameId) ? f : [...f, msg.frameId]));
      }),
    [live, id, load, addEvents],
  );

  return { session: sessions[id] || null, events, frames, error, ready, reload: load, setSession: live.upsert };
}
