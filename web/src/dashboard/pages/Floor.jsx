import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive, useNow } from '../live.jsx';
import { ago, attention, clock, currentStep, duration, passedCount, plural, urgency } from '../model.js';
import { Frame, Loading, Signal, StepTrack } from '../parts/ui.jsx';
import StartCrew from '../parts/StartCrew.jsx';

function lastSaid(recent) {
  for (let i = recent.length - 1; i >= 0; i--) if (recent[i].type === 'say') return recent[i];
  return null;
}

function CrewRow({ s, recent, frameAt: seenAt, needs, now }) {
  const step = currentStep(s);
  const said = lastSaid(recent);
  const frameAt = seenAt || s.lastFrameAt;
  const fresh = frameAt && now - frameAt < 15e3;
  return (
    <li>
      <Link
        to={`/sessions/${s.id}`}
        className={`group grid grid-cols-[112px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-md border bg-panel p-2.5 transition-colors hover:border-ink sm:grid-cols-[152px_minmax(0,1fr)] lg:grid-cols-[152px_minmax(0,15rem)_minmax(0,1fr)_18rem] lg:items-stretch lg:gap-x-6 ${needs.length ? 'border-ink' : 'border-line'}`}
      >
        <Frame sessionId={s.id} frameId={s.lastFrameId} alt={`Latest picture from ${s.worker}`} className="aspect-[4/3] w-full self-start rounded-[4px]" />

        <div className="flex min-w-0 flex-col">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-display text-[1.625rem] font-semibold leading-tight">{s.worker}</h3>
            {s.mode === 'trainee' && <span className="shrink-0 rounded-[3px] border border-ink px-1.5 py-0.5 text-xs font-semibold">Trainee</span>}
          </div>
          <p className="line-clamp-2 text-[0.9375rem] text-ink-2">{[s.job?.customer, s.job?.address].filter(Boolean).join(', ') || s.playbookTitle}</p>
          {!needs.some((n) => n.kind === 'offline') && (
            <p className={`mt-auto pt-2 text-sm ${fresh ? 'text-ink-2' : 'text-ink-3'}`}>
              {frameAt ? (fresh ? 'Live' : `Last picture ${ago(frameAt, now)}`) : 'Waiting for first picture'}
            </p>
          )}
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-3 lg:col-span-1">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="shrink-0 font-display text-[1.625rem] font-semibold leading-none tabular-nums">
              {s.current + 1}
              <span className="text-ink-3"> of {s.steps.length}</span>
            </span>
            <span className="truncate font-display text-[1.625rem] font-semibold leading-none">{step?.title}</span>
          </div>
          <StepTrack steps={s.steps} height="h-2.5" />
          {said && (
            <p className="line-clamp-2 text-sm text-ink-2">
              <span className="font-semibold text-ink">{said.source === 'supervisor' ? 'You said' : 'Glasses said'}</span> {said.text}
            </p>
          )}
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-2 lg:col-span-1">
          {needs.length ? (
            needs.slice(0, 2).map((n) => <Signal key={n.kind} item={n} />)
          ) : (
            <div className="flex h-full flex-col justify-center text-sm text-ink-2">
              <p className="font-semibold text-pass">On track</p>
              {step?.startedAt && <p className="first-letter:uppercase">{duration(now - step.startedAt)} on this step</p>}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

const FINISHED_SHOWN = 10;

function Finished({ list: all }) {
  const [open, setOpen] = useState(false);
  const list = open ? all : all.slice(0, FINISHED_SHOWN);
  return (
    <section className="mt-12" aria-labelledby="finished">
      <h2 id="finished" className="font-display text-2xl font-semibold">
        Finished jobs
      </h2>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {list.map((s) => {
          const passed = passedCount(s);
          const approved = s.steps.filter((st) => st.approvedBy).length;
          const skipped = s.steps.filter((st) => st.status === 'skipped').length;
          return (
            <li key={s.id} className="grid grid-cols-1 gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center">
              <Link to={`/sessions/${s.id}`} className="min-w-0 truncate font-display text-xl font-semibold hover:underline">
                {s.worker}
              </Link>
              <div className="min-w-0 text-sm">
                <p className="truncate">
                  {s.job?.customer ? `${s.job.customer}, ` : ''}
                  {s.playbookTitle}
                </p>
                <p className="text-ink-2">
                  {s.status === 'ended' ? 'Ended early' : 'Complete'} {clock(s.endedAt)} · {passed} of {s.steps.length} passed
                  {approved ? ` · ${approved} approved by you` : ''}
                  {skipped ? ` · ${skipped} skipped` : ''}
                </p>
              </div>
              <Link to={`/report/${s.id}`} className="btn btn-sm justify-self-start sm:justify-self-end">
                Proof packet
              </Link>
            </li>
          );
        })}
      </ul>
      {all.length > FINISHED_SHOWN && (
        <button type="button" className="btn btn-sm mt-3" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show fewer' : `Show all ${all.length}`}
        </button>
      )}
    </section>
  );
}

export default function Floor() {
  const [{ sessions, recent, frameAt, acks, loaded, conn }] = useLive();
  const now = useNow(5000);
  const [adding, setAdding] = useState(false);

  const { active, finished } = useMemo(() => {
    const all = Object.values(sessions);
    const active = all
      .filter((s) => s.status === 'active')
      .map((s) => ({ s, needs: attention(s, recent[s.id], frameAt[s.id], now, acks[s.id]) }))
      .sort((a, b) => urgency(a.needs) - urgency(b.needs) || a.s.worker.localeCompare(b.s.worker));
    const finished = all
      .filter((s) => s.status !== 'active' && now - (s.endedAt || s.updatedAt) < 24 * 3600e3)
      .sort((a, b) => (b.endedAt || b.updatedAt) - (a.endedAt || a.updatedAt));
    return { active, finished };
  }, [sessions, recent, frameAt, acks, now]);

  // Simulated crews finish and restart every few minutes; don't flash the setup panel in the gap.
  const seenActive = useRef(false);
  const [emptyLong, setEmptyLong] = useState(false);
  const none = loaded && active.length === 0;
  useEffect(() => {
    if (!none) {
      if (loaded) seenActive.current = true;
      setEmptyLong(false);
      return;
    }
    if (!seenActive.current) {
      setEmptyLong(true);
      return;
    }
    const t = setTimeout(() => setEmptyLong(true), 5000);
    return () => clearTimeout(t);
  }, [none, loaded]);

  if (!loaded) return conn.state === 'offline' ? <p className="py-16 text-ink-2">Waiting for the server…</p> : <Loading label="Connecting to the floor" />;

  const needCount = active.filter((a) => a.needs.length).length;
  const needs = active.filter((a) => a.needs.length);
  const fine = active.filter((a) => !a.needs.length);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pt-8 pb-6">
        <div>
          <h1 className="font-display text-[2.5rem] font-bold leading-none">Crew floor</h1>
          {active.length > 0 && (
            <p className="mt-2 text-ink-2">
              {plural(active.length, 'crew')} working
              {needCount ? (
                <>
                  , <strong className="font-semibold text-ink">{needCount} need you</strong>
                </>
              ) : (
                ', all on track'
              )}
            </p>
          )}
        </div>
        {active.length > 0 && (
          <button type="button" className="btn ml-auto" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'Add a crew'}
          </button>
        )}
      </div>

      {(adding || (active.length === 0 && emptyLong)) && (
        <section className="mb-8 rounded-md border border-line bg-panel p-6" aria-labelledby="add-crew">
          <h2 id="add-crew" className="mb-5 font-display text-2xl font-semibold">
            {active.length ? 'Add a crew' : 'No crews on a job right now'}
          </h2>
          <StartCrew />
        </section>
      )}

      {needs.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Crews that need you">
          {needs.map(({ s, needs }) => (
            <CrewRow key={s.id} s={s} needs={needs} recent={recent[s.id] || []} frameAt={frameAt[s.id]} now={now} />
          ))}
        </ul>
      )}
      {needs.length > 0 && fine.length > 0 && <div className="my-4 border-t border-line" />}
      {fine.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Crews on track">
          {fine.map(({ s, needs }) => (
            <CrewRow key={s.id} s={s} needs={needs} recent={recent[s.id] || []} frameAt={frameAt[s.id]} now={now} />
          ))}
        </ul>
      )}

      {finished.length > 0 && <Finished list={finished} />}
    </>
  );
}
