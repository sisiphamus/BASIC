#!/usr/bin/env node
// Stands in for `claude -p ... --input-format stream-json --output-format stream-json`.
// FAKE_CLAUDE=ok|garbage|error|hang|crash controls what it does. Records its args + input for the test.
import fs from 'node:fs';
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), input: JSON.parse(input) }));
  const mode = process.env.FAKE_CLAUDE || 'ok';
  if (mode === 'hang') return setTimeout(() => {}, 60_000);
  if (mode === 'crash') {
    process.stderr.write('boom');
    process.exit(3);
  }
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', model: 'claude-sonnet-5', tools: [] });
  if (mode === 'error') return out({ type: 'result', is_error: true, result: 'rate limited' });
  const text = mode === 'garbage' ? 'I think it looks fine' : 'Here you go:\n```json\n{"scene":"a tape at a window","step":{"status":"pass","evidence":"tape reads 40 in","confidence":0.9},"rules":[]}\n```';
  out({ type: 'result', is_error: false, result: text, usage: { input_tokens: 1200 } });
});
