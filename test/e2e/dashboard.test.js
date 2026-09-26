// The stage demo, end to end: a crew on the phone page, a supervisor on the dashboard.
// Everything the supervisor does in the dashboard UI must reach the crew's glasses.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, bootServer, BROWSER_STUBS, waitFor } from './helpers.js';
import { MockProvider } from '../../server/providers/mock.js';

let browser, env, mock;
const dashErrors = [];

before(async () => {
  // A model that never passes anything on its own, so only the supervisor moves the job.
  mock = new MockProvider({ delayMs: 50, walkthrough: false });
  env = await bootServer({ intervalMs: 700, provider: mock });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await env?.srv.close();
});

test('supervisor dashboard drives the crew in the glasses', async () => {
  const crewCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  await crewCtx.addInitScript(BROWSER_STUBS);
  const phone = await crewCtx.newPage();
  await phone.goto(`${env.base}/glasses`);
  await phone.waitForFunction(() => document.querySelectorAll('#playbook option').length > 0);
  await phone.fill('#worker', 'Demo Dana');
  await phone.selectOption('#playbook', 'battery-install');
  await phone.click('#start');
  await phone.waitForSelector('#live:not([hidden])');
  const id = await phone.evaluate(() => window.__ba.state.sessionId);
  const spoken = () => phone.evaluate(() => window.__spoken.slice());

  const dashCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dash = await dashCtx.newPage();
  dash.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && dashErrors.push(m.text()));
  dash.on('pageerror', (e) => dashErrors.push(e.message));

  // floor shows the crew live, click through to the crew page
  await dash.goto(env.base + '/');
  await dash.getByText('Demo Dana').first().waitFor();
  await dash.getByText('Demo Dana').first().click();
  await dash.waitForURL(`**/sessions/${id}`);
  await dash.getByRole('heading', { name: 'Demo Dana' }).waitFor();

  // live picture arrives without reload
  await waitFor(async () => (await dash.locator(`img[src*="/api/sessions/${id}/frames/"]`).count()) > 0, { what: 'live frame on dashboard' });

  // talk into the glasses
  await dash.getByPlaceholder(/Message for/).fill('Hold the tape flat against the frame.');
  await dash.getByPlaceholder(/Message for/).press('Enter');
  await waitFor(async () => (await spoken()).includes('Hold the tape flat against the frame.'), { what: 'supervisor message in the glasses' });

  // add a plain-English rule; the model sees it on the next frame
  await dash.getByPlaceholder('When you see a ladder against the wall, say check your footing').fill('When you see a ladder, say check your footing');
  await dash.getByPlaceholder('When you see a ladder against the wall, say check your footing').press('Enter');
  await waitFor(() => mock.calls.some((c) => c.sessionId === id && /: a ladder$/m.test(c.user)), { what: 'rule reached the model prompt' });
  await dash.getByText('Check your footing').first().waitFor();

  // approve the step from the dashboard; the crew hears it and moves on
  await dash.getByRole('button', { name: 'Approve step' }).click();
  await waitFor(async () => (await phone.textContent('#step-title')) === 'Battery is level', { what: 'phone moved to step 2' });
  await waitFor(async () => (await spoken()).includes('Clearance is good.'), { what: 'pass line spoken' });

  // end the job from the dashboard (two-step confirm)
  await dash.getByRole('button', { name: 'End job' }).click();
  await dash.getByRole('button', { name: 'End job' }).click();
  await phone.waitForSelector('#done:not([hidden])', { timeout: 10000 });

  // proof packet
  await dash.goto(`${env.base}/report/${id}`);
  await dash.getByText('Clearance from openings').first().waitFor();
  await dash.getByText(/approved/i).first().waitFor();

  await crewCtx.close();
  await dashCtx.close();
});

test('dashboard pages load without console errors or warnings', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && dashErrors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => dashErrors.push(e.message));
  const { sessions } = await (await fetch(env.base + '/api/sessions')).json();
  for (const url of ['/', '/crew', `/crew/${encodeURIComponent('Demo Dana')}`, '/playbooks', '/playbooks/battery-install', `/sessions/${sessions[0].id}`, `/report/${sessions[0].id}`, '/nope']) {
    await page.goto(env.base + url);
    await page.waitForLoadState('networkidle');
  }
  await ctx.close();
  assert.deepEqual(dashErrors, []);
});
