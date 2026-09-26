#!/usr/bin/env node
// BASIC live telemetry console.
//   node scripts/console.js                     live, from http://localhost:3000
//   node scripts/console.js --server http://localhost:3005
//   node scripts/console.js --replay data/traces/<session>.jsonl [--speed 2]
// Shows every frame, prompt, model response, control decision and spoken line as it happens.

import fs from 'node:fs';
import WebSocket from 'ws';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const SERVER = String(opt('server', 'http://localhost:3000')).replace(/\/$/, '');
const REPLAY = opt('replay', null);
const SPEED = Number(opt('speed', 1));
const PROMPT_LINES = Number(opt('prompt-lines', 8));

// ---- terminal ---------------------------------------------------------------
const E = '\x1b[';
const c = {
  reset: `${E}0m`, dim: `${E}2m`, bold: `${E}1m`,
  cyan: `${E}38;5;45m`, blue: `${E}38;5;75m`, green: `${E}38;5;78m`, yellow: `${E}38;5;221m`,
  orange: `${E}38;5;208m`, red: `${E}38;5;203m`, magenta: `${E}38;5;177m`, gray: `${E}38;5;245m`,
  white: `${E}38;5;255m`, hivis: `${E}38;5;220m`, bgbar: `${E}48;5;235m`,
};
const VERBOSE = args.includes('--verbose');
const HEADER_ROWS = 4;
let cols = process.stdout.columns || 140;
let rows = process.stdout.rows || 45;
const out = (s) => process.stdout.write(s);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const trunc = (s, n) => (strip(s).length > n ? strip(s).slice(0, n - 1) + '…' : s);

function setup() {
  cols = process.stdout.columns || 140;
  rows = process.stdout.rows || 45;
  out(`${E}2J${E}H${E}?25l`);
  out(`${E}${HEADER_ROWS + 1};${rows}r`);
  out(`${E}${rows};1H`);
  drawHeader();
}
process.stdout.on('resize', setup);
process.on('exit', () => out(`${E}r${E}?25h${E}0m\n`));
process.on('SIGINT', () => process.exit(0));

const st = {
  link: 'connecting', model: '—', job: '—', step: '—', stepNo: 0, stepCount: 0,
  frames: 0, bytes: 0, lat: [], pass: 0, fail: 0, unclear: 0, spoken: 0, rules: 0, cost: 0, firstFrameAt: null, lastFrameAt: null,
};
const spark = (arr) => {
  const t = '▁▂▃▄▅▆▇█';
  if (!arr.length) return '';
  const a = arr.slice(-32);
  const max = Math.max(...a), min = Math.min(...a);
  return a.map((v) => t[Math.min(7, Math.floor(((v - min) / Math.max(1, max - min)) * 7))]).join('');
};
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)] : 0);

function drawHeader() {
  const hz = st.firstFrameAt && st.frames > 1 ? (st.frames - 1) / ((st.lastFrameAt - st.firstFrameAt) / 1000) : 0;
  const dot = st.link === 'live' || st.link === 'replay' ? c.green + '●' : c.orange + '●';
  const l1 = `${c.hivis}${c.bold}BASIC${c.reset}  ${c.gray}perception telemetry  ${dot}${c.gray} ${st.link}   ${st.model}   RB Meta 0KD9 · DAT 1.0 · HFP${c.reset}`;
  const l2 = `${c.white}${st.job}${c.reset}   ${c.hivis}step ${st.stepNo}/${st.stepCount} ${st.step}${c.reset}`;
  const l3 = `${c.gray}frames ${c.white}${st.frames}${c.gray} · ${hz.toFixed(2)} Hz · ${(st.bytes / 1e6).toFixed(1)} MB   infer p50 ${c.white}${(pct(st.lat, 0.5) / 1000).toFixed(2)}s${c.gray} p95 ${c.white}${(pct(st.lat, 0.95) / 1000).toFixed(2)}s ${c.gray}${spark(st.lat)}   ${c.green}${st.pass}${c.gray}/${c.red}${st.fail}${c.gray}/${c.yellow}${st.unclear}${c.gray} verdicts   ${st.spoken} spoken   ${st.rules} rule hits${c.reset}`;
  const l4 = `${c.gray}${'─'.repeat(cols)}${c.reset}`;
  out(`${E}s`);
  [l1, l2, l3, l4].forEach((l, i) => out(`${E}${i + 1};1H${E}2K${trunc(l, cols + 300)}`));
  out(`${E}u`);
}
setInterval(drawHeader, 1000);

const ts = (t) => c.gray + new Date(t).toISOString().slice(11, 23) + c.reset;
const K = (label) => `${c.gray}${pad(label, 8)}${c.reset}`;
const V = (s) => `${c.white}${s}${c.reset}`;
const D = (s) => `${c.gray}${s}${c.reset}`;
function line(s) {
  out(`${E}${rows};1H\n${trunc(s, cols + 300)}`);
}
const IND = ' '.repeat(24);
function block(text) {
  for (const l of String(text).split('\n')) line(`${IND}${c.dim}${trunc(l, cols - IND.length - 1)}${c.reset}`);
}
const verdictColor = (s) => (s === 'pass' ? c.green : s === 'fail' ? c.red : c.yellow);

function render(r) {
  const T = ts(r.t);
  switch (r.kind) {
    case 'frame.in':
      st.frames += 1;
      st.bytes += r.bytes;
      st.lastFrameAt = Date.parse(r.t);
      st.firstFrameAt ??= st.lastFrameAt;
      line(`${T}  ${K('frame')}${V('#' + r.frameId)}  ${D(`${r.width || '?'}×${r.height || '?'} ${r.megapixels ?? ''}MP  q${r.jpegQuality ?? '?'}  ${(r.bytes / 1024).toFixed(0)} KB  Δt ${r.intervalMs ?? '—'} ms  sha ${r.sha256.slice(0, 8)}  ${r.queue.split(',')[0]}${r.supersededTotal ? `  superseded ${r.supersededTotal}` : ''}`)}`);
      break;
    case 'vision.stats':
      line(`${T}  ${K('image')}${D(`luma ${r.lumaMean} (${r.exposure})  contrast ${r.contrast}  sharpness ${r.sharpness}  rgb ${r.avgRGB.join('/')}  dhash ${r.dhash}  Δscene ${r.sceneDelta ?? '—'}/64 ${r.sceneChange}  ${r.statsMs} ms`)}`);
      break;
    case 'system.heartbeat':
      line(`${T}  ${K('system')}${D(`rss ${r.rssMB} MB  heap ${r.heapMB} MB  load ${r.load1}/${r.cpus}  glasses ${r.glassesOnline ? 'online' : 'offline'}  sockets ${r.clients ? r.clients.glasses + 'g/' + r.clients.dashboards + 'd' : '?'}  frames ${r.frames}  analyses ${r.analyses}  errors ${r.modelErrors}  avg ${r.rollingAvgMs ?? '—'} ms  model ${r.modelBusy ? 'busy' : 'idle'}`)}`);
      break;
    case 'vision.qr':
      line(`${T}  ${K('qr')}${r.result ? c.green + r.result + c.reset : D('no code resolved')}  ${D(r.ms + ' ms')}`);
      break;
    case 'model.request':
      if (r.model && r.model !== 'sonnet') st.model = r.model;
      line(`${T}  ${K('request')}${D(`${r.model} · ~${r.estImageTokens ?? '?'} img tok + ~${r.estPromptTokens ?? '?'} text tok · prompt ${r.promptChars} ch · rules [${Array.isArray(r.rulesActive) ? r.rulesActive.join(', ') : r.rulesActive}] · queued ${r.queueWaitMs ?? 0} ms · ${r.settings ? Object.entries(r.settings).map(([k, v]) => k + '=' + v).join(' ') : ''}`)}`);
      if (VERBOSE) block(String(r.prompt || ''));
      break;
    case 'model.response': {
      st.lat.push(r.latencyMs);
      if (r.costUsd) st.cost += r.costUsd;
      if (r.model) st.model = r.model;
      const s = r.parsed?.step || {};
      if (s.status === 'pass') st.pass += 1;
      else if (s.status === 'fail') st.fail += 1;
      else st.unclear += 1;
      const u = r.usage || {};
      const tok = u.input_tokens != null ? `in ${u.input_tokens}${u.cache_read_input_tokens ? '+' + u.cache_read_input_tokens + 'c' : ''} out ${u.output_tokens}` : u.promptTokenCount != null ? `in ${u.promptTokenCount} out ${u.candidatesTokenCount}` : '';
      line(`${T}  ${K('model')}${verdictColor(s.status)}${String(s.status).padEnd(8)}${c.reset}${V(Number(s.confidence).toFixed(2))}  ${D(`${(r.latencyMs / 1000).toFixed(2)}s  avg ${r.rollingAvgMs ?? '—'} ms  ${tok}${r.costUsd ? '  $' + r.costUsd.toFixed(4) : ''}  ${r.rawChars ?? '?'} ch`)}  ${D(s.evidence || '')}`);
      if (VERBOSE) block(JSON.stringify(r.parsed, null, 2));
      else line(`${IND}${c.dim}${trunc(JSON.stringify(r.parsed), cols - IND.length - 1)}${c.reset}`);
      break;
    }
    case 'engine.decision':
      line(`${T}  ${K('control')}${D(`${r.confidence} ${r.gatePassed ? '≥' : '<'} ${r.gate}`)}  ${r.advanced ? c.hivis + `advance → step ${r.stepAfter}` + c.reset : D('hold')}  ${D(`on step ${r.timeOnStepMs != null ? (r.timeOnStepMs / 1000).toFixed(1) + 's' : '—'}  unclear streak ${r.unclearStreak ?? 0}  fails ${r.failsOnStep ?? 0}  ${r.stepsPassed}/${r.stepsTotal} passed`)}${r.rulesHit.length ? `  ${c.red}${r.rulesHit.join(', ')}${c.reset}` : ''}`);
      break;
    case 'speech.out':
      st.spoken += 1;
      line(`${T}  ${K('speak')}${r.source === 'supervisor' ? c.hivis : c.white}“${r.text}”${c.reset}  ${D(`${r.source} · ${r.words ?? '?'} words · ~${r.estSpeechMs ? (r.estSpeechMs / 1000).toFixed(1) + 's' : '?'} · HFP`)}`);
      break;
    case 'engine.step.enter':
      st.step = r.title;
      line(`${T}  ${K('step')}${c.hivis}${r.title}${c.reset}`);
      break;
    case 'engine.step.pass':
      line(`${T}  ${K('passed')}${c.green}${r.title}${c.reset}${r.approvedBy ? D(`  approved by ${r.approvedBy}`) : ''}`);
      break;
    case 'engine.rule.fired':
      st.rules += 1;
      line(`${T}  ${K('rule')}${c.red}${r.ruleId}${c.reset}  ${D(r.evidence || '')}`);
      break;
    case 'model.error':
      line(`${T}  ${K('error')}${c.red}${r.message}${c.reset}`);
      break;
    default:
      break;
  }
}

function onSession(s) {
  if (!s) return;
  st.job = `${s.job?.job_number || s.id.slice(0, 8)} · ${s.worker} · ${s.playbookTitle}`;
  st.stepNo = s.current + 1;
  st.stepCount = s.steps.length;
  st.step = s.steps[s.current]?.title || st.step;
}

// ---- sources -------------------------------------------------------------------
async function replay(file) {
  st.link = 'replay';
  const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let prev = null;
  for (const r of recs) {
    if (prev) await new Promise((res) => setTimeout(res, Math.min(4000, (Date.parse(r.t) - Date.parse(prev.t)) / SPEED)));
    if (r.kind === 'engine.step.enter') st.stepNo += 1;
    render(r);
    prev = r;
  }
  line(`${c.gray}── end of replay ──${c.reset}`);
}

function live() {
  const url = SERVER.replace(/^http/, 'ws') + '/ws?role=dashboard';
  let focus = null; // the crew with the most recent activity
  const connect = () => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      st.link = 'live';
      line(`${ts(Date.now())}  ${K('link')}${c.green}telemetry stream open${c.reset}  ${D(url)}`);
    });
    ws.on('message', (d) => {
      st.msgs += 1;
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
          onSession(act);
        }
      } else if (m.type === 'session') {
        if (!focus || m.session.id === focus || m.session.status === 'active') {
          focus = m.session.id;
          onSession(m.session);
        }
      } else if (m.type === 'trace') {
        if (!focus) focus = m.sessionId;
        if (m.sessionId === focus) render(m.trace);
      }
    });
    ws.on('close', () => {
      st.link = 'reconnecting';
      setTimeout(connect, 1500);
    });
    ws.on('error', () => {});
  };
  connect();
}

setup();
if (REPLAY) replay(REPLAY);
else live();
