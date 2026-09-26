import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaybook } from '../../server/playbooks.js';
import { createSession, applyAnalysis, applyCommand, supervisorSay, addRule, removeRule, trainingRecord } from '../../server/engine.js';

const PB = parsePlaybook(`
id: t
title: Test job
job: { need: 36 }
steps:
  - id: a
    title: Step A
    say: Do A
    why: Because A matters
    check: A visible
    pass_say: A good
    fail_say: A needs {need}
    hint: Show me A
  - id: b
    title: Step B
    say: Do B
    check: B visible
watch:
  - id: gloves
    when: bare hands on metal
    say: Gloves on
    cooldown_s: 30
  - id: b-only
    when: something in B
    say: B rule
    steps: [b]
`);

const res = (status, conf = 0.9, extra = {}) => ({
  scene: 'x',
  step: { id: extra.stepId ?? 'a', status, evidence: extra.evidence ?? 'ev', confidence: conf, coach_line: extra.coach ?? '' },
  rules: extra.rules ?? [],
});

const said = (actions) => actions.filter((a) => a.type === 'say').map((a) => a.text);

function fresh(mode = 'crew') {
  const { session, actions } = createSession({ playbook: PB, worker: 'Ana', mode, now: 0, id: 's1' });
  return { s: session, first: actions };
}

test('starting a session activates step 1 and says its instruction', () => {
  const { s, first } = fresh();
  assert.equal(s.steps[0].status, 'active');
  assert.deepEqual(said(first), ['Do A']);
  assert.equal(s.job.need, 36);
});

test('trainee mode also explains why', () => {
  const { first } = fresh('trainee');
  assert.deepEqual(said(first), ['Do A', 'Because A matters']);
});

test('a confident pass says pass line, advances, and says next instruction', () => {
  const { s } = fresh();
  const a = applyAnalysis(s, res('pass'), { now: 1000 });
  assert.deepEqual(said(a), ['A good', 'Do B']);
  assert.equal(s.steps[0].status, 'pass');
  assert.equal(s.steps[0].helped, false);
  assert.equal(s.current, 1);
});

test('a low-confidence pass does not advance', () => {
  const { s } = fresh();
  applyAnalysis(s, res('pass', 0.3), { now: 1000 });
  assert.equal(s.current, 0);
});

test('a fail says the templated fail line, marks helped, and is rate limited', () => {
  const { s } = fresh();
  assert.deepEqual(said(applyAnalysis(s, res('fail'), { now: 1000 })), ['A needs 36']);
  assert.deepEqual(said(applyAnalysis(s, res('fail'), { now: 3000 })), []);
  assert.deepEqual(said(applyAnalysis(s, res('fail'), { now: 13000 })), ['A needs 36']);
  assert.equal(s.steps[0].fails, 3);
  assert.equal(s.steps[0].helped, true);
});

test('fail with no fail_say falls back to the model coaching line', () => {
  const { s } = fresh();
  applyAnalysis(s, res('pass'), { now: 1000 });
  const a = applyAnalysis(s, res('fail', 0.9, { stepId: 'b', coach: 'Move left' }), { now: 2000 });
  assert.deepEqual(said(a), ['Move left']);
});

test('unclear frames give a hint only after a streak', () => {
  const { s } = fresh();
  let out = [];
  for (let i = 1; i <= 3; i++) out.push(...said(applyAnalysis(s, res('unclear'), { now: i * 2000 })));
  assert.deepEqual(out, []);
  assert.deepEqual(said(applyAnalysis(s, res('unclear'), { now: 8000 })), ['Show me A']);
});

test('results for a step that is no longer current are ignored', () => {
  const { s } = fresh();
  applyCommand(s, 'next', { now: 500 });
  const a = applyAnalysis(s, res('fail', 0.9, { stepId: 'a' }), { now: 1000 });
  assert.deepEqual(said(a), []);
  assert.equal(s.current, 1);
});

test('watch rules fire with cooldown and respect step scope', () => {
  const { s } = fresh();
  const hit = { rules: [{ id: 'gloves', evidence: 'bare hand' }, { id: 'b-only', evidence: 'x' }] };
  assert.deepEqual(said(applyAnalysis(s, res('unclear', 0.9, hit), { now: 1000 })), ['Gloves on']);
  assert.deepEqual(said(applyAnalysis(s, res('unclear', 0.9, hit), { now: 5000 })), []);
  assert.deepEqual(said(applyAnalysis(s, res('unclear', 0.9, hit), { now: 32000 })), ['Gloves on']);
});

test('unknown rule ids from the model are ignored', () => {
  const { s } = fresh();
  const a = applyAnalysis(s, res('unclear', 0.9, { rules: [{ id: 'made-up', evidence: 'x' }] }), { now: 1000 });
  assert.deepEqual(said(a), []);
});

test('a rule with no say line uses the model line, then the evidence', () => {
  const { s } = fresh();
  addRule(s, { id: 'ladder', when: 'a ladder', say: '' });
  const a = applyAnalysis(s, res('unclear', 0.9, { rules: [{ id: 'ladder', evidence: 'ladder at wall', line: 'Watch the ladder' }] }), { now: 1000 });
  assert.deepEqual(said(a), ['Watch the ladder']);
  const b = applyAnalysis(fresh().s, res('unclear'), { now: 1 });
  assert.deepEqual(said(b), []);
});

test('rules can be added, replaced and removed live', () => {
  const { s } = fresh();
  addRule(s, { id: 'gloves', when: 'no gloves', say: 'Gloves!' });
  assert.equal(s.rules.filter((r) => r.id === 'gloves').length, 1);
  assert.equal(s.rules.find((r) => r.id === 'gloves').say, 'Gloves!');
  removeRule(s, 'gloves');
  assert.equal(s.rules.find((r) => r.id === 'gloves'), undefined);
  assert.throws(() => addRule(s, { id: 'x', when: '' }));
});

test('commands: repeat, help, next, back', () => {
  const { s } = fresh();
  assert.deepEqual(said(applyCommand(s, 'repeat', { now: 20000 })), ['Do A']);
  assert.deepEqual(said(applyCommand(s, 'help', { now: 40000 })), ['Because A matters', 'Show me A']);
  assert.equal(s.steps[0].helped, true);
  applyCommand(s, 'next', { now: 50000 });
  assert.equal(s.steps[0].status, 'skipped');
  assert.equal(s.current, 1);
  applyCommand(s, 'back', { now: 60000 });
  assert.equal(s.current, 0);
  assert.equal(s.steps[0].status, 'active');
  assert.throws(() => applyCommand(s, 'dance', { now: 1 }), /unknown command/);
});

test('repeat is not swallowed by the duplicate filter', () => {
  const { s } = fresh();
  assert.deepEqual(said(applyCommand(s, 'repeat', { now: 100 })), ['Do A']);
});

test('finishing the last step completes the session', () => {
  const { s } = fresh();
  applyAnalysis(s, res('pass'), { now: 1000 });
  const a = applyAnalysis(s, res('pass', 0.9, { stepId: 'b' }), { now: 2000 });
  assert.equal(s.status, 'complete');
  assert.ok(said(a).some((t) => /complete/i.test(t)));
  assert.deepEqual(said(applyAnalysis(s, res('fail', 0.9, { stepId: 'b' }), { now: 3000 })), []);
});

test('supervisor messages interrupt, bypass dedupe, and mark the step helped', () => {
  const { s } = fresh();
  const a1 = supervisorSay(s, 'Stop', { now: 1000, from: 'Mike' });
  const a2 = supervisorSay(s, 'Stop', { now: 1100, from: 'Mike' });
  const sayAction = a1.find((a) => a.type === 'say');
  assert.equal(sayAction.interrupt, true);
  assert.equal(sayAction.source, 'supervisor');
  assert.equal(said(a2).length, 1);
  assert.equal(s.steps[0].helped, true);
  assert.throws(() => supervisorSay(s, '   ', { now: 1 }));
});

test('supervisor can pass a step on the tech\'s behalf', () => {
  const { s } = fresh();
  const a = applyCommand(s, 'approve', { now: 1000, by: 'supervisor' });
  assert.equal(s.steps[0].status, 'pass');
  assert.equal(s.steps[0].approvedBy, 'supervisor');
  assert.deepEqual(said(a), ['A good', 'Do B']);
});

test('training record counts unaided passes per skill across sessions', () => {
  const one = fresh().s;
  applyAnalysis(one, res('pass'), { now: 1 });
  const two = createSession({ playbook: PB, worker: 'Ana', mode: 'trainee', now: 0, id: 's2' }).session;
  applyAnalysis(two, res('fail'), { now: 1 });
  applyAnalysis(two, res('pass'), { now: 2 });
  const other = createSession({ playbook: PB, worker: 'Bo', mode: 'crew', now: 0, id: 's3' }).session;
  const rec = trainingRecord([one, two, other], 'Ana', { signOffAfter: 2 });
  const a = rec.skills.find((k) => k.stepId === 'a');
  assert.equal(a.attempts, 2);
  assert.equal(a.passes, 2);
  assert.equal(a.unaided, 1);
  assert.equal(a.signedOff, false);
  assert.equal(rec.sessions, 2);
});
