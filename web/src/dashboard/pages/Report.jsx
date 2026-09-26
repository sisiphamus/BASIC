import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../useSession.js';
import { clock, clockSec, day, plural, resultLabel } from '../model.js';
import { Frame, Loading, Problem } from '../parts/ui.jsx';

function Meta({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-[0.9375rem]">{children || 'Not recorded'}</dd>
    </div>
  );
}

export default function Report() {
  const { id } = useParams();
  const { session: s, events, error, ready, reload } = useSession(id);

  useEffect(() => {
    if (s) document.title = `${s.worker}, ${s.job?.customer || s.playbookTitle} · Base Academy`;
    return () => void (document.title = 'Base Academy');
  }, [s]);

  if (!ready) return <div className="px-6"><Loading label="Building the record" /></div>;
  if (!s) return <div className="px-6"><Problem error={error || 'No such job.'} onRetry={reload} title="Could not load this record" /></div>;

  const messages = events.filter((e) => e.type === 'supervisor.message');
  const ruleHits = events.filter((e) => e.type === 'rule.fired');
  const passed = s.steps.filter((st) => st.status === 'pass').length;
  const approved = s.steps.filter((st) => st.approvedBy).length;
  const skipped = s.steps.filter((st) => st.status === 'skipped').length;
  const open = s.status === 'active';
  const outcome = open ? 'In progress' : s.status === 'complete' ? 'Complete' : 'Ended before all steps were done';
  const title = /install/i.test(s.playbookId) ? 'Install record' : 'Job record';

  return (
    <div className="bg-canvas print:bg-white">
      <div className="no-print border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[920px] items-center gap-4 px-4 py-3 sm:px-6">
          <Link to={`/sessions/${s.id}`} className="link text-sm">
            Back to {s.worker.split(' ')[0]}
          </Link>
          <button type="button" className="btn btn-primary ml-auto" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-[920px] bg-panel px-4 py-8 sm:my-6 sm:border sm:border-line sm:px-10 sm:py-10 print:m-0 print:border-0 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <p className="font-display text-lg font-bold uppercase tracking-[0.04em]">Base Academy</p>
            <h1 className="font-display text-[2.75rem] font-bold leading-none">{title}</h1>
            <p className="mt-1 text-ink-2">{s.playbookTitle}</p>
          </div>
          <p className={`font-display text-2xl font-semibold ${open ? 'text-ink-2' : s.status === 'complete' && !skipped ? 'text-pass' : 'text-ink'}`}>{outcome}</p>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line py-5 sm:grid-cols-4">
          <Meta label="Customer">{s.job?.customer}</Meta>
          <Meta label="Address">{s.job?.address}</Meta>
          <Meta label="Technician">
            {s.worker}
            {s.mode === 'trainee' ? ' (trainee)' : ''}
          </Meta>
          <Meta label="Date">{day(s.createdAt)}</Meta>
          <Meta label="Started">{clock(s.createdAt)}</Meta>
          <Meta label="Finished">{s.endedAt ? clock(s.endedAt) : 'Not yet'}</Meta>
          <Meta label="Record ID">{s.id.slice(0, 8)}</Meta>
        </dl>

        <p className="py-5 text-[0.9375rem]">
          {passed - approved} of {s.steps.length} steps passed on camera.
          {approved ? ` ${approved} approved by the supervisor.` : ''}
          {skipped ? ` ${plural(skipped, 'step')} skipped.` : ''}
        </p>

        <ol className="border-t border-line">
          {s.steps.map((st, i) => (
            <li key={st.id} className="print-avoid-break grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-line py-5 sm:grid-cols-[2rem_13rem_minmax(0,1fr)]">
              <span className="font-display text-2xl font-bold leading-none">{i + 1}</span>
              <div className="col-start-2 sm:col-start-auto">
                {st.frameId ? (
                  <Frame sessionId={s.id} frameId={st.frameId} alt={`Evidence for ${st.title}`} className="aspect-[4/3] w-full max-w-[13rem] rounded-[3px]" />
                ) : (
                  <div className="flex aspect-[4/3] w-full max-w-[13rem] items-center justify-center rounded-[3px] border border-dashed border-line-2 p-3 text-center text-sm text-ink-3">
                    No photo
                  </div>
                )}
              </div>
              <div className="col-start-2 min-w-0 sm:col-start-auto">
                <h2 className="font-display text-2xl font-semibold leading-tight">{st.title}</h2>
                <p className={`mt-1 font-semibold ${st.status === 'pass' ? 'text-pass' : 'text-ink'}`}>{resultLabel(st)}</p>
                {st.evidence && (
                  <p className="mt-2 text-[0.9375rem]">
                    {st.approvedBy ? 'Last camera reading before approval: ' : 'Reading: '}
                    {st.evidence}
                  </p>
                )}
                <p className="mt-2 text-sm text-ink-2">Checked for: {st.check}</p>
                <p className="mt-2 text-sm text-ink-2">
                  {st.startedAt ? `Started ${clockSec(st.startedAt)}` : 'Not started'}
                  {st.finishedAt ? `, finished ${clockSec(st.finishedAt)}` : ''}
                  {st.fails ? ` · ${plural(st.fails, 'failed check')} before this` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {(messages.length > 0 || ruleHits.length > 0) && (
          <div className="grid gap-8 py-6 sm:grid-cols-2">
            {messages.length > 0 && (
              <section className="print-avoid-break">
                <h2 className="font-display text-xl font-semibold">Supervisor messages</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {messages.map((m) => (
                    <li key={m.seq} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <span className="text-ink-2 tabular-nums">{clockSec(m.ts)}</span>
                      <span>{m.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {ruleHits.length > 0 && (
              <section className="print-avoid-break">
                <h2 className="font-display text-xl font-semibold">Safety warnings given</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {ruleHits.map((m) => (
                    <li key={m.seq} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <span className="text-ink-2 tabular-nums">{clockSec(m.ts)}</span>
                      <span>
                        {m.when}
                        {m.evidence ? <span className="text-ink-2"> Seen: {m.evidence}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <div className="print-avoid-break mt-8 grid gap-8 sm:grid-cols-2">
          {['Supervising electrician', 'Inspector'].map((who) => (
            <div key={who}>
              <div className="h-12 border-b border-ink" />
              <p className="mt-1.5 flex justify-between text-sm text-ink-2">
                <span>{who}</span>
                <span className="pr-16">Date</span>
              </p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
