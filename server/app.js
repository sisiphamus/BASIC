import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, sniffImage } from './service.js';

export function createApp({ service, playbooks, provider, hub, staticDir, info = () => ({}) }) {
  const app = express();
  app.disable('x-powered-by');
  const json = express.json({ limit: '256kb' });
  app.use((req, res, next) => (/^\/api\/sessions\/[^/]+\/frames$/.test(req.path) ? next() : json(req, res, next)));

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.status(status).json({ error: e.message || 'server error' });
    }
  };

  // ---- status ----
  app.get('/api/health', wrap(() => ({ ok: true, uptimeS: Math.round(process.uptime()), model: provider.describe(), clients: hub?.counts() ?? null, sessions: service.store.all().length, ...info() })));

  // ---- playbooks ----
  app.get('/api/playbooks', wrap(() => ({
    playbooks: playbooks.list().map((p) => ({ id: p.id, title: p.title, summary: p.summary, job: p.job, steps: p.steps.map((s) => ({ id: s.id, title: s.title })), watch: p.watch })),
    errors: playbooks.errors(),
  })));
  app.get('/api/playbooks/:id', wrap((req) => {
    const pb = playbooks.get(req.params.id);
    if (!pb) throw new HttpError(404, 'no such playbook');
    return { playbook: pb, source: playbooks.source(req.params.id) };
  }));
  app.put('/api/playbooks/:id', wrap((req) => {
    if (typeof req.body?.source !== 'string') throw new HttpError(400, 'send { source: "<yaml>" }');
    try {
      return { playbook: playbooks.save(req.params.id, req.body.source) };
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }));

  // ---- sessions ----
  app.get('/api/sessions', wrap(() => ({ sessions: service.store.all().map((s) => service.publicSession(s)) })));
  app.post('/api/sessions', wrap((req) => service.startSession(req.body || {})));
  app.get('/api/sessions/:id', wrap((req) => service.publicSession(service.must(req.params.id))));
  app.get('/api/sessions/:id/events', wrap((req) => {
    service.must(req.params.id);
    const since = Number(req.query.since) || 0;
    let events = service.store.eventsFor(req.params.id, since);
    if (typeof req.query.types === 'string' && req.query.types) {
      const types = new Set(req.query.types.split(','));
      events = events.filter((e) => types.has(e.type));
    }
    const tail = Number(req.query.tail);
    if (Number.isInteger(tail) && tail > 0) events = events.slice(-tail);
    return { events };
  }));
  app.post('/api/sessions/:id/end', wrap((req) => service.endSession(req.params.id)));
  app.post('/api/sessions/:id/commands', wrap((req) => service.command(req.params.id, req.body?.command, req.body?.by === 'supervisor' ? 'supervisor' : 'crew')));
  app.post('/api/sessions/:id/messages', wrap((req) => service.message(req.params.id, req.body?.text, req.body?.from)));
  app.post('/api/sessions/:id/rules', wrap((req) => service.upsertRule(req.params.id, req.body || {})));
  app.delete('/api/sessions/:id/rules/:ruleId', wrap((req) => service.deleteRule(req.params.id, req.params.ruleId)));
  app.patch('/api/sessions/:id/steps/:stepId', wrap((req) => service.editStep(req.params.id, req.params.stepId, req.body || {})));

  // Frames: raw image body (what the glasses page sends) or JSON { image: "data:image/jpeg;base64,..." }.
  app.post(
    '/api/sessions/:id/frames',
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '20mb' }),
    express.json({ limit: '28mb' }),
    wrap((req) => {
      let buf = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buf && typeof req.body?.image === 'string') {
        const b64 = req.body.image.replace(/^data:[^;]+;base64,/, '');
        buf = Buffer.from(b64, 'base64');
      }
      if (!buf || !buf.length) throw new HttpError(400, 'send the frame as an image body');
      return service.ingestFrame(req.params.id, buf, { ip: req.ip, ua: req.get('user-agent') || '' });
    }),
  );
  app.get('/api/sessions/:id/frames', wrap((req) => {
    service.must(req.params.id);
    return { frames: service.store.frames(req.params.id) };
  }));
  app.get('/api/sessions/:id/frames/:frameId', (req, res) => {
    try {
      service.must(req.params.id);
      const frames = service.store.frames(req.params.id);
      const fid = req.params.frameId === 'latest' ? frames[frames.length - 1] : req.params.frameId;
      const p = fid && service.store.framePath(req.params.id, fid);
      if (!p) return res.status(404).json({ error: 'no such frame' });
      const buf = fs.readFileSync(p);
      res.setHeader('content-type', sniffImage(buf) || 'image/jpeg');
      res.setHeader('cache-control', req.params.frameId === 'latest' ? 'no-store' : 'public, max-age=31536000, immutable');
      res.end(buf);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ---- people ----
  app.get('/api/workers', wrap(() => ({ workers: service.workers() })));
  app.get('/api/workers/:name/training', wrap((req) => service.training(req.params.name)));

  app.use('/api', (req, res) => res.status(404).json({ error: 'no such endpoint' }));
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'upload too large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'body is not valid JSON' });
    next(err);
  });

  // ---- web pages ----
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // `root` keeps the dot-folder check on the URL only, so the app still works if it lives under a hidden folder.
    const page = (file) => (req, res) => {
      if (path.extname(req.path)) return res.status(404).type('text').send('not found');
      if (!fs.existsSync(path.join(staticDir, file))) return res.status(404).type('text').send(`${file} is missing. Run npm run build.`);
      res.setHeader('cache-control', 'no-cache');
      res.sendFile(file, { root: staticDir });
    };
    app.get(['/glasses', '/glasses/*splat'], page('glasses.html'));
    app.get(['/', '/*splat'], page('index.html'));
  } else {
    app.get('/', (req, res) => res.type('text').send('BASIC server is running. Build the web app with `npm run build` to get the dashboard.'));
  }

  return app;
}
