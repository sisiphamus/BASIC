// Vision through the local Claude Code CLI (`claude -p`), using whatever account it is logged into.
// No API key needed. Each frame is one short, tool-less, settings-less print session:
//   claude -p --model sonnet --effort low --input-format stream-json --output-format stream-json ...
// The photo goes in as an image content block, so there is no file read or tool call.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeResult, parseModelJson } from './gemini.js';

const JSON_SHAPE = `Reply with one JSON object only, no prose, in exactly this shape:
{"scene": "<one sentence>", "step": {"status": "pass" | "fail" | "unclear", "evidence": "<what you see>", "confidence": <0..1>, "coach_line": "<short spoken sentence if fail/unclear>"}, "rules": [{"id": "<rule id>", "evidence": "<what you see>", "line": "<short spoken sentence>"}]}`;

export class ClaudeCliProvider {
  constructor({ bin = process.env.BA_CLAUDE_BIN || 'claude', model = process.env.BA_CLAUDE_MODEL || 'sonnet', effort = process.env.BA_CLAUDE_EFFORT || 'low', timeoutMs = Number(process.env.BA_CLAUDE_TIMEOUT_MS || 30_000) } = {}) {
    this.name = 'claude-cli';
    this.bin = bin;
    this.model = model;
    this.effort = effort;
    this.timeoutMs = timeoutMs;
    this.lastModel = null;
    // Run from an empty folder so no project CLAUDE.md is picked up.
    this.cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-claude-'));
  }

  args(system) {
    return [
      '-p',
      '--model', this.model,
      '--effort', this.effort,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--tools', '',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--system-prompt', system,
    ];
  }

  analyze({ image, mime = 'image/jpeg', system, user }) {
    const started = Date.now();
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: Buffer.from(image).toString('base64') } },
          { type: 'text', text: `${user}\n\n${JSON_SHAPE}` },
        ],
      },
    };
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(this.bin, this.args(system), { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      } catch (e) {
        return reject(new Error(`could not start ${this.bin}: ${e.message}`));
      }
      let out = '';
      let err = '';
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`Claude CLI timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      child.on('error', (e) => finish(reject, new Error(e.code === 'ENOENT' ? `"${this.bin}" not found. Install Claude Code or set BA_CLAUDE_BIN.` : e.message)));
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        let result = null;
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === 'system' && ev.model) this.lastModel = ev.model;
          if (ev.type === 'result') result = ev;
        }
        if (!result) return finish(reject, new Error(`Claude CLI gave no result (exit ${code}): ${err.trim().slice(0, 200)}`));
        if (result.is_error) return finish(reject, new Error(`Claude CLI error: ${String(result.result || result.subtype).slice(0, 200)}`));
        try {
          finish(resolve, { result: normalizeResult(parseModelJson(result.result)), model: this.lastModel || `claude-${this.model}`, latencyMs: Date.now() - started, usage: result.usage || null });
        } catch (e) {
          finish(reject, e);
        }
      });
      child.stdin.on('error', () => {}); // a crashed child shouldn't crash the server
      child.stdin.end(JSON.stringify(message) + '\n');
    });
  }

  describe() {
    return { provider: 'claude-cli', model: this.lastModel || this.model, keySet: true };
  }
}
