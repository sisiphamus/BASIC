#!/usr/bin/env node
// Live glasses view for a kitty terminal window: shows each frame as it arrives, with a one-line caption.
//   node scripts/frames.js [--server http://localhost:3000]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const i = process.argv.indexOf('--server');
const SERVER = (i === -1 ? 'http://localhost:3000' : process.argv[i + 1]).replace(/\/$/, '');
const E = '\x1b[';
const gray = `${E}38;5;245m`, white = `${E}38;5;255m`, hivis = `${E}38;5;220m`, reset = `${E}0m`;
const col = { pass: `${E}38;5;78m`, fail: `${E}38;5;203m`, unclear: `${E}38;5;221m` };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-frames-'));
let focus = null;
let step = '';
let verdict = null;
let busy = false;
let next = null;

process.stdout.write(`${E}2J${E}?25l`);
process.on('exit', () => process.stdout.write(`${E}?25h${reset}\n`));
process.on('SIGINT', () => process.exit(0));

function caption(frameId) {
  const v = verdict ? `${col[verdict.status] || white}${verdict.status} ${Number(verdict.confidence).toFixed(2)}${reset}${gray}  ${verdict.evidence || ''}` : `${gray}analyzing`;
  const cols = process.stdout.columns || 120;
  const text = `${hivis}BASE ACADEMY${reset}${gray}  glasses view  #${frameId}  ${white}${step}${reset}${gray}  ${v}${reset}`;
  process.stdout.write(`${E}1;1H${E}2K${text.slice(0, cols + 60)}`);
}

async function show(frameId) {
  if (busy) {
    next = frameId;
    return;
  }
  busy = true;
  try {
    const res = await fetch(`${SERVER}/api/sessions/${focus}/frames/${frameId}`);
    if (res.ok) {
      const file = path.join(tmp, 'frame.jpg');
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const cols = process.stdout.columns || 120;
      const rows = process.stdout.rows || 40;
      caption(frameId);
      spawnSync('kitten', ['icat', '--clear', '--transfer-mode=file', '--align=center', `--place=${cols}x${rows - 2}@0x2`, file], { stdio: 'inherit' });
    }
  } catch {
    /* a missed frame is fine */
  }
  busy = false;
  if (next) {
    const n = next;
    next = null;
    show(n);
  }
}

function connect() {
  const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws?role=dashboard');
  ws.on('message', (d) => {
    let m;
    try {
      m = JSON.parse(String(d));
    } catch {
      return;
    }
    if (m.type === 'snapshot') {
      const act = m.sessions.filter((s) => s.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (act) {
        focus = act.id;
        step = `step ${act.current + 1}/${act.steps.length} ${act.steps[act.current].title}`;
        if (act.lastFrameId) show(act.lastFrameId);
      }
    } else if (m.type === 'session' && m.session.status === 'active') {
      if (!focus || m.session.id === focus || m.session.updatedAt > Date.now() - 5000) focus = m.session.id;
      if (m.session.id === focus) step = `step ${m.session.current + 1}/${m.session.steps.length} ${m.session.steps[m.session.current].title}`;
    } else if (m.type === 'frame') {
      if (!focus) focus = m.sessionId;
      if (m.sessionId === focus) show(m.frameId);
    } else if (m.type === 'trace' && m.sessionId === focus && m.trace.kind === 'model.response') {
      verdict = m.trace.parsed?.step || null;
    }
  });
  ws.on('close', () => setTimeout(connect, 1500));
  ws.on('error', () => {});
}
connect();
