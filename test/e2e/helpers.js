import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { start } from '../../server/index.js';
import { MockProvider } from '../../server/providers/mock.js';

export const CHROME = process.env.CHROME_PATH || [
  '/home/adam/.local/opt/browseruse-chrome/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

/** A fake camera feed for Chrome. Falls back to Chrome's built-in test pattern if ffmpeg is missing. */
export function fakeCameraFile() {
  const out = path.resolve('test/fixtures/camera.y4m');
  if (fs.existsSync(out)) return out;
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=10:d=3', '-pix_fmt', 'yuv420p', out]);
    return out;
  } catch {
    return null;
  }
}

export async function launch() {
  if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.');
  const cam = fakeCameraFile();
  return chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(cam ? [`--use-file-for-fake-video-capture=${cam}`] : []), '--autoplay-policy=no-user-gesture-required'],
  });
}

/** Speech + mic stubs so tests can read what would be spoken and inject voice commands. */
export const BROWSER_STUBS = () => {
  window.__spoken = [];
  window.__cancels = 0;
  class Utter {
    constructor(text) {
      this.text = text;
    }
  }
  window.SpeechSynthesisUtterance = Utter;
  const synth = {
    speaking: false,
    getVoices: () => [{ name: 'Test US', lang: 'en-US', localService: true }],
    addEventListener() {},
    speak(u) {
      window.__spoken.push(u.text);
      synth.speaking = true;
      setTimeout(() => {
        synth.speaking = false;
        u.onend?.();
      }, 30);
    },
    cancel() {
      window.__cancels += 1;
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  class FakeRec {
    constructor() {
      window.__rec = this;
    }
    start() {}
    stop() {
      this.onend?.();
    }
  }
  window.webkitSpeechRecognition = FakeRec;
  window.SpeechRecognition = FakeRec;
  window.__say = (text) => {
    const alt = { transcript: text };
    const result = Object.assign([alt], { isFinal: true });
    window.__rec?.onresult?.({ resultIndex: 0, results: [result] });
  };
};

export async function bootServer({ intervalMs = 500, provider } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-e2e-data-'));
  const pbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-e2e-pb-'));
  for (const f of fs.readdirSync('playbooks')) {
    let src = fs.readFileSync(path.join('playbooks', f), 'utf8');
    src = src.replace(/^steps:/m, `frame_interval_ms: ${intervalMs}\n\nsteps:`);
    fs.writeFileSync(path.join(pbDir, f), src);
  }
  const staticDir = process.env.E2E_STATIC_DIR || path.resolve('dist');
  if (!fs.existsSync(path.join(staticDir, 'glasses.html'))) throw new Error(`build the web app first (no ${staticDir}/glasses.html)`);
  const mock = provider || new MockProvider({ delayMs: 60, walkthrough: true });
  const srv = await start({ port: 0, httpsPort: 0, dataDir, playbookDir: pbDir, staticDir, provider: mock, quiet: true });
  if (srv.playbooks.errors().length) throw new Error('test playbooks invalid: ' + JSON.stringify(srv.playbooks.errors()));
  return { srv, mock, base: `http://localhost:${srv.port}`, httpsBase: `https://localhost:${srv.httpsPort}` };
}

export async function waitFor(fn, { timeout = 15000, every = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out waiting for ${what}`);
}
