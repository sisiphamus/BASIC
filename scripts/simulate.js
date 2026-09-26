#!/usr/bin/env node
// Fake crews for the demo wall and for load tests. Each crew posts a frame every interval
// through the same API the glasses page uses.
//
//   npm run simulate                       4 crews against http://localhost:3000
//   npm run simulate -- --crews 8 --loop   keep restarting jobs forever
//   npm run simulate -- --images ./demo-frames   cycle through your own JPEGs
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

function loadImages() {
  const dir = IMAGES ? path.resolve(String(IMAGES)) : path.resolve('test/fixtures');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
  if (!files.length) throw new Error(`no .jpg files in ${dir}`);
  return files.map((f) => fs.readFileSync(path.join(dir, f)));
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(SERVER + url, { method, body, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${data.error || res.status}`);
  return data;
}

const stats = { frames: 0, errors: 0, jobs: 0, completed: 0, started: Date.now() };

async function crew(i, images, playbooks) {
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
  do {
    const pb = PLAYBOOK || playbooks[i % playbooks.length];
    const mode = i % 3 === 2 ? 'trainee' : 'crew';
    const s = await api('POST', '/api/sessions', JSON.stringify({ playbookId: pb, worker: name, mode, job: { address: ADDRESSES[i % ADDRESSES.length] } }), { 'content-type': 'application/json' });
    stats.jobs += 1;
    let n = i; // stagger which image each crew starts on
    for (;;) {
      await new Promise((r) => setTimeout(r, INTERVAL + Math.random() * 300));
      try {
        await api('POST', `/api/sessions/${s.id}/frames`, images[n++ % images.length], { 'content-type': 'image/jpeg' });
        stats.frames += 1;
      } catch (e) {
        stats.errors += 1;
        console.error(`[${name}] ${e.message}`);
      }
      const cur = await api('GET', `/api/sessions/${s.id}`).catch(() => null);
      if (!cur || cur.status !== 'active') {
        if (cur?.status === 'complete') stats.completed += 1;
        break;
      }
      if (DURATION_S && Date.now() - stats.started > DURATION_S * 1000) return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  } while (LOOP && !(DURATION_S && Date.now() - stats.started > DURATION_S * 1000));
}

const images = loadImages();
const { playbooks } = await api('GET', '/api/playbooks');
const ids = playbooks.map((p) => p.id).filter((id) => id !== 'system-check');
console.log(`Simulating ${CREWS} crews against ${SERVER} (${images.length} images, every ${INTERVAL} ms${LOOP ? ', looping' : ''})`);
const ticker = setInterval(() => console.log(`frames ${stats.frames}  jobs ${stats.jobs}  completed ${stats.completed}  errors ${stats.errors}`), 10_000);
await Promise.all(Array.from({ length: CREWS }, (_, i) => crew(i, images, ids.length ? ids : playbooks.map((p) => p.id))));
clearInterval(ticker);
console.log(`done: frames ${stats.frames}  jobs ${stats.jobs}  completed ${stats.completed}  errors ${stats.errors}`);
process.exit(stats.errors ? 1 : 0);
