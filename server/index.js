// BASIC server: `npm start`
// Serves the dashboard (http://localhost:3000) and the glasses page (https://<laptop-ip>:3443/glasses).

import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import { createApp } from './app.js';
import { Hub } from './hub.js';
import { PlaybookLibrary } from './playbooks.js';
import { Service } from './service.js';
import { Store } from './store.js';
import { Tracer } from './trace.js';
import { stopStats } from './imgstats-pool.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';
import { ClaudeCliProvider } from './providers/claude-cli.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export async function loadCert(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const ipsPath = path.join(dir, 'ips.json');
  const ips = lanAddresses();
  // Reuse the certificate only if it was made for the addresses this laptop has now (new Wi-Fi = new cert).
  let covered = [];
  try {
    covered = JSON.parse(fs.readFileSync(ipsPath, 'utf8'));
  } catch {
    covered = [];
  }
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && ips.every((ip) => covered.includes(ip))) return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  const attrs = [{ name: 'commonName', value: 'basic.local' }];
  const pems = await selfsigned.generate(attrs, {
    notAfterDate: new Date(Date.now() + 800 * 24 * 3600 * 1000),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))] }],
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(ipsPath, JSON.stringify(ips));
  return { key: pems.private, cert: pems.cert };
}

export function chooseProvider(env = process.env) {
  const want = (env.MODEL_PROVIDER || '').toLowerCase();
  if (want === 'claude-cli' || want === 'claude') return new ClaudeCliProvider();
  if (want === 'mock' || (!want && !env.GEMINI_API_KEY)) return new MockProvider({ delayMs: Number(env.MOCK_DELAY_MS ?? 700) });
  return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
}

export async function start({ port = Number(process.env.PORT || 3000), httpsPort = Number(process.env.HTTPS_PORT || 3443), dataDir = process.env.DATA_DIR || path.join(root, 'data'), playbookDir = process.env.PLAYBOOK_DIR || path.join(root, 'playbooks'), staticDir = process.env.STATIC_DIR || path.join(root, 'dist'), provider = chooseProvider(), quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);
  const playbooks = new PlaybookLibrary(playbookDir).load();
  playbooks.watch();
  for (const e of playbooks.errors()) log(`playbook ${e.file} has an error and was skipped: ${e.error}`);
  const store = new Store(dataDir).load();
  const hub = new Hub();
  const service = new Service({ store, playbooks, provider, hub, log, tracer: new Tracer(dataDir, hub) });
  service.sweepIdle();
  const beat = setInterval(() => service.heartbeat(), 5000);
  beat.unref();
  const sweeper = setInterval(() => service.sweepIdle(), 5 * 60_000);
  sweeper.unref();

  const urls = {};
  const info = () => ({ urls });
  const app = createApp({ service, playbooks, provider, hub, staticDir, info });

  const httpServer = http.createServer(app);
  hub.attach(httpServer);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '0.0.0.0', resolve);
  });
  const realPort = httpServer.address().port;
  urls.dashboard = `http://localhost:${realPort}`;

  let httpsServer = null;
  if (httpsPort !== -1) {
    try {
      const cert = await loadCert(path.join(dataDir, 'certs'));
      httpsServer = https.createServer(cert, app);
      hub.attach(httpsServer);
      await new Promise((resolve, reject) => {
        httpsServer.once('error', reject);
        httpsServer.listen(httpsPort, '0.0.0.0', resolve);
      });
      const hp = httpsServer.address().port;
      urls.glasses = lanAddresses().map((ip) => `https://${ip}:${hp}/glasses`);
    } catch (e) {
      log(`HTTPS did not start (${e.message}). Phones need HTTPS for the camera; use a tunnel instead (see README).`);
      httpsServer = null;
    }
  }

  const d = provider.describe();
  log(`BASIC running`);
  log(`  dashboard:      ${urls.dashboard}`);
  for (const u of urls.glasses || []) log(`  glasses (phone): ${u}`);
  log(`  model:          ${d.provider}${d.provider === 'mock' ? ' (no GEMINI_API_KEY set, using the built-in walkthrough)' : ` ${d.model}`}`);

  const close = async () => {
    clearInterval(sweeper);
    clearInterval(beat);
    await stopStats();
    store.flush();
    hub.close();
    playbooks.close();
    const shut = (srv) =>
      new Promise((r) => {
        srv.close(r);
        srv.closeAllConnections?.(); // don't wait on idle keep-alive sockets
      });
    await Promise.all([shut(httpServer), httpsServer ? shut(httpsServer) : null]);
  };
  return { app, service, store, hub, playbooks, provider, httpServer, httpsServer, port: realPort, httpsPort: httpsServer?.address().port, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then((srv) => {
    const shutdown = () => {
      srv.store.flush();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${e.port} is already in use. Stop the other server or run with PORT=3100 npm start.`);
    else console.error(e);
    process.exit(1);
  });
  // Last line of defense during a live demo: log and keep serving.
  process.on('unhandledRejection', (e) => console.error('unhandled:', e));
  process.on('uncaughtException', (e) => console.error('uncaught (server kept running):', e));
}
