// The production model path end to end: phone page -> server -> GeminiProvider (auto model pick,
// real request shape) -> strict fake Gemini -> engine -> speech back on the page.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launch, bootServer, BROWSER_STUBS, waitFor } from './helpers.js';
import { startFakeGemini } from '../fake-gemini.js';
import { GeminiProvider } from '../../server/providers/gemini.js';

let browser, env, fake;

before(async () => {
  fake = await startFakeGemini({ rejectThinking: true });
  const provider = new GeminiProvider({ apiKey: 'test-key', baseUrl: fake.url, retryDelayMs: 10 });
  env = await bootServer({ intervalMs: 600, provider });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await env?.srv.close();
  await fake?.close();
});

test('a whole battery job runs through the real Gemini connector', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  await ctx.addInitScript(BROWSER_STUBS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${env.base}/glasses`);
  await page.waitForFunction(() => document.querySelectorAll('#playbook option').length > 0);
  await page.fill('#worker', 'Gemini Path');
  await page.selectOption('#playbook', 'battery-install');
  await page.click('#start');
  await page.waitForSelector('#done:not([hidden])', { timeout: 60000 });
  const spoken = await page.evaluate(() => window.__spoken);
  for (const line of ['Clearance is good.', 'Level looks good.', 'Connector is seated.', 'Both labels are on.', 'Battery is online. Nice work.']) {
    assert.ok(spoken.includes(line), `missing "${line}" in ${spoken.join(' | ')}`);
  }
  assert.ok(spoken.includes('Gloves on before you touch the connector.'), 'watch rule fired and used the playbook line');
  assert.deepEqual(errors, []);

  // auto-picked the newest plain flash model, not the TTS or lite ones
  assert.ok(fake.calls.length >= 10);
  assert.ok(fake.calls.every((c) => c.model === 'gemini-3.8-flash'));
  // fell back once from the rejected thinking setting and remembered it
  assert.equal(fake.calls.filter((c) => c.body.generationConfig.thinkingConfig).length, 1);
  const s = await (await fetch(`${env.base}/api/sessions/${await page.evaluate(() => window.__ba.state.sessionId)}`)).json();
  assert.equal(s.status, 'complete');
  assert.equal(s.modelErrors, 0);
  await ctx.close();
});

test('npm run check:gemini works against the API', async () => {
  const run = promisify(execFile);
  const { stdout } = await run('node', ['scripts/check-gemini.js'], { env: { ...process.env, GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: fake.url, GEMINI_MODEL: '' } });
  assert.match(stdout, /auto-pick: gemini-3\.8-flash/);
  assert.match(stdout, /Gemini works/);
  await assert.rejects(run('node', ['scripts/check-gemini.js'], { env: { ...process.env, GEMINI_API_KEY: 'wrong', GEMINI_BASE_URL: fake.url } }), /API key not valid/);
});
