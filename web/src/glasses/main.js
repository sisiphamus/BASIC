import { Speaker } from './speaker.js';
import { LiveSocket } from './socket.js';
import { FrameLoop, openSource, listCameras } from './capture.js';
import { VoiceCommands } from './voice.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) {
    try {
      return localStorage.getItem(`ba.${k}`);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`ba.${k}`, v);
    } catch {
      /* private mode */
    }
  },
};

const state = {
  session: null,
  sessionId: null,
  stream: null,
  loop: null,
  socket: null,
  voice: null,
  wakeLock: null,
  sendVideo: true,
  speakHere: true,
  lastLatency: null,
  endArmed: false,
};

const speaker = new Speaker({
  onStart: (item) => showSaid(item),
});

function show(screen) {
  for (const id of ['setup', 'live', 'done']) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

function formError(msg) {
  const el = $('form-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// ---- setup ----------------------------------------------------------------

async function initSetup() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  $('insecure').hidden = window.isSecureContext || local;
  $('worker').value = store.get('worker') || '';
  if (!navigator.mediaDevices?.getDisplayMedia || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    $('source').querySelector('option[value="screen"]').hidden = true;
  }
  const savedSource = store.get('source');
  if (savedSource && [...$('source').options].some((o) => o.value === savedSource && !o.hidden)) $('source').value = savedSource;

  try {
    const { playbooks } = await api('GET', '/api/playbooks');
    const sel = $('playbook');
    sel.innerHTML = '';
    for (const p of playbooks) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.title;
      sel.append(o);
    }
    const saved = store.get('playbook');
    if (saved && playbooks.some((p) => p.id === saved)) sel.value = saved;
    if (!playbooks.length) formError('No jobs are set up on the server yet.');
  } catch (e) {
    formError(`Can't reach the Base Academy server. ${e.message}`);
  }

  // other cameras (e.g. a USB or virtual camera carrying the glasses feed)
  const cams = await listCameras();
  if (cams.length > 1 && cams.every((c) => c.label)) {
    for (const c of cams) {
      const o = document.createElement('option');
      o.value = `device:${c.deviceId}`;
      o.textContent = c.label;
      $('source').append(o);
    }
  }

  loadJoinList();
  offerResume();
}

async function loadJoinList() {
  try {
    const { sessions } = await api('GET', '/api/sessions');
    const active = sessions.filter((s) => s.status === 'active');
    const list = $('join-list');
    list.innerHTML = '';
    for (const s of active.slice(0, 8)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${s.worker} · ${s.playbookTitle}`;
      b.addEventListener('click', () => joinAsSpeaker(s.id));
      li.append(b);
      list.append(li);
    }
    $('join').hidden = active.length === 0;
  } catch {
    $('join').hidden = true;
  }
}

$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  formError('');
  const worker = $('worker').value.trim();
  if (!worker) {
    formError('Enter your name so your supervisor knows who is on the job.');
    $('worker').focus();
    return;
  }
  const playbookId = $('playbook').value;
  if (!playbookId) return formError('Pick a job.');
  const mode = new FormData(e.target).get('mode');
  const source = $('source').value;
  state.speakHere = $('speak-here').checked;
  state.sendVideo = true;
  store.set('worker', worker);
  store.set('playbook', playbookId);
  store.set('source', source);

  const btn = $('start');
  btn.disabled = true;
  btn.textContent = 'Starting';
  // Unlock audio now, inside the tap. Browsers block speech that isn't started by a tap.
  if (state.speakHere) speaker.unlock();
  try {
    const kind = source.startsWith('device:') ? 'device' : source;
    state.stream = await openSource(kind, kind === 'device' ? source.slice(7) : undefined);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Start job';
    return formError(cameraMessage(err));
  }
  try {
    const session = await api('POST', '/api/sessions', { playbookId, worker, mode });
    await goLive(session);
  } catch (err) {
    stopStream();
    formError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start job';
  }
});

function cameraMessage(err) {
  if (err.message === 'insecure') return 'The camera needs the https:// address. Ask whoever runs the server for the phone link.';
  if (err.name === 'NotAllowedError') return 'Camera permission was blocked. Allow the camera for this site in your browser settings, then try again.';
  if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') return 'No camera found for that choice. Pick another video source.';
  if (err.name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.';
  return err.message || 'Could not open the camera.';
}

async function joinAsSpeaker(id) {
  formError('');
  speaker.unlock('Speaker connected.');
  state.speakHere = true;
  state.sendVideo = false;
  try {
    const session = await api('GET', `/api/sessions/${id}`);
    await goLive(session);
  } catch (e) {
    formError(e.message);
  }
}

// ---- live -----------------------------------------------------------------

async function goLive(session) {
  state.sessionId = session.id;
  state.session = session;
  state.endArmed = false;
  history.replaceState(null, '', `/glasses?session=${session.id}${state.sendVideo ? '' : '&role=speaker'}`);
  show('live');
  render();

  $('video-wrap').hidden = !state.sendVideo;
  if (state.sendVideo && state.stream) {
    const v = $('video');
    v.srcObject = state.stream;
    await v.play().catch(() => {});
    state.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      $('video-stats').textContent = 'Video stopped. Tap End job and start again to reconnect the camera.';
      state.loop?.stop();
    });
    state.loop = new FrameLoop({
      video: v,
      url: `/api/sessions/${session.id}/frames`,
      intervalMs: session.frameIntervalMs || 2000,
      onSent: () => renderStats(),
      onError: (e) => renderStats(e.message),
    });
    state.loop.start();
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.socket?.close();
  state.socket = new LiveSocket(`${proto}://${location.host}/ws?role=glasses&session=${session.id}`, {
    onMessage: onSocket,
    onState: (s) => {
      const el = $('conn');
      el.dataset.state = s;
      el.textContent = s === 'online' ? 'Live' : s === 'reconnecting' ? 'Reconnecting' : 'Connecting';
    },
  });

  if (!state.speakHere) speaker.setMuted(true);
  setupVoice();
  keepAwake();
}

function onSocket(msg) {
  if (msg.type === 'snapshot') {
    const s = msg.sessions.find((x) => x.id === state.sessionId);
    if (s) {
      state.session = s;
      render();
    }
    for (const say of msg.says || []) {
      if (state.speakHere) speaker.say(say);
      else showSaid(say);
    }
  } else if (msg.type === 'session' && msg.session.id === state.sessionId) {
    state.session = msg.session;
    state.lastLatency = msg.session.live?.lastLatencyMs ?? state.lastLatency;
    render();
  } else if (msg.type === 'say' && msg.sessionId === state.sessionId) {
    if (state.speakHere) speaker.say(msg.say);
    else showSaid(msg.say);
  }
}

const SOURCE_LABEL = { supervisor: 'Supervisor', rule: 'Heads up', hint: 'Tip', step: 'Coach', system: 'Base Academy' };

function showSaid(item) {
  const box = $('said');
  box.hidden = false;
  box.dataset.source = item.source;
  $('said-from').textContent = item.source === 'supervisor' ? `Supervisor` : SOURCE_LABEL[item.source] || 'Coach';
  $('said-text').textContent = item.text;
}

function render() {
  const s = state.session;
  if (!s) return;
  $('live-worker').textContent = s.worker;
  $('live-job').textContent = `${s.playbookTitle}${s.mode === 'trainee' ? ' · Trainee' : ''}`;
  if (s.status !== 'active') return renderDone(s);
  const cur = s.steps[s.current];
  $('step-count').textContent = `Step ${s.current + 1} of ${s.steps.length}`;
  $('step-title').textContent = cur.title;
  if (!$('instruction').dataset.step || $('instruction').dataset.step !== cur.id) {
    $('instruction').dataset.step = cur.id;
    $('instruction').textContent = cur.say;
  }
  const bar = $('step-bar');
  bar.innerHTML = '';
  s.steps.forEach((st, i) => {
    const li = document.createElement('li');
    li.dataset.status = i === s.current ? 'active' : st.status;
    bar.append(li);
  });
  renderStats();
}

function renderStats(err) {
  const el = $('video-stats');
  if (!state.loop) return;
  const lat = state.session?.live?.lastLatencyMs;
  const modelErr = state.session?.live?.lastError;
  const parts = [`${state.loop.sent} frames sent`];
  if (lat) parts.push(`checked in ${(lat / 1000).toFixed(1)} s`);
  if (err) parts.push(`upload problem: ${err}`);
  else if (modelErr) parts.push('model is having trouble, supervisor notified');
  el.textContent = parts.join(' · ');
  el.dataset.bad = err || modelErr ? 'true' : 'false';
}

function renderDone(s) {
  teardown(false);
  show('done');
  const passed = s.steps.filter((x) => x.status === 'pass').length;
  $('done-summary').textContent = s.status === 'complete' ? `${passed} of ${s.steps.length} steps checked. Your supervisor has the record.` : 'This job was ended.';
  const ol = $('done-steps');
  ol.innerHTML = '';
  for (const st of s.steps) {
    const li = document.createElement('li');
    li.dataset.status = st.status;
    const label = st.status === 'pass' ? (st.approvedBy ? 'Approved' : 'Passed') : st.status === 'skipped' ? 'Skipped' : 'Not done';
    li.innerHTML = `<span></span><em></em>`;
    li.querySelector('span').textContent = st.title;
    li.querySelector('em').textContent = label;
    ol.append(li);
  }
}

async function sendCommand(cmd) {
  if (!state.sessionId) return;
  try {
    await api('POST', `/api/sessions/${state.sessionId}/commands`, { command: cmd });
  } catch (e) {
    showSaid({ source: 'system', text: `Couldn't send "${cmd}": ${e.message}` });
  }
}

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => sendCommand(b.dataset.cmd)));

$('mute').addEventListener('click', () => {
  const m = !speaker.muted;
  speaker.setMuted(m);
  $('mute').setAttribute('aria-pressed', String(m));
  $('mute').textContent = m ? 'Voice muted' : 'Mute voice';
});

function setupVoice() {
  if (state.voice) return;
  state.voice = new VoiceCommands({
    onCommand: (cmd) => sendCommand(cmd),
    onHeard: (t) => ($('heard').textContent = `Heard: "${t}"`),
    isSpeaking: () => speaker.speaking,
    onState: (s) => {
      const b = $('listen');
      b.setAttribute('aria-pressed', String(s === 'listening'));
      b.textContent = s === 'listening' ? 'Voice commands on' : s === 'blocked' ? 'Mic blocked' : 'Voice commands off';
    },
  });
  if (!state.voice.supported) {
    $('listen').hidden = true;
    return;
  }
  // Off unless the crew turned it on before: Android chimes on every listen restart, and on
  // iPhones listening can fight the speech output. Test it on the actual phone, then turn it on.
  if (store.get('voice') === 'on') state.voice.start();
}

$('listen').addEventListener('click', () => {
  if (!state.voice?.supported) return;
  if (state.voice.wanted) {
    state.voice.stop();
    store.set('voice', 'off');
  } else {
    state.voice.start();
    store.set('voice', 'on');
  }
});

$('end').addEventListener('click', async () => {
  // Two taps instead of a confirm() popup, which would freeze the page.
  if (!state.endArmed) {
    state.endArmed = true;
    $('end').textContent = 'Tap again to end the job';
    setTimeout(() => {
      state.endArmed = false;
      $('end').textContent = 'End job';
    }, 4000);
    return;
  }
  try {
    const s = await api('POST', `/api/sessions/${state.sessionId}/end`);
    state.session = s;
    renderDone(s);
  } catch (e) {
    showSaid({ source: 'system', text: e.message });
  }
});

$('again').addEventListener('click', () => {
  teardown(true);
  history.replaceState(null, '', '/glasses');
  show('setup');
  loadJoinList();
});

function stopStream() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

function teardown(all) {
  state.loop?.stop();
  state.loop = null;
  stopStream();
  state.voice?.stop();
  state.voice = null;
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
  if (all) {
    state.socket?.close();
    state.socket = null;
    state.session = null;
    state.sessionId = null;
    speaker.setMuted(false);
    $('instruction').dataset.step = '';
    $('said').hidden = true;
  }
}

async function keepAwake() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    /* not supported or denied; the crew may need to keep the screen on manually */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.sessionId && !state.wakeLock) keepAwake();
});

// After a reload mid-job, offer one tap to pick up where the crew left off
// (a tap is needed to turn the camera and the voice back on).
async function offerResume() {
  const params = new URLSearchParams(location.search);
  const id = params.get('session');
  if (!id) return;
  let s;
  try {
    s = await api('GET', `/api/sessions/${id}`);
  } catch {
    history.replaceState(null, '', '/glasses');
    return;
  }
  if (s.status !== 'active') {
    history.replaceState(null, '', '/glasses');
    return;
  }
  const speakerOnly = params.get('role') === 'speaker';
  const box = $('resume');
  box.hidden = false;
  $('resume-text').textContent = `${s.worker}, ${s.playbookTitle}, step ${s.current + 1} of ${s.steps.length}.`;
  const btn = $('resume-btn');
  btn.textContent = speakerOnly ? 'Resume speaking' : 'Resume job';
  btn.onclick = async () => {
    formError('');
    if (speakerOnly) return joinAsSpeaker(id);
    speaker.unlock('Picking up where you left off.');
    state.speakHere = $('speak-here').checked;
    state.sendVideo = true;
    const source = $('source').value;
    try {
      const kind = source.startsWith('device:') ? 'device' : source;
      state.stream = await openSource(kind, kind === 'device' ? source.slice(7) : undefined);
      await goLive(s);
    } catch (err) {
      formError(cameraMessage(err));
    }
  };
}

initSetup();

// For automated tests.
window.__ba = { state, speaker };
