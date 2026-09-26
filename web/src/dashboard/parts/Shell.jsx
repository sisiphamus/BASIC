import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLive, useNow } from '../live.jsx';

function Connection({ quietWhenLive = false }) {
  const [{ conn, health }, live] = useLive();
  const now = useNow(1000);
  const mock = health?.model?.provider === 'mock';
  if (quietWhenLive && conn.state === 'live') return null;
  let text;
  if (conn.state === 'live') text = <span className="text-ink-2">Live</span>;
  else if (conn.state === 'offline') {
    const s = conn.retryAt ? Math.max(0, Math.ceil((conn.retryAt - now) / 1000)) : 0;
    text = (
      <span className="flex items-center gap-2">
        <span className="tag-signal rounded px-2 py-1 font-semibold">Server offline{s ? `, retrying in ${s}s` : ''}</span>
        <button type="button" className="btn btn-sm" onClick={() => live.retryNow()}>
          Retry
        </button>
      </span>
    );
  } else text = <span className="text-ink-2">Connecting…</span>;
  return (
    <div className="flex items-center gap-4 text-sm" role="status" aria-live="polite">
      {mock && (
        <span className="text-ink-3" title="No Gemini API key is set, so the server plays a scripted walkthrough instead of reading the video.">
          Demo model
        </span>
      )}
      {text}
    </div>
  );
}

const tab = ({ isActive }) =>
  `relative flex h-full items-center px-1 text-[0.9375rem] font-medium transition-colors ${isActive ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-ink' : 'text-ink-2 hover:text-ink'}`;

export default function Shell() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:gap-8 sm:px-6">
          <NavLink to="/" className="font-display text-[1.375rem] font-bold uppercase leading-none tracking-[0.02em]">
            Base Academy
          </NavLink>
          <nav className="flex h-full items-stretch gap-5" aria-label="Main">
            <NavLink to="/" className={() => tab({ isActive: pathname === '/' || pathname.startsWith('/sessions') })}>
              Floor
            </NavLink>
            <NavLink to="/crew" className={tab}>
              Crew
            </NavLink>
            <NavLink to="/playbooks" className={tab}>
              Playbooks
            </NavLink>
          </nav>
          <div className="ml-auto hidden sm:block">
            <Connection />
          </div>
        </div>
        <div className="border-t border-line px-4 py-2 empty:hidden sm:hidden">
          <Connection quietWhenLive />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 pb-16 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
