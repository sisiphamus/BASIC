// Pure helpers: formatting and "does this crew need the supervisor" logic.

const RECENT_MS = 3 * 60e3;
const NO_VIDEO_MS = 45e3;
const STUCK_MS = 6 * 60e3;

export function clock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function clockSec(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function day(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ago(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return day(ts);
}

export function duration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60e3);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function currentStep(s) {
  return s.steps[s.current] || null;
}

export function passedCount(s) {
  return s.steps.filter((st) => st.status === 'pass').length;
}

/** Is anything reaching us from this crew? A recent picture counts even with no glasses socket
 * (phones on the HTTPS backup channel, simulated crews). */
export function feedState(s, frameAt, now = Date.now()) {
  const last = frameAt || s.lastFrameAt || null;
  const fresh = last !== null && now - last < NO_VIDEO_MS;
  if (s.simulated) return { kind: 'ok', last };
  if (s.live?.glassesOnline) return { kind: fresh || !last ? 'ok' : 'quiet', last };
  return { kind: fresh ? 'ok' : 'offline', last };
}

/**
 * Why this crew needs the supervisor right now, most urgent first.
 * Returns [] when the crew is fine. Each item: { kind, signal, detail, at }.
 * `ackAt`: the supervisor pressed "OK, seen" then; warnings raised before it stay hidden.
 */
export function attention(s, recent = [], frameAt, now = Date.now(), ackAt = 0) {
  if (s.status !== 'active') return [];
  const out = [];
  const step = currentStep(s);

  // Anything the supervisor did on this crew counts as having seen its warnings.
  let handled = ackAt || 0;
  for (const e of recent) {
    if (e.type === 'supervisor.message' || (e.type === 'step.pass' && e.approvedBy) || (e.type === 'command' && e.by === 'supervisor')) handled = Math.max(handled, e.ts);
  }

  let lastFail = null;
  let lastRule = null;
  const removed = new Set();
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.type === 'rule.removed') removed.add(e.ruleId);
    if (!lastFail && e.type === 'step.fail' && e.stepId === step?.id) lastFail = e;
    if (!lastRule && e.type === 'rule.fired' && !removed.has(e.ruleId) && s.rules?.some((r) => r.id === e.ruleId)) lastRule = e;
  }
  if (lastFail && now - lastFail.ts < RECENT_MS && lastFail.ts > handled) {
    out.push({ kind: 'fail', signal: step.fails > 1 ? `Failed ${step.fails} times` : 'Failed check', detail: lastFail.evidence || step.title, at: lastFail.ts });
  }
  if (lastRule && now - lastRule.ts < RECENT_MS && lastRule.ts > handled) {
    out.push({ kind: 'rule', signal: 'Watch rule', detail: lastRule.evidence ? `${lastRule.when} Seen: ${lastRule.evidence}` : lastRule.when, at: lastRule.ts });
  }
  if (s.live?.lastError) {
    out.push({ kind: 'error', signal: 'Camera check failing', detail: s.live.lastError, at: s.updatedAt });
  }
  const feed = feedState(s, frameAt, now);
  if (feed.kind === 'offline') {
    out.push({ kind: 'offline', signal: 'Glasses offline', detail: feed.last ? `Last picture ${ago(feed.last, now)}` : 'No picture yet', at: feed.last || s.createdAt });
  } else if (feed.kind === 'quiet') {
    out.push({ kind: 'offline', signal: 'No video', detail: `Last picture ${ago(feed.last, now)}`, at: feed.last });
  }
  if (step?.startedAt && now - step.startedAt > STUCK_MS && !out.length) {
    out.push({ kind: 'stuck', signal: 'Slow step', detail: `On this step for ${duration(now - step.startedAt)}`, at: step.startedAt });
  }
  return out;
}

const RANK = { fail: 0, rule: 1, error: 2, offline: 3, stuck: 4 };
export const urgency = (items) => (items.length ? Math.min(...items.map((i) => RANK[i.kind])) : 9);

export const SOURCE_LABEL = {
  step: 'Coach',
  hint: 'Hint',
  rule: 'Watch rule',
  system: 'System',
  supervisor: 'You',
};

export function resultLabel(st) {
  if (st.status === 'pass') return st.approvedBy ? 'Passed, approved by supervisor' : st.helped ? 'Passed with help' : 'Passed';
  if (st.status === 'skipped') return st.skippedBy === 'supervisor' ? 'Skipped by supervisor' : 'Skipped';
  if (st.status === 'active') return st.fails ? `Working, ${plural(st.fails, 'miss', 'misses')}` : 'Working';
  return 'Not started';
}
