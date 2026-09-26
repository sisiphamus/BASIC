import { useState } from 'react';
import { api } from '../api.js';
import { SOURCE_LABEL, clockSec } from '../model.js';

const QUICK = ['Stop. Wait for me before you go on.', 'Looks good, keep going.', 'Show me that again, closer.', 'Call me when you have a minute.'];

export function TalkBox({ session }) {
  const first = session.worker.split(' ')[0];
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: false, error: '', sent: '' });
  if (session.status !== 'active') return null;

  const send = async (t) => {
    const msg = t.trim();
    if (!msg || state.busy) return;
    setState({ busy: true, error: '', sent: '' });
    try {
      await api.message(session.id, msg);
      if (t === text) setText('');
      setState({ busy: false, error: '', sent: msg });
    } catch (e) {
      setState({ busy: false, error: e.message, sent: '' });
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
        {state.error ? <span className="text-fail">{state.error}</span> : state.sent ? <span className="text-ink-2">Sent to the glasses.</span> : null}
      </p>
    </section>
  );
}

/** Everything the glasses said, newest first, with where each line came from. */
export function Transcript({ events, onSeekTs, worker }) {
  const lines = [];
  for (const e of events) {
    if (e.type === 'say') lines.push(e);
    else if (e.type === 'step.enter') lines.push({ ...e, divider: true });
  }
  lines.reverse();
  return (
    <section aria-labelledby="transcript">
      <h2 id="transcript" className="font-display text-2xl font-semibold">
        What {worker.split(' ')[0]} heard
      </h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Nothing said yet.</p>
      ) : (
        <ol className="mt-3 max-h-[28rem] overflow-y-auto rounded-md border border-line bg-panel">
          {lines.map((l) =>
            l.divider ? (
              <li key={l.seq} className="sticky top-0 border-b border-line bg-canvas px-3 py-1.5 text-sm font-semibold">
                {l.title}
              </li>
            ) : (
              <li key={l.seq} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSeekTs(l.ts)}
                  className={`grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-left hover:bg-canvas ${l.source === 'supervisor' ? 'bg-hivis/25' : ''}`}
                >
                  <span className="text-xs leading-5 text-ink-3 tabular-nums">{clockSec(l.ts)}</span>
                  <span className="text-sm">
                    <span className="font-semibold">{SOURCE_LABEL[l.source] || l.source}</span> <span className="text-ink-2">{l.text}</span>
                  </span>
                </button>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}
