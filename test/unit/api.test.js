import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { start } from '../../server/index.js';
import { MockProvider } from '../../server/providers/mock.js';

const JPEG = fs.readFileSync(path.resolve('test/fixtures/frame.jpg'));
const PB_DIR = path.resolve('playbooks');
let srv, base, mock, dataDir, pbDir;

const r = (status, conf = 0.9, extra = {}) => ({ scene: extra.scene || 'scene', step: { status, evidence: extra.evidence || 'ev', confidence: conf, coach_line: '' }, rules: extra.rules || [] });

async function api(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (Buffer.isBuffer(body)) {
    init.body = body;
    init.headers['content-type'] ??= 'image/jpeg';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(base + url, init);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

function wsClient(query) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?${query}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  const waitFor = (pred, ms = 3000) => {
    const hit = msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('timed out waiting for ws message')), ms);
    });
  };
  return { ws, msgs, waitFor, open: new Promise((res) => ws.once('open', res)) };
}

async function boot() {
  srv = await start({ port: 0, httpsPort: -1, dataDir, playbookDir: pbDir, provider: mock, quiet: true });
  base = `http://127.0.0.1:${srv.port}`;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-data-'));
  pbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-pb-'));
  for (const f of fs.readdirSync(PB_DIR)) fs.copyFileSync(path.join(PB_DIR, f), path.join(pbDir, f));
  mock = new MockProvider({ delayMs: 0, walkthrough: false });
  await boot();
});
after(async () => srv.close());
beforeEach(() => mock.reset());

const newSession = async (extra = {}) => (await api('POST', '/api/sessions', { playbookId: 'battery-install', worker: 'Ana Ruiz', ...extra })).body;

test('health reports the model and client counts', async () => {
  const { status, body } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.model.provider, 'mock');
  assert.ok(body.clients);
});

test('session creation validates input', async () => {
  assert.equal((await api('POST', '/api/sessions', { playbookId: 'nope', worker: 'A' })).status, 400);
  assert.equal((await api('POST', '/api/sessions', { playbookId: 'battery-install', worker: '  ' })).status, 400);
  const bad = await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  const s = await newSession({ job: { clearance_in: 48, 'bad key!': 1, obj: { x: 1 } } });
  assert.equal(s.job.clearance_in, 48);
  assert.equal(s.job['bad key!'], undefined);
  assert.equal(s.job.obj, undefined);
  assert.equal(s.steps[0].status, 'active');
});

test('frame -> model -> speech reaches the glasses, and everything is logged', async () => {
  const s = await newSession();
  const g = wsClient(`role=glasses&session=${s.id}`);
  const d = wsClient('role=dashboard');
  await Promise.all([g.open, d.open]);
  await g.waitFor((m) => m.type === 'snapshot');

  mock.enqueue(r('pass', 0.95, { evidence: 'tape reads 40 in' }));
  const up = await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  assert.equal(up.status, 200);
  assert.equal(up.body.analyzing, true);
  await srv.service.idle(s.id);

  const pass = await g.waitFor((m) => m.type === 'say' && m.say.text === 'Clearance is good.');
  assert.equal(pass.sessionId, s.id);
  await g.waitFor((m) => m.type === 'say' && /level on top/.test(m.say.text));
  await d.waitFor((m) => m.type === 'frame' && m.sessionId === s.id);
  await d.waitFor((m) => m.type === 'session' && m.session.id === s.id && m.session.current === 1);

  // the model saw the image and the right step
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].bytes, JPEG.length);
  assert.match(mock.calls[0].user, /id="clearance"/);
  assert.match(mock.calls[0].user, /36 inches or more/);

  const ev = (await api('GET', `/api/sessions/${s.id}/events`)).body.events.map((e) => e.type);
  for (const t of ['session.started', 'step.enter', 'frame', 'analysis', 'say', 'step.pass']) assert.ok(ev.includes(t), `missing ${t}`);

  const img = await api('GET', `/api/sessions/${s.id}/frames/${up.body.frameId}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.body.length, JPEG.length);
  assert.equal((await api('GET', `/api/sessions/${s.id}/frames/latest`)).status, 200);
  assert.equal((await api('GET', `/api/sessions/${s.id}/frames/../../etc`)).status, 404);

  const detail = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.equal(detail.steps[0].status, 'pass');
  assert.equal(detail.steps[0].frameId, up.body.frameId);
  assert.equal(detail.live.glassesOnline, true);
  g.ws.close();
  d.ws.close();
});

test('bad uploads are rejected cleanly', async () => {
  const s = await newSession();
  assert.equal((await api('POST', `/api/sessions/${s.id}/frames`, Buffer.from('not an image at all'))).status, 415);
  assert.equal((await api('POST', `/api/sessions/${s.id}/frames`, Buffer.alloc(9 * 1024 * 1024, 1))).status, 413);
  assert.equal((await api('POST', `/api/sessions/nope/frames`, JPEG)).status, 404);
  assert.equal((await api('POST', `/api/sessions/${s.id}/frames`, undefined)).status, 400);
  assert.equal(mock.calls.length, 0);
});

test('a JSON data-URL frame also works', async () => {
  const s = await newSession();
  mock.enqueue(r('unclear', 0.2));
  const up = await api('POST', `/api/sessions/${s.id}/frames`, { image: 'data:image/jpeg;base64,' + JPEG.toString('base64') });
  assert.equal(up.status, 200);
  await srv.service.idle(s.id);
  assert.equal(mock.calls.length, 1);
});

test('frames arriving while the model is busy: only the newest waiting frame is analyzed', async () => {
  const s = await newSession();
  for (let i = 0; i < 6; i++) mock.enqueue(async () => { await new Promise((res) => setTimeout(res, 120)); return r('unclear', 0.3); });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await api('POST', `/api/sessions/${s.id}/frames`, JPEG)).body);
  await srv.service.idle(s.id);
  assert.equal(ids[0].analyzing, true);
  assert.ok(ids.slice(1).every((x) => x.queued));
  assert.equal(mock.calls.length, 2, 'first frame + newest queued frame');
  const analyzed = (await api('GET', `/api/sessions/${s.id}/events`)).body.events.filter((e) => e.type === 'analysis').map((e) => e.frameId);
  assert.deepEqual(analyzed, [ids[0].frameId, ids[4].frameId]);
});

test('model errors never crash the crew flow; three in a row get one spoken heads-up', async () => {
  const s = await newSession();
  const g = wsClient(`role=glasses&session=${s.id}`);
  await g.open;
  for (let i = 0; i < 4; i++) {
    mock.enqueue(new Error('Gemini 503: overloaded'));
    await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
    await srv.service.idle(s.id);
  }
  const trouble = g.msgs.filter((m) => m.type === 'say' && /trouble seeing/.test(m.say.text));
  assert.equal(trouble.length, 1);
  const detail = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.equal(detail.modelErrors, 4);
  assert.match(detail.live.lastError, /overloaded/);
  mock.enqueue(r('pass'));
  await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  await srv.service.idle(s.id);
  const after = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.equal(after.current, 1);
  assert.equal(after.live.lastError, null);
  g.ws.close();
});

test('supervisor message is pushed to the glasses as an interrupt', async () => {
  const s = await newSession();
  const g = wsClient(`role=glasses&session=${s.id}`);
  await g.open;
  assert.equal((await api('POST', `/api/sessions/${s.id}/messages`, { text: 'Hold on, wrong wall.', from: 'Mike' })).status, 200);
  const m = await g.waitFor((x) => x.type === 'say' && x.say.source === 'supervisor');
  assert.equal(m.say.text, 'Hold on, wrong wall.');
  assert.equal(m.say.interrupt, true);
  assert.equal((await api('POST', `/api/sessions/${s.id}/messages`, { text: '' })).status, 400);
  g.ws.close();
});

test('plain-English rules apply to the very next frame', async () => {
  const s = await newSession();
  const rule = (await api('POST', `/api/sessions/${s.id}/rules`, { text: 'When you see a ladder against the wall, say check your footing' })).body;
  assert.equal(rule.say, 'Check your footing');
  mock.enqueue(r('unclear', 0.3, { rules: [{ id: rule.id, evidence: 'ladder visible' }] }));
  await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  await srv.service.idle(s.id);
  assert.match(mock.calls[0].user, new RegExp(`id="${rule.id}": a ladder against the wall`));
  const said = (await api('GET', `/api/sessions/${s.id}/events`)).body.events.filter((e) => e.type === 'say').map((e) => e.text);
  assert.ok(said.includes('Check your footing'));

  const second = (await api('POST', `/api/sessions/${s.id}/rules`, { text: 'When you see a ladder against the wall, say ladder again' })).body;
  assert.notEqual(second.id, rule.id, 'same wording gets a new id instead of silently replacing');
  assert.equal((await api('DELETE', `/api/sessions/${s.id}/rules/${rule.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/sessions/${s.id}/rules/${rule.id}`)).status, 404);
  assert.equal((await api('POST', `/api/sessions/${s.id}/rules`, { when: '' })).status, 400);
});

test('editing the current step changes what the model checks next frame', async () => {
  const s = await newSession();
  const res = await api('PATCH', `/api/sessions/${s.id}/steps/clearance`, { check: 'The tape reads at least 48 inches.' });
  assert.equal(res.status, 200);
  mock.enqueue(r('unclear', 0.3));
  await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  await srv.service.idle(s.id);
  assert.match(mock.calls[0].user, /CHECK: The tape reads at least 48 inches\./);
  assert.equal((await api('PATCH', `/api/sessions/${s.id}/steps/clearance`, { check: ' ' })).status, 400);
  assert.equal((await api('PATCH', `/api/sessions/${s.id}/steps/nope`, { check: 'x' })).status, 404);
});

test('voice commands and supervisor approval', async () => {
  const s = await newSession();
  assert.equal((await api('POST', `/api/sessions/${s.id}/commands`, { command: 'dance' })).status, 400);
  let d = (await api('POST', `/api/sessions/${s.id}/commands`, { command: 'next' })).body;
  assert.equal(d.steps[0].status, 'skipped');
  d = (await api('POST', `/api/sessions/${s.id}/commands`, { command: 'approve', by: 'supervisor' })).body;
  assert.equal(d.steps[1].status, 'pass');
  assert.equal(d.steps[1].approvedBy, 'supervisor');
});

test('a finished job keeps footage but stops analysis', async () => {
  const s = await newSession();
  await api('POST', `/api/sessions/${s.id}/end`);
  const up = await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  assert.equal(up.status, 200);
  assert.equal(up.body.analyzing, false);
  assert.equal(mock.calls.length, 0);
});

test('playbook edits: invalid YAML is refused, valid YAML updates live sessions', async () => {
  const s = await newSession();
  const orig = (await api('GET', '/api/playbooks/battery-install')).body.source;
  const bad = await api('PUT', '/api/playbooks/battery-install', { source: orig.replace('steps:', 'stepz:') });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /steps/);
  const good = await api('PUT', '/api/playbooks/battery-install', { source: orig.replace('Measure from the battery', 'Measure carefully from the battery') });
  assert.equal(good.status, 200);
  const d = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.match(d.steps[0].say, /Measure carefully/);
  await api('PUT', '/api/playbooks/battery-install', { source: orig });
});

test('training record by worker', async () => {
  const s = await newSession({ worker: 'Trainee Tom', mode: 'trainee' });
  mock.enqueue(r('pass'));
  await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  await srv.service.idle(s.id);
  const t = (await api('GET', `/api/workers/${encodeURIComponent('Trainee Tom')}/training`)).body;
  assert.equal(t.sessions, 1);
  assert.equal(t.skills.find((k) => k.stepId === 'clearance').unaided, 1);
  const w = (await api('GET', '/api/workers')).body.workers;
  assert.ok(w.some((x) => x.name === 'Trainee Tom'));
});

test('unknown API routes 404 as JSON', async () => {
  const res = await api('GET', '/api/nothing');
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test('restart: sessions, events and footage survive and the job continues', async () => {
  const s = await newSession({ worker: 'Restart Rita' });
  mock.enqueue(r('pass'));
  const up = (await api('POST', `/api/sessions/${s.id}/frames`, JPEG)).body;
  await srv.service.idle(s.id);
  await srv.close();
  await boot();
  const d = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.equal(d.worker, 'Restart Rita');
  assert.equal(d.current, 1);
  assert.equal((await api('GET', `/api/sessions/${s.id}/frames/${up.frameId}`)).status, 200);
  const evs = (await api('GET', `/api/sessions/${s.id}/events`)).body.events;
  assert.ok(evs.length > 3);
  mock.enqueue(r('pass'));
  const up2 = (await api('POST', `/api/sessions/${s.id}/frames`, JPEG)).body;
  assert.ok(Number(up2.frameId) > Number(up.frameId), 'frame numbering continues, never overwrites');
  await srv.service.idle(s.id);
  assert.equal((await api('GET', `/api/sessions/${s.id}`)).body.current, 2);
  const evs2 = (await api('GET', `/api/sessions/${s.id}/events`)).body.events;
  assert.ok(evs2[evs2.length - 1].seq > evs[evs.length - 1].seq);
});

// ---- regressions from the code review ----

test('say ids never repeat after a server restart (the phone would skip them)', async () => {
  const s = await newSession({ worker: 'Id Check' });
  const before = (await api('GET', `/api/sessions/${s.id}/events`)).body.events.filter((e) => e.type === 'say').map((e) => e.sayId);
  await srv.close();
  await boot();
  await api('POST', `/api/sessions/${s.id}/messages`, { text: 'After restart.' });
  const after = (await api('GET', `/api/sessions/${s.id}/events`)).body.events.filter((e) => e.type === 'say').map((e) => e.sayId);
  const fresh = after.filter((x) => !before.includes(x));
  assert.equal(fresh.length, 1);
  assert.equal(new Set(after).size, after.length, 'all say ids unique');
});

test('a junk WebSocket upgrade request does not crash the server', async () => {
  const net = await import('node:net');
  await new Promise((resolve) => {
    const sock = net.connect(srv.port, '127.0.0.1', () => sock.write('GET //[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'));
    sock.on('close', resolve);
    sock.on('error', resolve);
  });
  assert.equal((await api('GET', '/api/health')).status, 200);
});

test('a failure while recording an error does not leave the crew stuck', async () => {
  const s = await newSession({ worker: 'Stuck Check' });
  const orig = srv.store.appendEvent.bind(srv.store);
  let boom = 0;
  srv.store.appendEvent = (id, ev) => {
    if (ev.type === 'model.error' && boom++ === 0) throw new Error('disk full');
    return orig(id, ev);
  };
  mock.enqueue(new Error('model down'));
  await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
  await srv.service.idle(s.id);
  srv.store.appendEvent = orig;
  mock.enqueue(r('pass'));
  const up = (await api('POST', `/api/sessions/${s.id}/frames`, JPEG)).body;
  assert.equal(up.analyzing, true, 'next frame is analyzed, not queued forever');
  await srv.service.idle(s.id);
  assert.equal((await api('GET', `/api/sessions/${s.id}`)).body.current, 1);
});

test('jobs idle for a long time are closed; active ones are not', async () => {
  const idle = await newSession({ worker: 'Idle Ida' });
  const busy = await newSession({ worker: 'Busy Bea' });
  srv.store.get(idle.id).updatedAt = Date.now() - 31 * 60_000;
  srv.service.sweepIdle();
  assert.equal((await api('GET', `/api/sessions/${idle.id}`)).body.status, 'ended');
  assert.equal((await api('GET', `/api/sessions/${busy.id}`)).body.status, 'active');
});

test('frames sent after a job ends are not stored', async () => {
  const s = await newSession();
  await api('POST', `/api/sessions/${s.id}/end`);
  const up = (await api('POST', `/api/sessions/${s.id}/frames`, JPEG)).body;
  assert.equal(up.frameId, null);
  assert.equal((await api('GET', `/api/sessions/${s.id}/frames`)).body.frames.length, 0);
});

test('large JSON frame uploads are accepted (not cut off by the small JSON limit)', async () => {
  const s = await newSession();
  mock.enqueue(r('unclear', 0.2));
  const big = Buffer.concat([JPEG, Buffer.alloc(400 * 1024)]);
  const up = await api('POST', `/api/sessions/${s.id}/frames`, { image: big.toString('base64') });
  assert.equal(up.status, 200);
  await srv.service.idle(s.id);
});

test('events can be fetched as a filtered tail (dashboard backfill)', async () => {
  const s = await newSession();
  for (let i = 0; i < 3; i++) {
    mock.enqueue(r('unclear', 0.2));
    await api('POST', `/api/sessions/${s.id}/frames`, JPEG);
    await srv.service.idle(s.id);
  }
  const tail = (await api('GET', `/api/sessions/${s.id}/events?tail=2`)).body.events;
  assert.equal(tail.length, 2);
  const frames = (await api('GET', `/api/sessions/${s.id}/events?types=frame`)).body.events;
  assert.equal(frames.length, 3);
  assert.ok(frames.every((e) => e.type === 'frame'));
  const d = (await api('GET', `/api/sessions/${s.id}`)).body;
  assert.ok(d.lastFrameAt > Date.now() - 10_000);
});

test('playbook errors read like English', async () => {
  const orig = (await api('GET', '/api/playbooks/system-check')).body.source;
  const bad = await api('PUT', '/api/playbooks/system-check', { source: orig.replace(/title: Thumbs up/, 'title: ""') });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /steps\.0\.title: can't be empty/);
});
