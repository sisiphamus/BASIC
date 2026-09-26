#!/usr/bin/env node
// Fake crews for the demo wall and for load tests. Each crew posts a frame every interval
// through the same API the glasses page uses.
//
//   npm run simulate                       4 crews against http://localhost:3000
//   npm run simulate -- --crews 8 --loop   keep restarting jobs forever
//   npm run simulate -- --images ./my-photos     use your own JPEGs
//
// Photos come from demo-frames/<job>/ by default. Files starting with a step number
// ("03-...") are sent while the crew is on that step, so a real model can pass them;
// "00-..." files are general site shots mixed in.
//
// With a real Gemini key the model will judge these images for real; with the mock model
// crews walk through their jobs on their own.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const SERVER = String(opt('server', process.env.SERVER || 'http://localhost:3000')).replace(/\/$/, '');
const CREWS = Number(opt('crews', 4));
const INTERVAL = Number(opt('interval', 2000));
const LOOP = Boolean(opt('loop', false));
const DURATION_S = Number(opt('duration', 0));
const PLAYBOOK = opt('playbook', null);
const IMAGES = opt('images', null);

const NAMES = ['Marcus Webb', 'Ana Ruiz', 'Tom Hale', 'Dee Okafor', 'Luis Carrillo', 'Priya Shah', 'Jake Moreno', 'Kim Tran', 'Sam Ortiz', 'Riley Hayes', 'Omar Haddad', 'Grace Lin'];
const ADDRESSES = ['2305 Goldsmith St, Houston', '118 Pawnee Ave, Austin', '4410 Rosedale Ave, Austin', '903 W Mary St, Austin', '7702 Cooper Ln, Austin', '2201 Bissonnet St, Houston', '51 Oak Hollow Dr, Round Rock', '1809 Palma Plaza, Austin'];

function readDir(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
  return files.map((f) => ({ step: /^(\d+)-/.test(f) ? Number(f.match(/^(\d+)-/)[1]) : null, data: fs.readFileSync(path.join(dir, f)) }));
}

/** Photos for a job: --images dir, else demo-frames/<job>, else the test fixture. */
function imagesFor(playbookId) {
  const dirs = IMAGES ? [path.resolve(String(IMAGES))] : [path.resolve('demo-frames', playbookId), path.resolve('test/fixtures')];
  for (const d of dirs) {
    const imgs = readDir(d);
    if (imgs.length) return imgs;
  }
  throw new Error(`no .jpg files for ${playbookId}`);
}

function pick(images, stepNo, n) {
  const forStep = images.filter((i) => i.step === stepNo);
  const general = images.filter((i) => i.step === 0 || i.step === null);
  const pool = forStep.length && (n % 4 !== 3 || !general.length) ? forStep : general.length ? general : images;
  return pool[n % pool.length].data;
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(SERVER + url, { method, body, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${data.error || res.status}`);
  return data;
}

const stats = { frames: 0, errors: 0, jobs: 0, completed: 0, started: Date.now() };

async function crew(i, playbooks) {
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
  do {
    const pb = PLAYBOOK || playbooks[i % playbooks.length];
    const mode = i % 3 === 2 ? 'trainee' : 'crew';
    const s = await api('POST', '/api/sessions', JSON.stringify({ playbookId: pb, worker: name, mode, job: { address: ADDRESSES[i % ADDRESSES.length] } }), { 'content-type': 'application/json' });
    stats.jobs += 1;
    const images = imagesFor(pb);
    let n = i; // stagger which image each crew starts on
    let stepNo = 1;
    for (;;) {
      await new Promise((r) => setTimeout(r, INTERVAL + Math.random() * 300));
      try {
        await api('POST', `/api/sessions/${s.id}/frames`, pick(images, stepNo, n++), { 'content-type': 'image/jpeg' });
        stats.frames += 1;
      } catch (e) {
        stats.errors += 1;
        console.error(`[${name}] ${e.message}`);
      }
      const cur = await api('GET', `/api/sessions/${s.id}`).catch(() => null);
      if (cur) stepNo = cur.current + 1;
      if (!cur || cur.status !== 'active') {
        if (cur?.status === 'complete') stats.completed += 1;
        break;
      }
      if (DURATION_S && Date.now() - stats.started > DURATION_S * 1000) return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  } while (LOOP && !(DURATION_S && Date.now() - stats.started > DURATION_S * 1000));
}

const { playbooks } = await api('GET', '/api/playbooks');
const ids = playbooks.map((p) => p.id).filter((id) => id !== 'system-check');
console.log(`Simulating ${CREWS} crews against ${SERVER} (every ${INTERVAL} ms${LOOP ? ', looping' : ''})`);
const ticker = setInterval(() => console.log(`frames ${stats.frames}  jobs ${stats.jobs}  completed ${stats.completed}  errors ${stats.errors}`), 10_000);
await Promise.all(Array.from({ length: CREWS }, (_, i) => crew(i, ids.length ? ids : playbooks.map((p) => p.id))));
clearInterval(ticker);
console.log(`done: frames ${stats.frames}  jobs ${stats.jobs}  completed ${stats.completed}  errors ${stats.errors}`);
process.exit(stats.errors ? 1 : 0);
