// Gemini vision connector (REST generateContent, no SDK so there is nothing to break on install).
// Built to survive a model or API change on the day: it picks a live model, drops optional
// settings the model rejects, falls through dead model names, and retries transient errors.

const DEFAULT_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

// Each level is a smaller request than the last. We step down on a 400 and remember per model.
const LEVELS = [
  { thinking: true, schema: true, json: true },
  { thinking: false, schema: true, json: true },
  { thinking: false, schema: false, json: true },
  { thinking: false, schema: false, json: false },
];

const EXCLUDE = /(tts|live|image|audio|embed|transcrib|native|robotics|computer|veo|imagen|omni|aqa|learnlm|gemma|lite|thinking|translate)/i;

export function pickModel(models) {
  const scored = [];
  for (const m of models || []) {
    const name = String(m.name || '').replace(/^models\//, '');
    if (!/flash/i.test(name) || EXCLUDE.test(name)) continue;
    if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
    const v = name.match(/gemini-(\d+)(?:\.(\d+))?/i);
    if (!v) continue;
    const version = Number(v[1]) + Number(v[2] || 0) / 100;
    const stable = /preview|exp|latest/i.test(name) ? 0 : 0.001;
    scored.push({ name, score: version + stable });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name ?? null;
}

export function parseModelJson(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new Error(`model did not return JSON: ${t.slice(0, 120)}`);
}

const STATUS = { pass: 'pass', passed: 'pass', ok: 'pass', yes: 'pass', fail: 'fail', failed: 'fail', no: 'fail', unclear: 'unclear', unknown: 'unclear', not_visible: 'unclear' };

export function normalizeResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = r.step && typeof r.step === 'object' ? r.step : {};
  let conf = Number(s.confidence);
  if (!Number.isFinite(conf)) conf = 0;
  conf = Math.min(1, Math.max(0, conf));
  const rules = Array.isArray(r.rules) ? r.rules : [];
  return {
    scene: typeof r.scene === 'string' ? r.scene : '',
    step: {
      status: STATUS[String(s.status || '').toLowerCase().trim()] || 'unclear',
      evidence: typeof s.evidence === 'string' ? s.evidence : '',
      confidence: conf,
      coach_line: typeof s.coach_line === 'string' ? s.coach_line : '',
    },
    rules: rules
      .filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id)
      .map((x) => ({ id: x.id, evidence: typeof x.evidence === 'string' ? x.evidence : '', line: typeof x.line === 'string' ? x.line : '' })),
  };
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiProvider {
  constructor({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL, fallbackModels = DEFAULT_FALLBACKS, baseUrl = 'https://generativelanguage.googleapis.com', timeoutMs = 12_000, maxRetries = 1, retryDelayMs = 600 } = {}) {
    this.name = 'gemini';
    this.apiKey = (apiKey || '').trim();
    this.configured = (model || '').trim() || null;
    this.fallbackModels = fallbackModels;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.level = new Map(); // model -> index into LEVELS that works
    this.dead = new Set(); // models that 404'd
    this.candidates = null;
    this.activeModel = null;
  }

  async models() {
    if (this.candidates) return this.candidates;
    const list = [];
    if (this.configured) list.push(this.configured);
    else {
      try {
        const res = await this.fetchJson(`${this.baseUrl}/v1beta/models?pageSize=1000`, { method: 'GET' });
        const picked = pickModel(res.models);
        if (picked) list.push(picked);
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        /* listing is best effort; fall back to known names */
      }
    }
    for (const m of this.fallbackModels) if (!list.includes(m)) list.push(m);
    this.candidates = list;
    return list;
  }

  async fetchJson(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey } });
    } catch (e) {
      if (e.name === 'AbortError') throw new ApiError(0, `Gemini request timed out after ${this.timeoutMs} ms`);
      throw new ApiError(0, `could not reach Gemini: ${e.cause?.code || e.message}`);
    } finally {
      clearTimeout(timer);
    }
    const txt = await res.text();
    let body = null;
    try {
      body = txt ? JSON.parse(txt) : null;
    } catch {
      body = null;
    }
    if (!res.ok) throw new ApiError(res.status, `Gemini ${res.status}: ${body?.error?.message || txt.slice(0, 200)}`);
    return body;
  }

  buildBody({ image, mime, system, user, schema }, lvl) {
    const L = LEVELS[lvl];
    const generationConfig = { temperature: 0.2, maxOutputTokens: 1024 };
    if (L.json) generationConfig.responseMimeType = 'application/json';
    if (L.schema && schema) generationConfig.responseSchema = schema;
    if (L.thinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime || 'image/jpeg', data: Buffer.from(image).toString('base64') } }, { text: user }] }],
      generationConfig,
    };
  }

  async callModel(model, input) {
    let lvl = this.level.get(model) ?? 0;
    for (;;) {
      let attempt = 0;
      for (;;) {
        try {
          const body = await this.fetchJson(`${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            body: JSON.stringify(this.buildBody(input, lvl)),
          });
          this.level.set(model, lvl);
          return body;
        } catch (e) {
          const transient = e.status === 0 || e.status === 429 || e.status >= 500;
          if (transient && attempt < this.maxRetries) {
            attempt += 1;
            await sleep(this.retryDelayMs * attempt);
            continue;
          }
          if (e.status === 400 && lvl < LEVELS.length - 1) {
            lvl += 1;
            break; // retry at a smaller request level
          }
          throw e;
        }
      }
    }
  }

  async analyze(input) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY is not set. Put it in .env (see README) and restart, or run with MODEL_PROVIDER=mock.');
    const started = Date.now();
    const models = await this.models();
    let lastErr = null;
    for (const model of models) {
      if (this.dead.has(model)) continue;
      let body;
      try {
        body = await this.callModel(model, input);
      } catch (e) {
        if (e.status === 404) {
          this.dead.add(model);
          lastErr = e;
          continue;
        }
        throw e;
      }
      this.activeModel = model;
      if (body?.promptFeedback?.blockReason) throw new Error(`Gemini blocked: ${body.promptFeedback.blockReason}`);
      const cand = body?.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
      if (!text) throw new Error(`Gemini returned no text (finishReason ${cand?.finishReason || 'none'})`);
      return { result: normalizeResult(parseModelJson(text)), model, latencyMs: Date.now() - started, usage: body.usageMetadata || null };
    }
    throw lastErr || new Error('no Gemini model is available');
  }

  describe() {
    return { provider: 'gemini', model: this.activeModel || this.configured || 'auto', keySet: Boolean(this.apiKey) };
  }
}
