import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveApi, useLiveSlice, useNow } from '../live.jsx';
import { attention, clock, clockSec, feedState } from '../model.js';
import { useSession } from '../useSession.js';
import { ActionButton, Frame, Loading, Problem, Signal } from '../parts/ui.jsx';
import Scrubber, { frameIndexAt, useMarkers } from '../parts/Scrubber.jsx';
import Checklist from '../parts/Checklist.jsx';
import Rules from '../parts/Rules.jsx';
import { TalkBox, Transcript } from '../parts/Talk.jsx';

function EndJob({ session, onEnded }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  if (session.status !== 'active') return null;
  if (!confirm)
    return (
      <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
        End job
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-fail/50 bg-fail-soft px-3 py-2">
      <span className="text-sm font-semibold">End this job now?</span>
      <ActionButton
        className="btn btn-sm btn-danger"
        onClick={async () => {
          try {
            onEnded(await api.end(session.id));
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        End job
      </ActionButton>
      <button type="button" className="btn btn-sm" onClick={() => setConfirm(false)}>
        Keep going
      </button>
      {error && <span className="text-sm text-fail">{error}</span>}
    </div>
  );
}

function ModelState({ session, feed }) {
  const l = session.live || {};
  if (session.status !== 'active') return <span>{session.status === 'complete' ? 'Job complete' : 'Job ended'}</span>;
  const glasses = l.glassesOnline ? 'Glasses connected' : feed.kind === 'offline' ? 'Glasses offline' : session.simulated ? null : 'Pictures coming in';
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {glasses && <span className={feed.kind === 'offline' ? 'font-semibold text-ink' : ''}>{glasses}</span>}
      {l.analyzing ? <span>Checking the latest picture…</span> : l.lastLatencyMs != null && <span>Last check took {(l.lastLatencyMs / 1000).toFixed(1)} s</span>}
      {l.lastError && <span className="text-fail">Camera check failed: {l.lastError}</span>}
    </span>
  );
}

function FrameReading({ analysis }) {
  if (!analysis) return <p className="text-sm text-ink-3">The camera did not check this picture.</p>;
  const tone = analysis.status === 'pass' ? 'text-pass' : analysis.status === 'fail' ? 'text-fail' : 'text-ink-2';
  const word = { pass: 'Pass', fail: 'Fail', unclear: 'Unclear' }[analysis.status] || analysis.status;
  return (
    <p className="text-sm">
      <span className={`font-semibold ${tone}`}>{word}</span>
      {typeof analysis.confidence === 'number' && <span className="text-ink-3"> ({Math.round(analysis.confidence * 100)}% sure)</span>}
      {analysis.evidence && <span className="text-ink-2"> · {analysis.evidence}</span>}
      {analysis.scene && <span className="block text-ink-3">{analysis.scene}</span>}
    </p>
  );
}

export default function Crew() {
  const { id } = useParams();
  const { session, events, frames, frameTs, analysisBy, error, ready, reload, setSession } = useSession(id);
  const live = useLiveApi();
  const recent = useLiveSlice('recent', id);
  const frameAt = useLiveSlice('frameAt', id);
  const ackAt = useLiveSlice('acks', id);
  const now = useNow(5000);
  const [cursor, setCursor] = useState(null); // null = follow live
  const markers = useMarkers(events, frames, frameTs);

  const seek = useCallback((i) => setCursor(i >= frames.length - 1 ? null : Math.max(0, i)), [frames.length]);
  const seekFrame = useCallback((fid) => {
    const i = frames.indexOf(fid);
    if (i >= 0) seek(i);
  }, [frames, seek]);
  const seekTs = useCallback((ts) => seek(frameIndexAt(frames, frameTs, ts)), [frames, frameTs, seek]);

  if (!ready) return <Loading label="Loading crew" />;
  if (error && !session) return <Problem error={error} onRetry={reload} title="Could not load this crew" />;
  if (!session) return <Problem error="This crew is not on the server any more." />;

  const index = cursor ?? frames.length - 1;
  const fid = frames[index];
  const isLive = cursor === null && session.status === 'active';
  const needs = attention(session, recent || events.slice(-80), frameAt, now, ackAt);
  const feed = feedState(session, frameAt, now);
  const first = session.worker.split(' ')[0];

  return (
    <div className="flex flex-col gap-8 pt-6">
      <header className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-full">
          <nav className="text-sm text-ink-2" aria-label="Breadcrumb">
            <Link to="/" className="link">
              Floor
            </Link>
          </nav>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <h1 className="font-display text-[2.5rem] font-bold leading-none [overflow-wrap:anywhere]">{session.worker}</h1>
            {session.mode === 'trainee' && <span className="rounded-[3px] border border-ink px-1.5 py-0.5 text-sm font-semibold">Trainee</span>}
          </div>
          <p className="mt-2 text-ink-2 [overflow-wrap:anywhere]">
            {[session.job?.customer, session.job?.address].filter(Boolean).join(', ')}
            {session.job?.customer ? ' · ' : ''}
            {session.playbookTitle} · started {clock(session.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Link to={`/report/${session.id}`} className="btn">
            Proof packet
          </Link>
          <Link to={`/crew/${encodeURIComponent(session.worker)}`} className="btn">
            Training record
          </Link>
          <EndJob session={session} onEnded={setSession} />
        </div>
      </header>

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:grid-rows-[auto_1fr]">
          <section aria-label="Camera" className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Frame sessionId={session.id} frameId={fid} alt={isLive ? `Live picture from ${session.worker}` : `Picture ${index + 1}`} fit="contain" className="aspect-[4/3] max-h-[30rem] w-full rounded-md" />
            <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl font-semibold">
                  {!fid ? 'Waiting for the first picture' : [isLive ? 'Live' : `Picture ${index + 1} of ${frames.length}`, clockSec(frameTs.get(fid) || (isLive ? session.lastFrameAt : null))].filter(Boolean).join(' · ')}
                </p>
                {fid && <FrameReading analysis={analysisBy.get(fid)} />}
              </div>
              {cursor !== null && (
                <button type="button" className="btn btn-sm" onClick={() => setCursor(null)}>
                  {session.status === 'active' ? 'Back to live' : 'Last picture'}
                </button>
              )}
            </div>
            <div className="mt-4">
              <Scrubber sessionId={session.id} frames={frames} index={index} onSeek={seek} markers={markers} live={isLive} />
            </div>
            <p className="mt-3 text-sm text-ink-2">
              <ModelState session={session} feed={feed} />
            </p>
          </section>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {needs.length > 0 && (
            <div className="flex flex-col gap-2" aria-label="Needs you">
              {needs.map((n) => (
                <Signal key={n.kind} item={n} size="lg" />
              ))}
              {needs.some((n) => n.kind === 'fail' || n.kind === 'rule') && (
                <button type="button" className="btn btn-sm self-start" onClick={() => live.ack(id)}>
                  OK, seen
                </button>
              )}
            </div>
          )}
          <section aria-labelledby="steps">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="steps" className="font-display text-2xl font-semibold">
                Checklist
              </h2>
              <span className="text-sm text-ink-2">
                {session.steps.filter((s) => s.status === 'pass').length} of {session.steps.length} passed
              </span>
            </div>
            <Checklist session={session} onSeekFrame={seekFrame} onSession={setSession} />
          </section>
          <Rules session={session} onChange={setSession} />
        </div>

        <div className={`grid min-w-0 content-start gap-x-8 gap-y-10 lg:col-start-1 lg:row-start-2 ${session.status === "active" ? "xl:grid-cols-2" : ""}`}>
          <TalkBox session={session} feed={feed} />
          <Transcript events={events} onSeekTs={seekTs} worker={session.worker} />
        </div>
      </div>
    </div>
  );
}
