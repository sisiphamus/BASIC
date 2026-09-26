import { useCallback, useEffect, useRef, useState } from 'react';
import { frameUrl } from '../api.js';

/** Load data once (and again when deps change). Returns { data, error, loading, reload, setData }. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    run().then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error) => n === seq.current && setState((s) => ({ ...s, error, loading: false })),
    );
  }, [run]);
  useEffect(reload, [reload]);
  const setData = useCallback((f) => setState((s) => ({ ...s, data: typeof f === 'function' ? f(s.data) : f })), []);
  return { ...state, reload, setData };
}

export function segClass(st) {
  if (st.status === 'pass') return 'seg-pass';
  if (st.status === 'skipped') return 'seg-skipped';
  if (st.status === 'active') return st.fails ? 'seg-fail' : 'seg-active';
  return 'seg-pending';
}

/** One segment per step. Labels are optional so the floor can stay dense. */
export function StepTrack({ steps, labels = false, height = 'h-2' }) {
  return (
    <ol className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((st, i) => (
        <li key={st.id} className="min-w-0" title={`${i + 1}. ${st.title}`}>
          <div className={`${height} rounded-[2px] ${segClass(st)}`} />
          {labels && (
            <div className={`mt-1.5 truncate text-xs ${st.status === 'active' ? 'font-semibold text-ink' : 'text-ink-3'}`}>{st.title}</div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * A camera frame on a dark stage. Keeps showing the previous picture until the next one has
 * loaded, so a live feed never flashes to black between frames.
 */
export function Frame({ sessionId, frameId, alt, className = '', fit = 'cover', children, onMissing }) {
  const src = frameId ? frameUrl(sessionId, frameId) : null;
  const [shown, setShown] = useState(src);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!src) return;
    let dead = false;
    const img = new Image();
    img.onload = () => {
      if (dead) return;
      setShown(src);
      setMissing(false);
    };
    img.onerror = () => {
      if (dead) return;
      setMissing(true);
      onMissing?.();
    };
    img.src = src;
    return () => {
      dead = true;
    };
  }, [src, onMissing]);
  return (
    <div className={`relative overflow-hidden bg-stage ${className}`}>
      {shown && !missing ? (
        <img src={shown} alt={alt} className={`frame-img h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`} draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm text-white/60">{missing ? 'Picture not kept' : 'No picture yet'}</div>
      )}
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-3 py-16 text-ink-2" role="status">
      <span className="spin" aria-hidden />
      {label}
    </div>
  );
}

export function Problem({ error, onRetry, title = 'Could not load this' }) {
  return (
    <div className="my-10 max-w-xl rounded-md border border-fail/40 bg-fail-soft p-5" role="alert">
      <p className="font-semibold text-fail">{title}</p>
      <p className="mt-1 text-ink-2">{String(error?.message || error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Signal({ item, size = 'md' }) {
  const fail = item.kind === 'fail';
  return (
    <div className={`overflow-hidden rounded-[4px] border ${fail ? 'border-fail' : 'border-ink'}`}>
      <div
        className={`${fail ? 'tag-fail' : 'tag-signal'} font-display font-bold uppercase leading-none tracking-[0.04em] ${size === 'lg' ? 'px-3 py-2 text-lg' : 'px-2.5 py-1.5 text-[0.9375rem]'}`}
      >
        {item.signal}
      </div>
      <p className={`bg-panel text-ink ${size === 'lg' ? 'px-3 py-2.5 text-[0.9375rem]' : 'line-clamp-2 px-2.5 py-2 text-sm'}`}>{item.detail}</p>
    </div>
  );
}

/** Button that disables itself and shows a spinner while its promise runs. */
export function ActionButton({ onClick, children, className = 'btn', busyLabel, ...rest }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  return (
    <button
      type="button"
      {...rest}
      className={`${className} ${busy ? 'btn-busy' : ''}`}
      disabled={busy || rest.disabled}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          if (mounted.current) setBusy(false);
        }
      }}
    >
      {busy && <span className="spin" aria-hidden />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
