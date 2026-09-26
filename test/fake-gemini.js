// A strict stand-in for the Gemini REST API, used to run the real GeminiProvider end to end.
// It rejects requests that don't match the documented generateContent shape, the way Google would.

import http from 'node:http';

export async function startFakeGemini({ models = ['gemini-3.8-flash', 'gemini-3.8-flash-tts', 'gemini-3.5-flash-lite'], rejectThinking = false, passAfter = 2 } = {}) {
  const calls = [];
  const counts = new Map();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const bad = (msg) => send(400, { error: { code: 400, message: msg, status: 'INVALID_ARGUMENT' } });
      if (req.headers['x-goog-api-key'] !== 'test-key') return send(403, { error: { code: 403, message: 'API key not valid. Please pass a valid API key.', status: 'PERMISSION_DENIED' } });
      if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
        return send(200, { models: models.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ['generateContent', 'countTokens'] })) });
      }
      const m = req.url.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
      if (req.method !== 'POST' || !m) return send(404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
      const model = decodeURIComponent(m[1]);
      if (!models.includes(model)) return send(404, { error: { code: 404, message: `models/${model} is not found for API version v1beta`, status: 'NOT_FOUND' } });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return bad('Invalid JSON payload received.');
      }
      calls.push({ model, body });
      const parts = body?.contents?.[0]?.parts;
      if (!Array.isArray(parts)) return bad('contents[0].parts is required');
      const img = parts.find((p) => p.inline_data || p.inlineData);
      const txt = parts.find((p) => typeof p.text === 'string');
      if (!img || !txt) return bad('expected an image part and a text part');
      const data = img.inline_data || img.inlineData;
      const mime = data.mime_type || data.mimeType;
      const bytes = Buffer.from(data.data || '', 'base64');
      if (mime !== 'image/jpeg' || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bad('inline_data must be a base64 JPEG');
      if (!body.systemInstruction?.parts?.[0]?.text) return bad('systemInstruction missing');
      const gc = body.generationConfig || {};
      if (rejectThinking && gc.thinkingConfig) return bad('Invalid JSON payload received. Unknown name "thinkingConfig" at \'generation_config\': Cannot find field.');
      if (gc.responseSchema && gc.responseSchema.type !== 'OBJECT') return bad('responseSchema.type must be OBJECT');

      const stepId = (txt.text.match(/CURRENT STEP \(\d+ of \d+\) id="([^"]+)"/) || [])[1] || 'step';
      const rules = [...txt.text.matchAll(/- id="([^"]+)"/g)].map((x) => x[1]);
      const n = (counts.get(stepId) || 0) + 1;
      counts.set(stepId, n);
      const out = {
        scene: 'Close view of a battery cabinet on a concrete pad next to a house wall.',
        step: n >= passAfter ? { status: 'pass', evidence: `looks right for ${stepId}`, confidence: 0.91 } : { status: 'unclear', evidence: 'not in frame yet', confidence: 0.3, coach_line: 'Bring it closer.' },
        rules: rules.includes('bare-hands-on-connector') && stepId === 'connector' && n === 1 ? [{ id: 'bare-hands-on-connector', evidence: 'bare hand on plug', line: 'Gloves on.' }] : [],
      };
      const text = gc.responseMimeType === 'application/json' ? JSON.stringify(out) : '```json\n' + JSON.stringify(out) + '\n```';
      send(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80 } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}
