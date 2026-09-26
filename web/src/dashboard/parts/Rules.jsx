import { useState } from 'react';
import { api } from '../api.js';
import { ActionButton } from './ui.jsx';

export default function Rules({ session, onChange }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeError, setRemoveError] = useState('');
  const active = session.status === 'active';

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const rule = await api.addRule(session.id, text);
      onChange({ ...session, rules: [...session.rules.filter((r) => r.id !== rule.id), rule] });
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="rules">
      <h2 id="rules" className="font-display text-2xl font-semibold">
        Watching for
      </h2>
      {session.rules.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">No watch rules on this job.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {session.rules.map((r) => (
            <li key={r.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="[overflow-wrap:anywhere] first-letter:uppercase">{r.when}</p>
                <p className="mt-0.5 text-ink-2 [overflow-wrap:anywhere]">{r.say ? <>Glasses say “{r.say}”</> : 'Glasses pick the words'}</p>
              </div>
              {active && (
                <ActionButton
                  className="btn btn-sm btn-danger"
                  aria-label={`Remove rule: ${r.when}`}
                  onClick={async () => {
                    setRemoveError('');
                    try {
                      await api.removeRule(session.id, r.id);
                      onChange({ ...session, rules: session.rules.filter((x) => x.id !== r.id) });
                    } catch (err) {
                      setRemoveError(err.message);
                    }
                  }}
                >
                  Remove
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p className="mt-1 text-sm text-fail" role="alert">
          {removeError}
        </p>
      )}
      {active && (
        <form className="mt-3" onSubmit={add}>
          <label htmlFor="rule-input" className="text-sm font-semibold">
            Add a watch rule
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="rule-input"
              className="field"
              value={text}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              placeholder="When you see a ladder against the wall, say check your footing"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'rule-help' : undefined}
            />
            <button type="submit" className="btn" disabled={!text.trim() || busy} aria-busy={busy}>
              {busy && <span className="spin" aria-hidden />}
              Add
            </button>
          </div>
          {error && (
            <p id="rule-help" className="mt-1.5 text-sm text-fail" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
