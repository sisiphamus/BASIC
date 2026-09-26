#!/usr/bin/env node
// Morning smoke test for the real model:  npm run check:gemini [-- path/to/photo.jpg]
// Lists the models your key can use, then runs one frame through the exact prompt the server uses.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { GeminiProvider, pickModel } from '../server/providers/gemini.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt } from '../server/prompt.js';
import { PlaybookLibrary } from '../server/playbooks.js';
import { createSession } from '../server/engine.js';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY is not set. Put it in .env (copy env.example) and run again.');
  process.exit(1);
}

const imgPath = process.argv[2] || path.resolve('test/fixtures/frame.jpg');
const image = fs.readFileSync(imgPath);

console.log('1. Listing models for this key...');
const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const res = await fetch(`${base}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`   failed: ${res.status} ${body?.error?.message || ''}`);
  process.exit(1);
}
const flash = (body.models || []).map((m) => m.name.replace('models/', '')).filter((n) => /flash/.test(n));
console.log(`   ${body.models?.length ?? 0} models. Flash models: ${flash.join(', ') || 'none'}`);
console.log(`   auto-pick: ${pickModel(body.models) || 'none (will use fallbacks)'}${process.env.GEMINI_MODEL ? `, but GEMINI_MODEL=${process.env.GEMINI_MODEL} overrides it` : ''}`);

console.log(`2. Sending ${path.basename(imgPath)} through the battery job's first step...`);
const lib = new PlaybookLibrary(path.resolve('playbooks')).load();
const pb = lib.get('battery-install') || lib.list()[0];
const { session } = createSession({ playbook: pb, worker: 'Check', id: 'check' });
const provider = new GeminiProvider({ apiKey: key, model: process.env.GEMINI_MODEL });
const started = Date.now();
try {
  const out = await provider.analyze({ image, mime: 'image/jpeg', system: SYSTEM_PROMPT, user: buildUserPrompt(session), schema: RESPONSE_SCHEMA, sessionId: 'check' });
  console.log(`   model: ${out.model}   time: ${Date.now() - started} ms`);
  const cfg = provider.level.get(out.model) || {};
  console.log(`   settings accepted: thinking=${cfg.thinking} schema=${cfg.schema} (both true is best)`);
  console.log(JSON.stringify(out.result, null, 2));
  console.log('\nGemini works. Start the server with npm start.');
} catch (e) {
  console.error(`   failed after ${Date.now() - started} ms: ${e.message}`);
  process.exit(1);
}
