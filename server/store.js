// Everything a crew does is kept on disk so nothing is lost if the laptop sleeps or the server restarts.
//   data/sessions/<id>/session.json   current state
//   data/sessions/<id>/events.jsonl   append-only log (frames, analyses, speech, commands, supervisor notes)
//   data/sessions/<id>/frames/*.jpg   the footage

import fs from 'node:fs';
import path from 'node:path';

const MAX_EVENTS_IN_MEMORY = 5000;

export class Store {
  constructor(dir, { maxFramesPerSession = 3000 } = {}) {
    this.dir = path.join(dir, 'sessions');
    this.maxFrames = maxFramesPerSession;
    this.sessions = new Map();
    this.events = new Map();
    this.frameSeq = new Map();
    this.frameList = new Map();
    this.dirty = new Set();
    this.timer = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const id of fs.readdirSync(this.dir)) {
      const sdir = path.join(this.dir, id);
      try {
        const s = JSON.parse(fs.readFileSync(path.join(sdir, 'session.json'), 'utf8'));
        this.sessions.set(id, reviveSession(s));
        const evPath = path.join(sdir, 'events.jsonl');
        const evs = fs.existsSync(evPath)
          ? fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
              try {
                return [JSON.parse(l)];
              } catch {
                return []; // a torn last line after a crash is fine to drop
              }
            })
          : [];
        this.events.set(id, evs.slice(-MAX_EVENTS_IN_MEMORY));
        const fdir = path.join(sdir, 'frames');
        const frames = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((f) => f.endsWith('.jpg')).sort() : [];
        this.frameList.set(id, frames.map((f) => f.replace(/\.jpg$/, '')));
        const last = frames.length ? Number(frames[frames.length - 1].slice(0, 6)) : 0;
        this.frameSeq.set(id, Number.isFinite(last) ? last : 0);
      } catch {
        /* skip a half-written session folder */
      }
    }
    return this;
  }

  sessionDir(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('bad session id');
    return path.join(this.dir, id);
  }

  add(session) {
    fs.mkdirSync(path.join(this.sessionDir(session.id), 'frames'), { recursive: true });
    this.sessions.set(session.id, session);
    this.events.set(session.id, []);
    this.frameSeq.set(session.id, 0);
    this.frameList.set(session.id, []);
    this.writeNow(session.id);
  }

  get(id) {
    return this.sessions.get(id);
  }

  all() {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Debounced save, so a burst of frames is one disk write. */
  save(id) {
    this.dirty.add(id);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const id of this.dirty) this.writeNow(id);
    this.dirty.clear();
  }

  writeNow(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    const file = path.join(this.sessionDir(id), 'session.json');
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, replacer));
    fs.renameSync(tmp, file);
  }

  appendEvent(id, event) {
    const list = this.events.get(id);
    if (!list) throw new Error('unknown session');
    const seq = list.length ? list[list.length - 1].seq + 1 : 1;
    const ev = { seq, ts: Date.now(), ...event };
    list.push(ev);
    if (list.length > MAX_EVENTS_IN_MEMORY) list.splice(0, list.length - MAX_EVENTS_IN_MEMORY);
    fs.appendFileSync(path.join(this.sessionDir(id), 'events.jsonl'), JSON.stringify(ev) + '\n');
    return ev;
  }

  eventsFor(id, since = 0) {
    return (this.events.get(id) || []).filter((e) => e.seq > since);
  }

  saveFrame(id, buf) {
    const seq = (this.frameSeq.get(id) || 0) + 1;
    this.frameSeq.set(id, seq);
    const frameId = `${String(seq).padStart(6, '0')}`;
    fs.writeFileSync(path.join(this.sessionDir(id), 'frames', `${frameId}.jpg`), buf);
    const list = this.frameList.get(id);
    list.push(frameId);
    while (list.length > this.maxFrames) {
      const old = list.shift();
      fs.rmSync(path.join(this.sessionDir(id), 'frames', `${old}.jpg`), { force: true });
    }
    return frameId;
  }

  frames(id) {
    return this.frameList.get(id) || [];
  }

  framePath(id, frameId) {
    if (!/^\d{6}$/.test(frameId)) return null;
    const p = path.join(this.sessionDir(id), 'frames', `${frameId}.jpg`);
    return fs.existsSync(p) ? p : null;
  }
}

// JSON cannot hold -Infinity; store it as null and revive it.
function replacer(key, value) {
  return value === -Infinity ? null : value;
}

function reviveSession(s) {
  for (const st of s.steps || []) {
    if (st.lastFailSaidAt === null) st.lastFailSaidAt = -Infinity;
    if (st.lastHintAt === null) st.lastHintAt = -Infinity;
  }
  return s;
}
