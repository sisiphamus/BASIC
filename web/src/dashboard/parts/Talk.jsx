import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { SOURCE_LABEL, clockSec } from '../model.js';

const QUICK = ['Stop. Wait for me before you go on.', 'Looks good, keep going.', 'Show me that again, closer.', 'Call me when you have a minute.'];

export function TalkBox({ session, feed }) {
  const first = session.worker.split(' ')[0];
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: false, error: '', sentAt: 0, offline: false });
  if (session.status !== 'active') return null;

  const send = async (t) => {
    const msg = t.trim();
    if (!msg || state.busy) return;
    setState({ busy: true, error: '', sentAt: 0, offline: false });
    try {
      await api.message(session.id, msg);
      // Only clear the box if it still holds what we sent; they may have typed more meanwhile.
      setText((cur) => (cur.trim() === msg ? '' : cur));
      setState({ busy: false, error: '', sentAt: Date.now(), offline: feed?.kind === 'offline' });
    } catch (e) {
      setState({ busy: false, error: e.message, sentAt: 0, offline: false });
    }
  };

  return (
    <section aria-labelledby="talk">
      <h2 id="talk" className="font-display text-2xl font-semibold">
        Talk to {first}
      </h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="talk-input" className="sr-only">
          Message for {first}
        </label>
        <input
          id="talk-input"
          className="field"
          value={text}
          maxLength={400}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message for ${first}`}
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || state.busy} aria-busy={state.busy}>
          {state.busy && <span className="spin" aria-hidden />}
          Say it
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} type="button" className="btn btn-sm font-medium" disabled={state.busy} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-5 text-sm" role="status" aria-live="polite">
        {state.error ? (
          <span className="text-fail">{state.error}</span>
        ) : state.offline ? (
          <span className="font-semibold">Glasses are offline. {first} hears this only if they reconnect in the next 2 minutes.</span>
        ) : state.sentAt ? (
          <span className="text-ink-2">Sent {clockSec(state.sentAt)}</span>
        ) : null}
      </p>
    </section>
  );
}

const SHOW = 200;

/** Everything the glasses said, newest step first, each step's lines under its own heading. */
export function Transcript({ events, onSeekTs, worker }) {
  const { groups, hidden } = useMemo(() => {
    const says = [];
    const enters = [];
    for (const e of events) {
      if (e.type === 'say') says.push(e);
      else if (e.type === 'step.enter') enters.push(e);
    }
    const shown = says.slice(-SHOW);
    const groups = [];
    let g = { head: null, lines: [] };
    let k = 0;
    for (const line of shown) {
      while (k < enters.length && enters[k].seq < line.seq) {
        if (g.lines.length || g.head) groups.push(g);
        g = { head: enters[k++], lines: [] };
      }
      g.lines.push(line);
    }
    if (g.lines.length || g.head) groups.push(g);
    while (k < enters.length) groups.push({ head: enters[k++], lines: [] });
    for (const x of groups) x.lines.reverse();
    return { groups: groups.reverse(), hidden: says.length - shown.length };
  }, [events]);

  return (
    <section aria-labelledby="transcript">
      <h2 id="transcript" className="font-display text-2xl font-semibold">
        What {worker.split(' ')[0]} heard
      </h2>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Nothing said yet.</p>
      ) : (
        <ol className="mt-3 max-h-[28rem] overflow-y-auto rounded-md border border-line bg-panel">
          {groups.map((g) => (
            <li key={g.head?.seq ?? 'start'}>
              {g.head && <h3 className="sticky top-0 border-b border-line bg-canvas px-3 py-1.5 text-sm font-semibold">{g.head.title}</h3>}
              <ol>
                {g.lines.map((l) => (
                  <li key={l.seq} className="border-b border-line">
                    <button
                      type="button"
                      onClick={() => onSeekTs(l.ts)}
                      className={`grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-left hover:bg-canvas ${l.source === 'supervisor' ? 'bg-hivis/25' : ''}`}
                    >
                      <span className="text-xs leading-5 text-ink-3 tabular-nums">{clockSec(l.ts)}</span>
                      <span className="text-sm [overflow-wrap:anywhere]">
                        <span className="font-semibold">{SOURCE_LABEL[l.source] || l.source}</span> <span className="text-ink-2">{l.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </li>
          ))}
          {hidden > 0 && <li className="px-3 py-2 text-sm text-ink-3">{hidden} older lines not shown</li>}
        </ol>
      )}
    </section>
  );
}
