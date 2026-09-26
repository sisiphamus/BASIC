import { useEffect, useMemo, useRef } from 'react';
import { frameUrl } from '../api.js';

// Footage scrubber: a track with one tick per frame worth of width, markers where something
// happened, and a strip of thumbnails around the current position.

const MARK = {
  'step.pass': { cls: 'bg-pass', label: 'Passed' },
  'step.skipped': { cls: 'bg-ink-3', label: 'Skipped' },
  'step.fail': { cls: 'bg-fail', label: 'Failed' },
  'rule.fired': { cls: 'bg-hivis-deep', label: 'Watch rule' },
  'supervisor.message': { cls: 'bg-ink', label: 'You spoke' },
};

/** Index of the last frame taken at or before ts. */
export function frameIndexAt(frames, frameTs, ts) {
  let best = 0;
  for (let i = 0; i < frames.length; i++) {
    const t = frameTs[frames[i]];
    if (t && t <= ts) best = i;
    else if (t && t > ts) break;
  }
  return best;
}

export function useMarkers(events, frames, frameTs) {
  return useMemo(() => {
    const pos = new Map(frames.map((f, i) => [f, i]));
    const out = [];
    for (const e of events) {
      const m = MARK[e.type];
      if (!m) continue;
      const i = e.frameId && pos.has(e.frameId) ? pos.get(e.frameId) : frameIndexAt(frames, frameTs, e.ts);
      out.push({ i, type: e.type, ...m, text: e.evidence || e.text || e.when || e.title || '', seq: e.seq });
    }
    return out;
  }, [events, frames, frameTs]);
}

export default function Scrubber({ sessionId, frames, index, onSeek, markers, live }) {
  const track = useRef(null);
  const n = frames.length;
  const pct = (i) => (n <= 1 ? 100 : (i / (n - 1)) * 100);
  const byIndex = useMemo(() => {
    const m = new Map();
    for (const k of markers) m.set(k.i, k);
    return m;
  }, [markers]);

  const seekFromPointer = (clientX) => {
    const r = track.current.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - r.left), r.width);
    onSeek(Math.round((x / r.width) * (n - 1)));
  };

  // Arrow keys step through footage anywhere on the page, unless someone is typing.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') onSeek(Math.max(0, index - (e.shiftKey ? 10 : 1)));
      else if (e.key === 'ArrowRight') onSeek(Math.min(n - 1, index + (e.shiftKey ? 10 : 1)));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, n, onSeek]);

  if (!n) return null;
  const from = Math.max(0, Math.min(index - 4, n - 9));
  const strip = frames.slice(from, from + 9);

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Footage position. Arrow keys step one picture, Shift jumps ten."
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={index + 1}
        aria-valuetext={`Frame ${index + 1} of ${n}${live ? ', live' : ''}`}
        className="relative h-9 cursor-pointer touch-none select-none rounded-[4px] border border-line-2 bg-panel"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'Home') onSeek(0);
          else if (e.key === 'End') onSeek(n - 1);
        }}
      >
        <div className="absolute inset-y-0 left-0 rounded-l-[3px] bg-canvas" style={{ width: `${pct(index)}%` }} />
        {markers.map((m) => (
          <span
            key={m.seq}
            className={`absolute top-1.5 bottom-1.5 w-[3px] -translate-x-1/2 rounded-full ${m.cls}`}
            style={{ left: `${pct(m.i)}%` }}
            title={`${m.label}${m.text ? `: ${m.text}` : ''}`}
          />
        ))}
        <span className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${pct(index)}%` }} aria-hidden />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {Object.values(MARK).map((m) => (
          <span key={m.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-[3px] rounded-full ${m.cls}`} aria-hidden />
            {m.label}
          </span>
        ))}
      </div>

      <ol className="scroll-x grid grid-cols-9 gap-1.5" aria-label="Nearby frames">
        {strip.map((f, k) => {
          const i = from + k;
          const m = byIndex.get(i);
          return (
            <li key={f} className="min-w-0">
              <button
                type="button"
                onClick={() => onSeek(i)}
                className={`block w-full overflow-hidden rounded-[3px] bg-stage outline-offset-1 ${i === index ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas' : 'opacity-80 hover:opacity-100'}`}
                aria-label={`Frame ${i + 1}${m ? `, ${m.label}` : ''}`}
                aria-current={i === index}
              >
                <img src={frameUrl(sessionId, f)} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" draggable={false} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
