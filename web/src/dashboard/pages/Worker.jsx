import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { clock, day, passedCount, plural } from '../model.js';
import { Loading, Problem, useAsync } from '../parts/ui.jsx';

export default function Worker() {
  const { name } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [training, { sessions }] = await Promise.all([api.training(name), api.sessions()]);
    const mine = sessions.filter((s) => s.worker.toLowerCase() === name.toLowerCase()).sort((a, b) => b.createdAt - a.createdAt);
    return { training, sessions: mine };
  }, [name]);

  if (loading && !data) return <Loading label="Loading training record" />;
  if (error) return <Problem error={error} onRetry={reload} title="Could not load this training record" />;

  const { training, sessions } = data;
  const worker = sessions[0]?.worker || training.worker;
  const titles = Object.fromEntries(sessions.map((s) => [s.playbookId, s.playbookTitle]));
  const groups = {};
  for (const k of training.skills) (groups[k.playbookId] ||= []).push(k);
  const signed = training.skills.filter((k) => k.signedOff).length;
  const need = training.signOffAfter;

  return (
    <div className="pt-6">
      <nav className="text-sm text-ink-2" aria-label="Breadcrumb">
        <Link to="/crew" className="link">
          Crew
        </Link>
      </nav>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-line pb-6">
        <div>
          <h1 className="font-display text-[2.5rem] font-bold leading-none">{worker}</h1>
          <p className="mt-2 max-w-prose text-ink-2">
            Signed off after {plural(need, 'pass', 'passes')} with no hint, message, or approval.
          </p>
        </div>
        {training.skills.length > 0 && (
          <p className="font-display text-2xl font-semibold leading-none">
            <span className="text-[3.5rem] font-bold tabular-nums">{signed}</span>
            <span className="text-ink-2"> of {training.skills.length} skills signed off</span>
          </p>
        )}
      </div>

      {training.skills.length === 0 ? (
        <p className="py-10 text-ink-2">No steps attempted yet. Skills show up here after the first job.</p>
      ) : (
        Object.entries(groups).map(([pb, skills]) => (
          <section key={pb} className="mt-8" aria-labelledby={`pb-${pb}`}>
            <h2 id={`pb-${pb}`} className="font-display text-2xl font-semibold">
              {titles[pb] || pb}
            </h2>
            <div className="mt-3 max-w-4xl overflow-x-auto">
              <table className="w-full border-collapse sm:min-w-[36rem] text-left text-[0.9375rem]">
                <thead>
                  <tr className="border-b border-ink text-sm text-ink-2">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Skill
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-4">
                      Tries
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-4">
                      Passed
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-4">
                      No help
                    </th>
                    <th scope="col" className="py-2 pl-2 font-semibold sm:pl-4">
                      Sign-off
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((k) => (
                    <tr key={k.stepId} className="border-b border-line">
                      <th scope="row" className="py-3 pr-4 font-display text-lg font-semibold">
                        {k.title}
                      </th>
                      <td className="px-2 py-3 text-right tabular-nums sm:px-4">{k.attempts}</td>
                      <td className="px-2 py-3 text-right tabular-nums sm:px-4">{k.passes}</td>
                      <td className="px-2 py-3 text-right tabular-nums sm:px-4">{k.unaided}</td>
                      <td className="py-3 pl-2 sm:pl-4">
                        {k.signedOff ? (
                          <span className="font-semibold text-pass">Signed off</span>
                        ) : (
                          <span className="text-ink-2">{need - k.unaided} more</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <section className="mt-12" aria-labelledby="jobs">
        <h2 id="jobs" className="font-display text-2xl font-semibold">
          Jobs
        </h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-ink-2">No jobs on record.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {sessions.map((s) => (
              <li key={s.id} className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <Link to={`/sessions/${s.id}`} className="font-semibold hover:underline">
                    {s.job?.customer ? `${s.job.customer}, ` : ''}
                    {s.playbookTitle}
                  </Link>
                  <p className="text-sm text-ink-2">
                    {day(s.createdAt)}, {clock(s.createdAt)} · {s.mode === 'trainee' ? 'Trainee · ' : ''}
                    {s.status === 'active' ? 'On the job now' : s.status === 'complete' ? 'Complete' : 'Ended early'} · {passedCount(s)} of {s.steps.length} passed
                  </p>
                </div>
                <Link to={`/report/${s.id}`} className="btn btn-sm justify-self-start">
                  Proof packet
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
