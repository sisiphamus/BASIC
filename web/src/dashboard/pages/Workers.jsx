import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ago, plural } from '../model.js';
import { Loading, Problem, useAsync } from '../parts/ui.jsx';

export default function Workers() {
  const { data, error, loading, reload } = useAsync(() => api.workers(), []);
  if (loading && !data) return <Loading label="Loading crew" />;
  if (error) return <Problem error={error} onRetry={reload} title="Could not load the crew list" />;
  const workers = data.workers;
  return (
    <div className="pt-8">
      <h1 className="font-display text-[2.5rem] font-bold leading-none">Crew</h1>
      {workers.length === 0 ? (
        <p className="mt-10 text-ink-2">Nobody yet. People show up here after their first job.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {workers.map((w) => (
            <li key={w.name}>
              <Link to={`/crew/${encodeURIComponent(w.name)}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 py-3 hover:bg-panel sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]">
                <span className="truncate font-display text-xl font-semibold">{w.name}</span>
                <span className="text-sm text-ink-2 sm:order-none">{plural(w.sessions, 'job')}</span>
                <span className={`col-span-2 text-sm sm:col-span-1 sm:text-right ${w.active ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                  {w.active ? 'On a job now' : `Last seen ${ago(w.lastSeen)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
