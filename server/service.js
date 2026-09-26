// Glue: frames in -> model -> engine -> speech + events out. One analysis in flight per crew;
// if frames arrive faster than the model answers, only the newest waiting frame is kept.

import crypto from 'node:crypto';
import { createSession, applyAnalysis, applyCommand, supervisorSay, addRule, removeRule, refreshFromPlaybook, trainingRecord } from './engine.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt } from './prompt.js';
import { parseRuleText, ruleIdFrom } from './rule-text.js';
import { fillTemplate } from './playbooks.js';

const STALE_FRAME_MS = 8000;
const TROUBLE_LINE = "I'm having trouble seeing right now. Keep going carefully. Your supervisor can still see your feed.";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export class Service {
  constructor({ store, playbooks, provider, hub, log = () => {} }) {
    this.store = store;
    this.playbooks = playbooks;
    this.provider = provider;
    this.hub = hub;
    this.log = log;
    this.runtime = new Map();
    this.sayCounter = 0;
    this.bootId = crypto.randomBytes(3).toString('hex'); // say ids must never repeat across restarts
    playbooks.onChange((id) => this.onPlaybookChange(id));
    if (hub) hub.snapshot = (sessionId) => this.snapshot(sessionId);
  }

  rt(id) {
    let r = this.runtime.get(id);
    if (!r) {
      r = { busy: false, pending: null, consecutiveErrors: 0, lastTroubleAt: -Infinity, lastError: null, chain: Promise.resolve(), lastLatencyMs: null };
      this.runtime.set(id, r);
    }
    return r;
  }

  must(id) {
    const s = this.store.get(id);
    if (!s) throw new HttpError(404, 'no such session');
    return s;
  }

  publicSession(s) {
    const r = this.runtime.get(s.id);
    const frames = this.store.frames(s.id);
    const vars = { ...s.job, worker: s.worker };
    return {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      endedAt: s.endedAt,
      status: s.status,
      worker: s.worker,
      mode: s.mode,
      playbookId: s.playbookId,
      playbookTitle: s.playbookTitle,
      frameIntervalMs: s.frameIntervalMs,
      job: s.job,
      current: s.current,
      steps: s.steps.map((st, i) => ({
        id: st.id,
        title: st.title,
        status: st.status,
        fails: st.fails,
        helped: st.helped,
        approvedBy: st.approvedBy,
        skippedBy: st.skippedBy || null,
        startedAt: st.startedAt,
        finishedAt: st.finishedAt,
        evidence: st.evidence,
        frameId: st.frameId,
        say: fillTemplate(s.stepDefs[i].say, vars),
        check: fillTemplate(s.stepDefs[i].check, vars),
        why: fillTemplate(s.stepDefs[i].why, vars),
      })),
      rules: s.rules,
      frames: frames.length,
      lastFrameId: frames[frames.length - 1] || null,
      lastFrameAt: s.lastFrameAt || null,
      lastScene: s.lastScene,
      analyses: s.analyses,
      modelErrors: s.modelErrors,
      live: {
        glassesOnline: this.hub ? this.hub.glassesOnline(s.id) : false,
        analyzing: Boolean(r?.busy),
        lastError: r?.lastError || null,
        lastLatencyMs: r?.lastLatencyMs ?? null,
      },
    };
  }

  snapshot(sessionId) {
    if (sessionId) {
      const s = this.store.get(sessionId);
      // Lines spoken in the last few seconds, so a page that connects late (or reconnects)
      // still hears the current instruction. The page skips ids it already played.
      const since = Date.now() - 15_000;
      const says = s
        ? this.store
            .eventsFor(sessionId)
            .filter((e) => e.type === 'say' && e.ts >= since)
            .map((e) => ({ id: e.sayId, text: e.text, source: e.source, interrupt: false, stepId: e.stepId, ts: e.ts }))
        : [];
      return { type: 'snapshot', sessions: s ? [this.publicSession(s)] : [], says };
    }
    return { type: 'snapshot', sessions: this.store.all().map((s) => this.publicSession(s)) };
  }

  publishSession(s) {
    this.hub?.publish(s.id, { type: 'session', session: this.publicSession(s) });
  }

  dispatch(s, actions) {
    for (const a of actions) {
      if (a.type === 'say') {
        const say = { id: `${this.bootId}-${s.id.slice(0, 8)}-${++this.sayCounter}`, text: a.text, source: a.source, interrupt: Boolean(a.interrupt), stepId: a.stepId, ts: Date.now() };
        const ev = this.store.appendEvent(s.id, { type: 'say', ...say, sayId: say.id });
        this.hub?.publish(s.id, { type: 'say', sessionId: s.id, say });
        this.hub?.publish(s.id, { type: 'event', sessionId: s.id, event: ev });
      } else if (a.type === 'event') {
        const { type, event, ...rest } = a;
        const ev = this.store.appendEvent(s.id, { type: event, ...rest });
        this.hub?.publish(s.id, { type: 'event', sessionId: s.id, event: ev });
      }
    }
    this.store.save(s.id);
    this.publishSession(s);
  }

  // ---- sessions ------------------------------------------------------------

  startSession({ playbookId, worker, mode, job } = {}) {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) throw new HttpError(400, `unknown playbook "${playbookId}"`);
    const name = String(worker || '').trim();
    if (!name) throw new HttpError(400, 'worker name is required');
    if (name.length > 60) throw new HttpError(400, 'worker name is too long');
    const cleanJob = {};
    for (const [k, v] of Object.entries(job && typeof job === 'object' ? job : {})) {
      if (/^[a-z0-9_]{1,40}$/i.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) cleanJob[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
    const { session, actions } = createSession({ playbook, worker: name, mode, job: cleanJob, id: crypto.randomUUID() });
    this.store.add(session);
    this.dispatch(session, [{ type: 'event', event: 'session.started', worker: session.worker, playbookId: session.playbookId, mode: session.mode }, ...actions]);
    this.log(`session ${session.id.slice(0, 8)} started: ${session.worker} / ${session.playbookId} (${session.mode})`);
    return this.publicSession(session);
  }

  endSession(id) {
    const s = this.must(id);
    if (s.status === 'active') {
      s.status = 'ended';
      s.endedAt = Date.now();
      this.dispatch(s, [{ type: 'event', event: 'session.ended' }]);
    }
    return this.publicSession(s);
  }

  /** Jobs nobody has touched for a while (rehearsals, a phone left in a bag) get closed. */
  sweepIdle(maxIdleMs = 30 * 60_000) {
    const now = Date.now();
    for (const s of this.store.all()) {
      if (s.status === 'active' && now - s.updatedAt > maxIdleMs && !this.hub?.glassesOnline(s.id)) {
        s.status = 'ended';
        s.endedAt = now;
        this.dispatch(s, [{ type: 'event', event: 'session.ended', reason: 'idle' }]);
        this.log(`session ${s.id.slice(0, 8)} ended after ${Math.round((now - s.updatedAt) / 60000)} idle minutes`);
      }
    }
  }

  // ---- frames --------------------------------------------------------------

  ingestFrame(id, buf) {
    const s = this.must(id);
    const mime = sniffImage(buf);
    if (!mime) throw new HttpError(415, 'frame must be a JPEG, PNG or WebP image');
    if (s.status !== 'active') return { frameId: null, analyzing: false, reason: `session is ${s.status}` };
    // evidence pictures on the checklist are never pruned
    const keep = new Set(s.steps.map((st) => st.frameId).filter(Boolean));
    const frameId = this.store.saveFrame(id, buf, keep);
    s.frames += 1;
    s.updatedAt = Date.now();
    s.lastFrameAt = s.updatedAt;
    const ev = this.store.appendEvent(id, { type: 'frame', frameId, bytes: buf.length });
    this.hub?.publish(id, { type: 'frame', sessionId: id, frameId, ts: ev.ts });
    const r = this.rt(id);
    const job = { frameId, buf, mime, at: Date.now() };
    if (r.busy) {
      r.pending = job; // newest wins
      return { frameId, analyzing: false, queued: true };
    }
    r.busy = true;
    r.chain = this.analyzeLoop(s, job).catch((e) => this.log(`analysis loop error (${id.slice(0, 8)}): ${e.message}`));
    this.publishSession(s);
    return { frameId, analyzing: true };
  }

  async analyzeLoop(s, first) {
    const r = this.rt(s.id);
    let job = first;
    try {
      while (job) {
        await this.analyzeOne(s, job);
        const next = r.pending;
        r.pending = null;
        job = next && Date.now() - next.at < STALE_FRAME_MS && s.status === 'active' ? next : null;
      }
    } finally {
      // whatever happened, the crew must not stay stuck on "busy"
      r.busy = false;
      r.pending = null;
      try {
        this.store.save(s.id);
        this.publishSession(s);
      } catch (e) {
        this.log(`could not save session ${s.id.slice(0, 8)}: ${e.message}`);
      }
    }
  }

  async analyzeOne(s, job) {
    const r = this.rt(s.id);
    const stepId = s.steps[s.current].id;
    const started = Date.now();
    try {
      const out = await this.provider.analyze({ image: job.buf, mime: job.mime, system: SYSTEM_PROMPT, user: buildUserPrompt(s), schema: RESPONSE_SCHEMA, sessionId: s.id });
      const result = out.result || {};
      result.step = { ...(result.step || {}), id: stepId };
      r.consecutiveErrors = 0;
      r.lastError = null;
      r.lastLatencyMs = Date.now() - started;
      const ev = this.store.appendEvent(s.id, {
        type: 'analysis',
        frameId: job.frameId,
        stepId,
        status: result.step.status,
        evidence: result.step.evidence,
        confidence: result.step.confidence,
        scene: result.scene,
        rules: result.rules || [],
        model: out.model,
        latencyMs: r.lastLatencyMs,
      });
      this.hub?.publish(s.id, { type: 'event', sessionId: s.id, event: ev });
      const actions = applyAnalysis(s, result, { now: Date.now(), frameId: job.frameId });
      this.dispatch(s, actions);
    } catch (e) {
      r.consecutiveErrors += 1;
      s.modelErrors += 1;
      r.lastError = String(e.message || e).slice(0, 300);
      const ev = this.store.appendEvent(s.id, { type: 'model.error', frameId: job.frameId, message: r.lastError });
      this.hub?.publish(s.id, { type: 'event', sessionId: s.id, event: ev });
      this.log(`model error (${s.id.slice(0, 8)}): ${r.lastError}`);
      const actions = [];
      if (r.consecutiveErrors >= 3 && Date.now() - r.lastTroubleAt > 60_000) {
        r.lastTroubleAt = Date.now();
        actions.push({ type: 'say', text: TROUBLE_LINE, source: 'system', interrupt: false, stepId });
      }
      this.dispatch(s, actions);
    }
  }

  /** Resolves when the crew's analysis queue is empty. Used by tests and shutdown. */
  async idle(id) {
    const r = this.rt(id);
    while (r.busy) await r.chain;
  }

  // ---- crew + supervisor actions -------------------------------------------

  command(id, command, by = 'crew') {
    const s = this.must(id);
    let actions;
    try {
      actions = applyCommand(s, command, { now: Date.now(), by });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    this.dispatch(s, actions);
    return this.publicSession(s);
  }

  message(id, text, from) {
    const s = this.must(id);
    let actions;
    try {
      actions = supervisorSay(s, text, { now: Date.now(), from: String(from || 'Supervisor').slice(0, 40) });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    this.dispatch(s, actions);
    return { ok: true };
  }

  upsertRule(id, body = {}) {
    const s = this.must(id);
    let input = body;
    if (typeof body.text === 'string') input = { ...parseRuleText(body.text), steps: body.steps, cooldown_s: body.cooldown_s };
    if (!input.when || !String(input.when).trim()) throw new HttpError(400, 'a rule needs a "when" condition');
    const id0 = input.id || uniqueRuleId(s, ruleIdFrom(input.when));
    let rule;
    try {
      rule = addRule(s, { id: id0, when: input.when, say: input.say || '', cooldown_s: input.cooldown_s ?? 30, steps: Array.isArray(input.steps) ? input.steps : [] });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    this.dispatch(s, [{ type: 'event', event: 'rule.set', rule }]);
    return rule;
  }

  deleteRule(id, ruleId) {
    const s = this.must(id);
    if (!removeRule(s, ruleId)) throw new HttpError(404, 'no such rule');
    this.dispatch(s, [{ type: 'event', event: 'rule.removed', ruleId }]);
    return { ok: true };
  }

  /** Change what the model checks for the current (or a named) step, live. */
  editStep(id, stepId, patch = {}) {
    const s = this.must(id);
    const i = s.stepDefs.findIndex((d) => d.id === stepId);
    if (i < 0) throw new HttpError(404, 'no such step');
    const allowed = ['say', 'check', 'pass_say', 'fail_say', 'hint', 'why'];
    const changes = {};
    for (const k of allowed) {
      if (typeof patch[k] === 'string') {
        const v = patch[k].trim();
        if ((k === 'say' || k === 'check') && !v) throw new HttpError(400, `${k} cannot be empty`);
        changes[k] = v.slice(0, 600);
      }
    }
    Object.assign(s.stepDefs[i], changes);
    this.dispatch(s, [{ type: 'event', event: 'step.edited', stepId, changes }]);
    return this.publicSession(s);
  }

  onPlaybookChange(playbookId) {
    const pb = this.playbooks.get(playbookId);
    if (!pb) return;
    for (const s of this.store.all()) {
      if (s.playbookId === playbookId && s.status === 'active') {
        refreshFromPlaybook(s, pb);
        this.dispatch(s, [{ type: 'event', event: 'playbook.updated' }]);
      }
    }
  }

  // ---- read models ---------------------------------------------------------

  workers() {
    const by = new Map();
    for (const s of this.store.all()) {
      const k = s.worker.toLowerCase();
      const w = by.get(k) || { name: s.worker, sessions: 0, active: 0, lastSeen: 0 };
      w.sessions += 1;
      if (s.status === 'active') w.active += 1;
      w.lastSeen = Math.max(w.lastSeen, s.updatedAt);
      by.set(k, w);
    }
    return [...by.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  training(name) {
    return trainingRecord(this.store.all(), name);
  }
}

function uniqueRuleId(s, base) {
  let id = base;
  let n = 2;
  while (s.rules.some((r) => r.id === id)) id = `${base}-${n++}`;
  return id;
}
