import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, bootServer, BROWSER_STUBS, waitFor } from './helpers.js';

let browser, env;
const consoleErrors = [];

before(async () => {
  env = await bootServer({ intervalMs: 500 });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await env?.srv.close();
});

async function phone(url, { https = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: https, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(BROWSER_STUBS);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${url}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${url}: ${e.message}`));
  await page.goto(url);
  return { ctx, page };
}

const spoken = (page) => page.evaluate(() => window.__spoken.slice());
const api = async (method, url, body) => {
  const r = await fetch(env.base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

async function startJob(page, { worker = 'Ana Ruiz', playbook = 'battery-install', mode = 'crew' } = {}) {
  await page.waitForFunction(() => document.querySelectorAll('#playbook option').length > 0);
  await page.fill('#worker', worker);
  await page.selectOption('#playbook', playbook);
  await page.check(`input[name="mode"][value="${mode}"]`, { force: true });
  await page.click('#start');
  await page.waitForSelector('#live:not([hidden])');
  return page.evaluate(() => window.__ba.state.sessionId);
}

test('setup refuses to start without a name', async () => {
  const { ctx, page } = await phone(`${env.base}/glasses`);
  await page.waitForFunction(() => document.querySelectorAll('#playbook option').length > 0);
  await page.fill('#worker', '');
  await page.click('#start');
  await page.waitForSelector('#form-error:not([hidden])');
  assert.match(await page.textContent('#form-error'), /name/);
  await ctx.close();
});

test('full job on the phone page: camera frames -> checks -> spoken coaching -> done', async () => {
  const { ctx, page } = await phone(`${env.base}/glasses`);
  const id = await startJob(page);
  assert.ok(id);
  assert.equal(await page.textContent('#step-title'), 'Clearance from openings');
  assert.match(await page.textContent('#instruction'), /Measure from the battery/);

  // the very first instruction is spoken even though it was issued before the page connected
  await waitFor(async () => (await spoken(page)).some((t) => /^Measure from the battery/.test(t)), { what: 'first instruction spoken' });

  // the walkthrough model fails step 1 once, so the crew hears the fail line with the job's number filled in
  await waitFor(async () => (await spoken(page)).some((t) => /under 36 inches/.test(t)), { what: 'fail line' });
  await waitFor(async () => (await spoken(page)).includes('Clearance is good.'), { what: 'pass line' });

  // supervisor cuts in from the dashboard
  await api('POST', `/api/sessions/${id}/messages`, { text: 'Nice. Watch the hose on your left.', from: 'Mike' });
  await waitFor(async () => (await spoken(page)).includes('Nice. Watch the hose on your left.'), { what: 'supervisor line' });
  await page.waitForSelector('#said[data-source="supervisor"]');
  assert.ok((await page.evaluate(() => window.__cancels)) > 0, 'supervisor interrupts current speech');

  // hands-free "skip"
  // speak "next step" in a quiet moment (commands heard while the glasses talk are ignored on purpose)
  await page.waitForFunction(() => !window.__ba.speaker.speaking);
  await page.evaluate(() => window.__say('next step'));
  await waitFor(async () => (await api('GET', `/api/sessions/${id}/events`)).events.some((e) => e.type === 'command' && e.command === 'next'), { what: 'voice skip' });

  await page.waitForSelector('#done:not([hidden])', { timeout: 30000 });
  const words = await spoken(page);
  assert.ok(words.some((t) => /All steps (complete|done)/.test(t)), words.join(' | '));
  const s = await api('GET', `/api/sessions/${id}`);
  assert.equal(s.status, 'complete');
  assert.ok(s.frames >= 5, `frames: ${s.frames}`);
  assert.ok(s.steps.some((x) => x.status === 'skipped'));
  const events = (await api('GET', `/api/sessions/${id}/events`)).events;
  assert.ok(events.some((e) => e.type === 'command' && e.command === 'next'));
  assert.ok(events.some((e) => e.type === 'analysis' && e.status === 'fail'));

  // the uploaded frames are real JPEGs from the camera
  const img = await fetch(`${env.base}/api/sessions/${id}/frames/latest`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.ok((await img.arrayBuffer()).byteLength > 5000);
  await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/glasses-done.png`, fullPage: true });
  await ctx.close();
});

test('voice commands are ignored while the glasses are talking', async () => {
  const { ctx, page } = await phone(`${env.base}/glasses`);
  const id = await startJob(page, { playbook: 'system-check', worker: 'Echo Test' });
  const cur = (await api('GET', `/api/sessions/${id}`)).current;
  await page.evaluate(() => {
    window.__ba.speaker.lastSpokeAt = Date.now();
    window.__say('next');
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await api('GET', `/api/sessions/${id}`)).current, cur);
  await api('POST', `/api/sessions/${id}/end`);
  await ctx.close();
});

test('reload mid-job offers one-tap resume and keeps going', async () => {
  const { ctx, page } = await phone(`${env.base}/glasses`);
  const id = await startJob(page, { playbook: 'service-visit', worker: 'Reload Ray', mode: 'trainee' });
  await waitFor(async () => (await spoken(page)).some((t) => /fault code tells you/.test(t)), { what: 'trainee why line' });
  await page.reload();
  await page.waitForSelector('#resume:not([hidden])');
  assert.match(await page.textContent('#resume-text'), /Reload Ray/);
  const framesBefore = (await api('GET', `/api/sessions/${id}`)).frames;
  await page.click('#resume-btn');
  await page.waitForSelector('#live:not([hidden])');
  await waitFor(async () => (await api('GET', `/api/sessions/${id}`)).frames > framesBefore + 1, { what: 'frames after resume' });
  await api('POST', `/api/sessions/${id}/end`);
  await page.waitForSelector('#done:not([hidden])');
  assert.match(await page.textContent('#done-summary'), /ended/);
  await ctx.close();
});

test('split devices: laptop sends video, phone paired to glasses only speaks', async () => {
  const sender = await phone(`${env.base}/glasses`);
  const id = await startJob(sender.page, { playbook: 'system-check', worker: 'Split Sam' });
  await sender.page.evaluate(() => (window.__ba.speaker.muted = true));

  const speakerPhone = await phone(`${env.base}/glasses`);
  await speakerPhone.page.waitForSelector('#join:not([hidden])');
  await speakerPhone.page.click(`#join-list button:has-text("Split Sam")`);
  await speakerPhone.page.waitForSelector('#live:not([hidden])');
  assert.equal(await speakerPhone.page.isHidden('#video-wrap'), true, 'speaker device does not open a camera');
  await api('POST', `/api/sessions/${id}/messages`, { text: 'Speaker check.' });
  await waitFor(async () => (await spoken(speakerPhone.page)).includes('Speaker check.'), { what: 'speaker device hears it' });
  await api('POST', `/api/sessions/${id}/end`);
  await sender.ctx.close();
  await speakerPhone.ctx.close();
});

test('works over HTTPS on the LAN port (what a real phone uses)', async () => {
  const { ctx, page } = await phone(`${env.httpsBase}/glasses`, { https: true });
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const id = await startJob(page, { playbook: 'system-check', worker: 'Secure Sue' });
  await waitFor(async () => (await api('GET', `/api/sessions/${id}`)).frames > 1, { what: 'frames over https' });
  await waitFor(async () => (await page.textContent('#conn')) === 'Live', { what: 'wss connected' });
  await api('POST', `/api/sessions/${id}/end`);
  await ctx.close();
});

test('camera permission denied shows a fix, not a crash', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: [] });
  await ctx.addInitScript(BROWSER_STUBS);
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  const page = await ctx.newPage();
  await page.goto(`${env.base}/glasses`);
  await page.waitForFunction(() => document.querySelectorAll('#playbook option').length > 0);
  await page.fill('#worker', 'No Cam');
  await page.click('#start');
  await page.waitForSelector('#form-error:not([hidden])');
  assert.match(await page.textContent('#form-error'), /permission/i);
  await ctx.close();
});

test('no console errors on the phone page', () => {
  const real = consoleErrors.filter((e) => !/favicon/.test(e));
  assert.deepEqual(real, []);
});
