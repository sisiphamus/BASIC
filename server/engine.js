// The session state machine. Pure: takes a session and an input, mutates the
// session, returns a list of actions (things to say, events to log). No I/O here.

import { fillTemplate, parseWatchRule } from './playbooks.js';

export const TIMING = {
  failRepeatMs: 10_000, // don't repeat a fail line faster than this
  hintAfterUnclear: 4, // unclear frames in a row before we give a hint
  hintRepeatMs: 12_000,
  dedupeMs: 8_000, // same line within this window is dropped
};

const COMMANDS = new Set(['next', 'back', 'repeat', 'help', 'approve', 'restart']);

export function createSession({ playbook, worker, mode = 'crew', job = {}, now = Date.now(), id }) {
  const session = {
    id,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    status: 'active',
    worker: String(worker || 'Crew member').trim() || 'Crew member',
    mode: mode === 'trainee' ? 'trainee' : 'crew',
    playbookId: playbook.id,
    playbookTitle: playbook.title,
    context: playbook.context || '',
    frameIntervalMs: playbook.frame_interval_ms,
    job: { ...playbook.job, ...job },
    stepDefs: playbook.steps.map((s) => ({ ...s })),
    steps: playbook.steps.map((s) => ({
      id: s.id,
      title: s.title,
      status: 'pending',
      fails: 0,
      unclearStreak: 0,
      helped: false,
      approvedBy: null,
      startedAt: null,
      finishedAt: null,
      evidence: '',
      frameId: null,
      lastFailSaidAt: -Infinity,
      lastHintAt: -Infinity,
    })),
    current: 0,
    rules: playbook.watch.map((r) => ({ ...r })),
    ruleFiredAt: {},
    lastSaid: {},
    frames: 0,
    analyses: 0,
    modelErrors: 0,
    lastScene: '',
  };
  const actions = [];
  enterStep(session, 0, now, actions);
  return { session, actions };
}

function def(session, i = session.current) {
  return session.stepDefs[i];
}

function vars(session) {
  return { ...session.job, worker: session.worker };
}

function say(session, actions, text, { source, now, interrupt = false, force = false }) {
  const t = String(text || '').trim();
  if (!t) return;
  const last = session.lastSaid[t];
  if (!force && last !== undefined && now - last < TIMING.dedupeMs) return;
  session.lastSaid[t] = now;
  // keep the dedupe map small
  for (const [k, v] of Object.entries(session.lastSaid)) if (now - v > 60_000) delete session.lastSaid[k];
  actions.push({ type: 'say', text: t, source, interrupt, stepId: session.steps[session.current]?.id ?? null });
}

function log(actions, event, data = {}) {
  actions.push({ type: 'event', event, ...data });
}

function enterStep(session, i, now, actions) {
  session.current = i;
  const st = session.steps[i];
  st.status = 'active';
  st.unclearStreak = 0;
  st.startedAt = st.startedAt ?? now;
  log(actions, 'step.enter', { stepId: st.id, title: st.title });
  const d = def(session, i);
  say(session, actions, fillTemplate(d.say, vars(session)), { source: 'step', now, force: true });
  if (session.mode === 'trainee' && d.why) {
    say(session, actions, fillTemplate(d.why, vars(session)), { source: 'step', now, force: true });
  }
}

function finishStep(session, status, now, actions, extra = {}) {
  const st = session.steps[session.current];
  st.status = status;
  st.finishedAt = now;
  Object.assign(st, extra);
  log(actions, `step.${status}`, { stepId: st.id, title: st.title, ...extra });
  const next = session.steps.findIndex((s, i) => i > session.current && s.status !== 'pass');
  if (next === -1) {
    const open = session.steps.findIndex((s) => s.status !== 'pass' && s.status !== 'skipped');
    if (open === -1) return complete(session, now, actions);
    return enterStep(session, open, now, actions);
  }
  enterStep(session, next, now, actions);
}

function complete(session, now, actions) {
  session.status = 'complete';
  session.endedAt = now;
  const skipped = session.steps.filter((s) => s.status === 'skipped').length;
  const line = skipped
    ? `All steps done, ${skipped} skipped. Your supervisor will review the skipped ones.`
    : 'All steps complete. Proof packet is ready for your supervisor.';
  say(session, actions, line, { source: 'system', now, force: true });
  log(actions, 'session.complete', { skipped });
}

function markHelped(session) {
  const st = session.steps[session.current];
  if (st && session.status === 'active') st.helped = true;
}

/**
 * result: { scene, step: { id, status: pass|fail|unclear, evidence, confidence, coach_line }, rules: [{ id, evidence, line }] }
 * ctx: { now, frameId }
 */
export function applyAnalysis(session, result, { now = Date.now(), frameId = null } = {}) {
  const actions = [];
  session.analyses += 1;
  session.updatedAt = now;
  session.lastScene = result?.scene || '';
  if (session.status !== 'active') return actions;

  const st = session.steps[session.current];
  const d = def(session);

  // 1. Watch rules: safety first, before step feedback.
  for (const hit of result?.rules || []) {
    const rule = session.rules.find((r) => r.id === hit.id);
    if (!rule) continue;
    if (rule.steps.length && !rule.steps.includes(st.id)) continue;
    const last = session.ruleFiredAt[rule.id] ?? -Infinity;
    if (now - last < rule.cooldown_s * 1000) continue;
    session.ruleFiredAt[rule.id] = now;
    log(actions, 'rule.fired', { ruleId: rule.id, when: rule.when, evidence: hit.evidence || '', frameId });
    const line = fillTemplate(rule.say, vars(session)) || hit.line || hit.evidence;
    say(session, actions, line, { source: 'rule', now });
  }

  // 2. Step check. Ignore results computed for a step we already left.
  const sc = result?.step;
  if (!sc || (sc.id && sc.id !== st.id)) return actions;
  const confident = typeof sc.confidence === 'number' ? sc.confidence >= d.min_confidence : false;

  if (sc.status === 'pass' && confident) {
    st.evidence = sc.evidence || '';
    st.frameId = frameId;
    // No scripted confirmation? Speak the model's own, based on what it saw.
    say(session, actions, fillTemplate(d.pass_say, vars(session)) || sc.coach_line, { source: 'step', now, force: true });
    finishStep(session, 'pass', now, actions, { evidence: st.evidence, frameId });
  } else if (sc.status === 'fail' && confident) {
    st.fails += 1;
    st.unclearStreak = 0;
    st.helped = true;
    st.evidence = sc.evidence || '';
    log(actions, 'step.fail', { stepId: st.id, evidence: st.evidence, frameId });
    if (now - st.lastFailSaidAt >= TIMING.failRepeatMs) {
      st.lastFailSaidAt = now;
      const line = fillTemplate(d.fail_say, vars(session)) || sc.coach_line || sc.evidence;
      say(session, actions, line, { source: 'step', now, force: true });
    }
  } else {
    st.unclearStreak += 1;
    if (st.unclearStreak >= TIMING.hintAfterUnclear && now - st.lastHintAt >= TIMING.hintRepeatMs) {
      st.lastHintAt = now;
      st.unclearStreak = 0;
      const line = fillTemplate(d.hint, vars(session)) || sc.coach_line;
      if (line) {
        st.helped = true;
        say(session, actions, line, { source: 'hint', now, force: true });
      }
    }
  }
  return actions;
}

export function applyCommand(session, command, { now = Date.now(), by = 'crew' } = {}) {
  const cmd = String(command || '').toLowerCase().trim();
  if (!COMMANDS.has(cmd)) throw new Error(`unknown command "${command}"`);
  const actions = [];
  session.updatedAt = now;
  log(actions, 'command', { command: cmd, by });

  if (cmd === 'restart') {
    session.status = 'active';
    session.endedAt = null;
    for (const s of session.steps) Object.assign(s, { status: 'pending', fails: 0, unclearStreak: 0, helped: false, approvedBy: null, startedAt: null, finishedAt: null, evidence: '', frameId: null });
    enterStep(session, 0, now, actions);
    return actions;
  }
  if (session.status !== 'active') {
    if (cmd === 'repeat') say(session, actions, 'This job is complete.', { source: 'system', now, force: true });
    return actions;
  }
  const d = def(session);
  const v = vars(session);
  if (cmd === 'repeat') {
    say(session, actions, fillTemplate(d.say, v), { source: 'step', now, force: true });
  } else if (cmd === 'help') {
    markHelped(session);
    const why = fillTemplate(d.why, v);
    const hint = fillTemplate(d.hint, v);
    if (why) say(session, actions, why, { source: 'hint', now, force: true });
    if (hint) say(session, actions, hint, { source: 'hint', now, force: true });
    if (!why && !hint) say(session, actions, fillTemplate(d.say, v), { source: 'hint', now, force: true });
  } else if (cmd === 'next') {
    markHelped(session);
    finishStep(session, 'skipped', now, actions, { skippedBy: by });
  } else if (cmd === 'approve') {
    say(session, actions, fillTemplate(d.pass_say, v), { source: 'step', now, force: true });
    finishStep(session, 'pass', now, actions, { approvedBy: by });
  } else if (cmd === 'back') {
    if (session.current === 0) {
      say(session, actions, fillTemplate(d.say, v), { source: 'step', now, force: true });
    } else {
      session.steps[session.current].status = 'pending';
      const prev = session.current - 1;
      session.steps[prev].status = 'pending';
      session.steps[prev].finishedAt = null;
      enterStep(session, prev, now, actions);
    }
  }
  return actions;
}

export function supervisorSay(session, text, { now = Date.now(), from = 'Supervisor' } = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('message is empty');
  if (t.length > 400) throw new Error('message is too long (400 characters max)');
  const actions = [];
  session.updatedAt = now;
  markHelped(session);
  log(actions, 'supervisor.message', { text: t, from });
  say(session, actions, t, { source: 'supervisor', now, interrupt: true, force: true });
  return actions;
}

export function addRule(session, input) {
  const base = { ...input };
  if (!base.id) base.id = `rule-${Math.random().toString(36).slice(2, 8)}`;
  const rule = parseWatchRule(base);
  const i = session.rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) session.rules[i] = rule;
  else session.rules.push(rule);
  delete session.ruleFiredAt[rule.id];
  return rule;
}

export function removeRule(session, id) {
  const before = session.rules.length;
  session.rules = session.rules.filter((r) => r.id !== id);
  return session.rules.length !== before;
}

/** When the playbook file changes, update pending/active step wording without losing progress. */
export function refreshFromPlaybook(session, playbook) {
  const byId = new Map(playbook.steps.map((s) => [s.id, s]));
  const overrides = session.stepOverrides || {};
  session.stepDefs = session.stepDefs.map((d) => (byId.has(d.id) ? { ...byId.get(d.id), ...(overrides[d.id] || {}) } : d));
  session.steps.forEach((st) => {
    if (byId.has(st.id)) st.title = byId.get(st.id).title;
  });
  session.job = { ...playbook.job, ...session.job };
  session.context = playbook.context || '';
}

export function trainingRecord(sessions, worker, { signOffAfter = 2 } = {}) {
  const mine = sessions.filter((s) => s.worker.toLowerCase() === String(worker).toLowerCase());
  const skills = new Map();
  for (const s of mine) {
    s.steps.forEach((st) => {
      if (st.status === 'pending') return;
      const key = `${s.playbookId}:${st.id}`;
      const k = skills.get(key) || { playbookId: s.playbookId, stepId: st.id, title: st.title, attempts: 0, passes: 0, unaided: 0 };
      k.attempts += 1;
      if (st.status === 'pass') {
        k.passes += 1;
        if (!st.helped && !st.approvedBy) k.unaided += 1;
      }
      skills.set(key, k);
    });
  }
  const list = [...skills.values()].map((k) => ({ ...k, signedOff: k.unaided >= signOffAfter }));
  return { worker, sessions: mine.length, signOffAfter, skills: list };
}
