import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GeminiProvider, pickModel, parseModelJson, normalizeResult } from '../../server/providers/gemini.js';

// A fake Gemini API. Each test sets `behave` to control what it does.
let server, base, calls, behave;
const OK_JSON = { scene: 'a battery', step: { status: 'pass', evidence: 'tape reads 38', confidence: 0.92, coach_line: '' }, rules: [] };
const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const candidate = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, url: req.url, key: req.headers['x-goog-api-key'], body: parsed });
      behave(req, res, parsed, calls.length);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { calls = []; });

const provider = (opts = {}) => new GeminiProvider({ apiKey: 'k', baseUrl: base, retryDelayMs: 5, timeoutMs: 500, ...opts });
const input = { image: Buffer.from('fakejpeg'), mime: 'image/jpeg', system: 'sys', user: 'usr', schema: { type: 'OBJECT' } };

test('pickModel prefers the newest plain flash model that supports generateContent', () => {
  const models = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-3.9-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
  ];
  assert.equal(pickModel(models), 'gemini-3.8-flash');
  assert.equal(pickModel([]), null);
});

test('parseModelJson handles fences, prose around JSON, and garbage', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Sure! {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  assert.throws(() => parseModelJson('no json here'), /JSON/);
});

test('normalizeResult coerces sloppy model output into the contract', () => {
  const r = normalizeResult({ step: { status: 'PASSED', confidence: '0.8' }, rules: [{ id: 'x' }, { nope: 1 }, 'bad'] });
  assert.equal(r.step.status, 'pass');
  assert.equal(r.step.confidence, 0.8);
  assert.equal(r.scene, '');
  assert.deepEqual(r.rules, [{ id: 'x', evidence: '', line: '' }]);
  assert.equal(normalizeResult({ step: { status: 'weird', confidence: 5 } }).step.status, 'unclear');
  assert.equal(normalizeResult({ step: { status: 'fail', confidence: 5 } }).step.confidence, 1);
  assert.equal(normalizeResult(null).step.status, 'unclear');
});

test('sends image, prompt, schema and key in the documented shape', async () => {
  behave = (req, res) => reply(res, 200, candidate(JSON.stringify(OK_JSON)));
  const out = await provider({ model: 'gemini-3.8-flash' }).analyze(input);
  assert.equal(out.result.step.status, 'pass');
  assert.equal(out.model, 'gemini-3.8-flash');
  const c = calls[0];
  assert.equal(c.url, '/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(c.key, 'k');
  assert.equal(c.body.systemInstruction.parts[0].text, 'sys');
  const parts = c.body.contents[0].parts;
  assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
  assert.equal(parts[0].inline_data.data, Buffer.from('fakejpeg').toString('base64'));
  assert.equal(parts[1].text, 'usr');
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(c.body.generationConfig.responseSchema, { type: 'OBJECT' });
  assert.ok(c.body.generationConfig.thinkingConfig);
});

test('auto-picks a model from the models list when none is configured', async () => {
  behave = (req, res) => {
    if (req.url.startsWith('/v1beta/models?')) return reply(res, 200, { models: [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }] });
    reply(res, 200, candidate(JSON.stringify(OK_JSON)));
  };
  const p = provider();
  const out = await p.analyze(input);
  assert.equal(out.model, 'gemini-3.7-flash');
  await p.analyze(input);
  assert.equal(calls.filter((c) => c.url.startsWith('/v1beta/models?')).length, 1, 'list is cached');
});

test('a 400 about an optional field drops it and remembers', async () => {
  behave = (req, res, body) => {
    if (body.generationConfig.thinkingConfig) return reply(res, 400, { error: { code: 400, message: 'Invalid JSON payload received. Unknown name "thinkingConfig"', status: 'INVALID_ARGUMENT' } });
    reply(res, 200, candidate(JSON.stringify(OK_JSON)));
  };
  const p = provider({ model: 'm1' });
  const out = await p.analyze(input);
  assert.equal(out.result.step.status, 'pass');
  await p.analyze(input);
  assert.equal(calls.length, 3, 'second call goes straight to the working config');
});

test('a schema rejection falls back to plain JSON mode', async () => {
  behave = (req, res, body) => {
    if (body.generationConfig.responseSchema) return reply(res, 400, { error: { code: 400, message: 'responseSchema: invalid', status: 'INVALID_ARGUMENT' } });
    reply(res, 200, candidate('```json\n' + JSON.stringify(OK_JSON) + '\n```'));
  };
  const out = await provider({ model: 'm1' }).analyze(input);
  assert.equal(out.result.step.evidence, 'tape reads 38');
});

test('a 404 model moves to the next fallback model', async () => {
  behave = (req, res) => {
    if (req.url.includes('/gone:')) return reply(res, 404, { error: { code: 404, message: 'models/gone is not found', status: 'NOT_FOUND' } });
    reply(res, 200, candidate(JSON.stringify(OK_JSON)));
  };
  const out = await provider({ model: 'gone', fallbackModels: ['backup'] }).analyze(input);
  assert.equal(out.model, 'backup');
});

test('retries once on 429 and 503', async () => {
  behave = (req, res, body, n) => (n === 1 ? reply(res, 429, { error: { code: 429, message: 'quota' } }) : reply(res, 200, candidate(JSON.stringify(OK_JSON))));
  assert.equal((await provider({ model: 'm' }).analyze(input)).result.step.status, 'pass');
  calls = [];
  behave = (req, res, body, n) => (n === 1 ? reply(res, 503, { error: { code: 503, message: 'overloaded' } }) : reply(res, 200, candidate(JSON.stringify(OK_JSON))));
  assert.equal((await provider({ model: 'm' }).analyze(input)).result.step.status, 'pass');
});

test('gives up with a clear error when the key is bad', async () => {
  behave = (req, res) => reply(res, 403, { error: { code: 403, message: 'API key not valid', status: 'PERMISSION_DENIED' } });
  await assert.rejects(provider({ model: 'm' }).analyze(input), /API key not valid/);
  assert.equal(calls.length, 1, 'no pointless retries on auth errors');
});

test('times out a hung request', async () => {
  behave = () => {}; // never answers
  await assert.rejects(provider({ model: 'm', timeoutMs: 100, maxRetries: 0 }).analyze(input), /timed out/);
});

test('reports a blocked prompt as an error, not a crash', async () => {
  behave = (req, res) => reply(res, 200, { promptFeedback: { blockReason: 'SAFETY' } });
  await assert.rejects(provider({ model: 'm' }).analyze(input), /blocked: SAFETY/);
});

test('skips thought parts and joins text parts', async () => {
  behave = (req, res) => reply(res, 200, { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"scene":"s",' }, { text: '"step":{"status":"fail","evidence":"e","confidence":0.7},"rules":[]}' }] } }] });
  const out = await provider({ model: 'm' }).analyze(input);
  assert.equal(out.result.step.status, 'fail');
});

test('missing API key fails fast with setup instructions', async () => {
  await assert.rejects(new GeminiProvider({ apiKey: '' }).analyze(input), /GEMINI_API_KEY/);
});

test('a stable model beats a newer preview', () => {
  const models = [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-flash-preview', supportedGenerationMethods: ['generateContent'] },
  ];
  assert.equal(pickModel(models), 'gemini-3.8-flash');
  assert.equal(pickModel([models[1]]), 'gemini-4-flash-preview');
});

test('request follows current Gemini 3 guidance: no temperature, room for thinking tokens', async () => {
  behave = (req, res) => reply(res, 200, candidate(JSON.stringify(OK_JSON)));
  await provider({ model: 'm' }).analyze(input);
  const gc = calls[0].body.generationConfig;
  assert.equal(gc.temperature, undefined);
  assert.equal(gc.maxOutputTokens, 4096);
  assert.deepEqual(gc.thinkingConfig, { thinkingLevel: 'low' });
});

test('a one-off 400 that names no setting is retried bare once and NOT remembered', async () => {
  behave = (req, res, body, n) => (n === 1 ? reply(res, 400, { error: { code: 400, message: 'Request contains an invalid argument.' } }) : reply(res, 200, candidate(JSON.stringify(OK_JSON))));
  const p = provider({ model: 'm' });
  await p.analyze(input);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined, 'bare retry');
  await p.analyze(input);
  assert.ok(calls[2].body.generationConfig.thinkingConfig, 'next frame uses full settings again');
});
