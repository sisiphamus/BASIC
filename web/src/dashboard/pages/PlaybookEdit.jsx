import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Loading, Problem, useAsync } from '../parts/ui.jsx';

/** Best guess at which line an error is about: "on line 12", or a path like "steps.2.check". */
function errorLine(source, message) {
  const m = message.match(/line (\d+)/i);
  if (m) return Number(m[1]);
  const p = message.match(/^([a-z_]+)(?:\.(\d+))?(?:\.([a-z_]+))?:/i);
  if (!p) return null;
  const lines = source.split('\n');
  const top = lines.findIndex((l) => new RegExp(`^${p[1]}:`).test(l));
  if (top < 0) return null;
  if (p[2] === undefined) return top + 1;
  let item = -1;
  let indent = null;
  for (let i = top + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const d = lines[i].match(/^(\s*)- /);
    if (d && (indent === null || d[1].length === indent)) {
      indent = d[1].length;
      item += 1;
      if (item === Number(p[2])) {
        if (!p[3]) return i + 1;
        for (let j = i; j < lines.length; j++) {
          if (j > i && (/^\S/.test(lines[j]) || new RegExp(`^\\s{${indent}}- `).test(lines[j]))) break;
          if (new RegExp(`^\\s*(- )?${p[3]}:`).test(lines[j])) return j + 1;
        }
        return i + 1;
      }
    }
  }
  return null;
}

const FIELDS = [
  ['Steps', null],
  ['title', 'Short name shown on the floor and in the proof packet.'],
  ['say', 'What the crew hears when the step starts.'],
  ['check', 'What a passing picture shows. The camera model reads this, so be specific: "tape reads 36 inches or more at the frame".'],
  ['pass_say / fail_say', 'What the crew hears on a pass or a miss.'],
  ['hint', 'Said when the camera cannot see well enough to decide.'],
  ['why', 'The reason behind the step. Trainees hear it; anyone hears it when they ask for help.'],
  ['Watch rules', null],
  ['when', 'Something to look out for on every picture, in plain English.'],
  ['say', 'What to tell the crew. Leave it empty and the glasses word it.'],
  ['cooldown_s', 'Seconds before the same warning can repeat.'],
];

export default function PlaybookEdit() {
  const { id } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.playbook(id), [id]);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState({ busy: false, error: '', ok: false });
  const [title, setTitle] = useState('');
  const gutter = useRef(null);
  const area = useRef(null);
  const escaped = useRef(false);

  useEffect(() => {
    if (data) {
      setText(data.source);
      setSaved(data.source);
      setTitle(data.playbook.title);
    }
  }, [data]);

  const dirty = text !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const badLine = useMemo(() => (status.error ? errorLine(text, status.error) : null), [status.error, text]);
  const lineCount = text.split('\n').length;

  const save = async () => {
    if (!dirty || status.busy) return;
    setStatus({ busy: true, error: '', ok: false });
    try {
      const res = await api.savePlaybook(id, text);
      setSaved(text);
      if (res.playbook?.title) setTitle(res.playbook.title);
      setStatus({ busy: false, error: '', ok: true });
    } catch (e) {
      setStatus({ busy: false, error: e.message.replace(/Too small: expected string to have >=1 characters/g, 'cannot be empty').replace(/ at line \d+, column \d+:?\s*$/, ''), ok: false });
    }
  };

  const jumpTo = (line) => {
    const ta = area.current;
    if (!ta) return;
    const lines = text.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length || 0));
    ta.scrollTop = Math.max(0, (line - 6) * 20);
  };

  if (loading && !data) return <Loading label="Loading playbook" />;
  if (error) return <Problem error={error} onRetry={reload} title="Could not open this playbook" />;

  return (
    <div className="pt-6">
      <nav className="text-sm text-ink-2" aria-label="Breadcrumb">
        <Link to="/playbooks" className="link">
          Playbooks
        </Link>
      </nav>
      <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[2.5rem] font-bold leading-none">{title || data.playbook.title}</h1>
          <p className="mt-2 text-sm text-ink-2">Saved changes reach crews on this playbook right away.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-ink-2" role="status" aria-live="polite">
            {status.ok && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : ''}
          </span>
          {dirty && (
            <button type="button" className="btn" onClick={() => (setText(saved), setStatus({ busy: false, error: '', ok: false }))}>
              Discard
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || status.busy} aria-busy={status.busy}>
            {status.busy && <span className="spin" aria-hidden />}
            Save
          </button>
        </div>
      </div>

      {status.error && (
        <div className="mt-5 rounded-md border border-fail/50 bg-fail-soft p-4" role="alert">
          <p className="font-semibold text-fail">Not saved</p>
          <p className="mt-1 text-[0.9375rem]">{status.error}</p>
          {badLine && (
            <button type="button" className="link mt-2 text-sm font-semibold" onClick={() => jumpTo(badLine)}>
              Go to line {badLine}
            </button>
          )}
        </div>
      )}

      <div className="mt-5 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={`code flex h-[46rem] overflow-hidden rounded-md border bg-panel ${status.error ? 'border-fail/60' : 'border-line-2'} focus-within:border-ink`}>
          <div ref={gutter} className="h-full w-12 shrink-0 select-none overflow-hidden border-r border-line bg-canvas py-3 text-right text-ink-3" aria-hidden>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={`pr-3 ${badLine === i + 1 ? 'bg-fail text-white' : ''}`}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={area}
            aria-label={`${title || data.playbook.title} playbook, YAML`}
            aria-describedby="editor-keys"
            value={text}
            spellCheck={false}
            wrap="off"
            onChange={(e) => {
              setText(e.target.value);
              if (status.ok) setStatus((s) => ({ ...s, ok: false }));
            }}
            onScroll={(e) => {
              if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={(e) => {
              const wasEscaped = escaped.current;
              escaped.current = e.key === 'Escape';
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                save();
              } else if (e.key === 'Tab' && !e.shiftKey && !wasEscaped) {
                // insertText keeps the browser's undo history, unlike setting the value.
                e.preventDefault();
                document.execCommand('insertText', false, '  ');
              }
            }}
            className="code block h-full w-full min-w-0 resize-none whitespace-pre bg-transparent px-4 py-3 text-ink focus:outline-none"
          />
        </div>
        <p id="editor-keys" className="-mt-6 text-sm text-ink-3 xl:col-start-1">
          Tab indents. Press Esc, then Tab, to leave the editor. Ctrl+S saves.
        </p>

        <aside className="text-sm xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-labelledby="fields">
          <h2 id="fields" className="font-display text-xl font-semibold">
            Fields
          </h2>
          <dl className="mt-2">
            {FIELDS.map(([k, v], i) =>
              v === null ? (
                <dt key={`section-${k}`} className="mt-4 border-b border-line pb-1 font-semibold text-ink-2">
                  {k}
                </dt>
              ) : (
                <div key={`${i}-${k}`} className="mt-2.5">
                  <dt className="code font-semibold">{k}</dt>
                  <dd className="mt-0.5 text-ink-2">{v}</dd>
                </div>
              ),
            )}
          </dl>
          <p className="mt-4 text-ink-2">
            Put job details under <span className="code">job</span> and use them in any line as{' '}
            <span className="code">{'{clearance_in}'}</span>.
          </p>
        </aside>
      </div>
    </div>
  );
}
