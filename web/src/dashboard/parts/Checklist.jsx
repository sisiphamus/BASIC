import { useState } from 'react';
import { api } from '../api.js';
import { clock, plural, resultLabel } from '../model.js';
import { ActionButton } from './ui.jsx';

const STATUS_STYLE = {
  pass: 'bg-pass text-white',
  skipped: 'border border-ink-3 text-ink-2',
  active: 'bg-ink text-white',
  pending: 'border border-line-2 text-ink-3',
};

function EditCheck({ session, step, onSaved }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(step.check || '');
  const [error, setError] = useState('');
  if (!open) {
    return (
      <div className="mt-3 rounded-[4px] bg-canvas p-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold">What the camera checks</p>
          <button type="button" className="link shrink-0 text-sm" onClick={() => (setText(step.check || ''), setError(''), setOpen(true))}>
            Edit
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-2">{step.check}</p>
      </div>
    );
  }
  return (
    <form
      className="mt-3 rounded-[4px] bg-canvas p-3"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <label htmlFor={`check-${step.id}`} className="text-sm font-semibold">
        What the camera checks
      </label>
      <textarea
        id={`check-${step.id}`}
        className="field mt-2 min-h-24 resize-y text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `check-err-${step.id}` : undefined}
        autoFocus
      />
      <p className="mt-1 text-xs text-ink-3">This job only, from the next picture on.</p>
      {error && (
        <p id={`check-err-${step.id}`} className="mt-2 text-sm text-fail" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <ActionButton
          className="btn btn-sm btn-primary"
          disabled={!text.trim() || text.trim() === step.check}
          onClick={async () => {
            try {
              const s = await api.editStep(session.id, step.id, { check: text });
              onSaved(s);
              setOpen(false);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Save check
        </ActionButton>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Controls({ session, onDone }) {
  const [error, setError] = useState('');
  const run = (cmd) => async () => {
    setError('');
    try {
      onDone(await api.command(session.id, cmd));
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <ActionButton className="btn btn-sm btn-primary" onClick={run('approve')}>
          Approve step
        </ActionButton>
        <ActionButton className="btn btn-sm" onClick={run('next')}>
          Skip
        </ActionButton>
        <ActionButton className="btn btn-sm" onClick={run('back')} disabled={session.current === 0}>
          Back a step
        </ActionButton>
        <ActionButton className="btn btn-sm" onClick={run('repeat')}>
          Repeat instruction
        </ActionButton>
      </div>
      {error && (
        <p className="mt-2 text-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function Checklist({ session, onSeekFrame, onSession }) {
  const active = session.status === 'active';
  return (
    <ol className="divide-y divide-line">
      {session.steps.map((st, i) => {
        const current = active && i === session.current;
        const canJump = Boolean(st.frameId);
        return (
          <li key={st.id} className="py-4">
            <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
              <span
                className={`flex size-8 items-center justify-center rounded-[4px] font-display text-lg font-bold ${st.status === 'active' && st.fails ? 'bg-fail text-white' : STATUS_STYLE[st.status]}`}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  {canJump ? (
                    <button type="button" className="text-left font-display text-xl font-semibold leading-tight hover:underline" onClick={() => onSeekFrame(st.frameId)}>
                      {st.title}
                    </button>
                  ) : (
                    <h3 className={`font-display text-xl font-semibold leading-tight ${st.status === 'pending' ? 'text-ink-2' : ''}`}>{st.title}</h3>
                  )}
                  <span className={`text-sm ${st.status === 'pass' ? 'text-pass' : st.fails && st.status === 'active' ? 'text-fail' : 'text-ink-2'}`}>
                    {resultLabel(st)}
                    {st.finishedAt ? ` · ${clock(st.finishedAt)}` : ''}
                  </span>
                </div>
                {st.evidence && (
                  <p className="mt-1 text-sm text-ink-2">
                    {st.status === 'active' ? 'Last miss: ' : 'Saw: '}
                    {st.evidence}
                    {canJump && (
                      <>
                        {' '}
                        <button type="button" className="link text-ink" onClick={() => onSeekFrame(st.frameId)}>
                          Show picture
                        </button>
                      </>
                    )}
                  </p>
                )}
                {st.status === 'pass' && st.fails > 0 && <p className="mt-1 text-sm text-ink-3">{plural(st.fails, 'miss', 'misses')} before passing</p>}
                {current && (
                  <>
                    <EditCheck key={st.check} session={session} step={st} onSaved={onSession} />
                    <Controls session={session} onDone={onSession} />
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
