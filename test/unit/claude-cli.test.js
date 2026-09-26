import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeCliProvider } from '../../server/providers/claude-cli.js';

const BIN = path.resolve('test/fixtures/bin/fake-claude.js');
const LOG = path.join(os.tmpdir(), `fake-claude-${process.pid}.json`);
const input = { image: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), mime: 'image/jpeg', system: 'SYS', user: 'CHECK: tape' };
const run = (mode, opts = {}) => {
  process.env.FAKE_CLAUDE = mode;
  process.env.FAKE_CLAUDE_LOG = LOG;
  return new ClaudeCliProvider({ bin: BIN, ...opts }).analyze(input);
};

test('sends the photo as an image block with the right flags, parses the fenced JSON result', async () => {
  const out = await run('ok');
  assert.equal(out.result.step.status, 'pass');
  assert.equal(out.result.step.evidence, 'tape reads 40 in');
  assert.equal(out.model, 'claude-sonnet-5');
  const { args, input: sent } = JSON.parse(fs.readFileSync(LOG, 'utf8'));
  for (const flag of ['-p', '--input-format', '--output-format', '--no-session-persistence', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.equal(args[args.indexOf('--tools') + 1], '', 'no tools');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '', 'no user hooks/settings');
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'SYS');
  const [img, txt] = sent.message.content;
  assert.equal(img.type, 'image');
  assert.equal(img.source.media_type, 'image/jpeg');
  assert.equal(Buffer.from(img.source.data, 'base64').length, 6);
  assert.match(txt.text, /CHECK: tape/);
  assert.match(txt.text, /JSON object only/);
});

test('a non-JSON answer, an error result, a crash and a hang all become clean errors', async () => {
  await assert.rejects(run('garbage'), /did not return JSON/);
  await assert.rejects(run('error'), /rate limited/);
  await assert.rejects(run('crash'), /no result \(exit 3\): boom/);
  await assert.rejects(run('hang', { timeoutMs: 300 }), /timed out/);
});

test('missing binary gives a setup hint', async () => {
  await assert.rejects(new ClaudeCliProvider({ bin: '/nope/claude' }).analyze(input), /not found/);
});
