import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { plural } from '../model.js';
import { Loading, Problem, useAsync } from '../parts/ui.jsx';

export default function Playbooks() {
  const { data, error, loading, reload } = useAsync(() => api.playbooks(), []);
  if (loading && !data) return <Loading label="Loading playbooks" />;
  if (error) return <Problem error={error} onRetry={reload} title="Could not load playbooks" />;
  const { playbooks, errors } = data;
  return (
    <div className="pt-8">
      <h1 className="font-display text-[2.5rem] font-bold leading-none">Playbooks</h1>

      {errors.length > 0 && (
        <div className="mt-6 max-w-3xl rounded-md border border-fail/40 bg-fail-soft p-4" role="alert">
          <p className="font-semibold text-fail">{plural(errors.length, 'playbook file')} did not load</p>
          <ul className="mt-2 space-y-1 text-sm">
            {errors.map((e) => (
              <li key={e.file}>
                <span className="font-semibold">{e.file}</span> <span className="text-ink-2">{e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {playbooks.length === 0 ? (
        <p className="mt-10 text-ink-2">No playbooks yet. Add a YAML file to the playbooks folder on the server.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {playbooks.map((p) => (
            <li key={p.id} className="grid gap-x-10 gap-y-3 py-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-semibold leading-tight">
                  <Link to={`/playbooks/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-ink-2">{p.summary}</p>
              </div>
              <div className="min-w-0">
                <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem]">
                  {p.steps.map((s, i) => (
                    <li key={s.id} className="whitespace-nowrap">
                      <span className="font-display font-bold">{i + 1}</span> {s.title}
                    </li>
                  ))}
                </ol>
                {p.watch.length > 0 && (
                  <p className="mt-2 text-sm text-ink-2">
                    Watch rules: {p.watch.map((w) => w.when.replace(/\.$/, '')).join('; ')}
                  </p>
                )}
              </div>
              <Link to={`/playbooks/${p.id}`} className="btn self-start justify-self-start">
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
