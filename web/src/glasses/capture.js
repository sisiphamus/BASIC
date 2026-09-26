// Grab a full-resolution still from the video every N ms and post it (no downscaling: detail matters more than bytes). One upload at a time; if the network
// is slow we skip a beat rather than build a backlog.

export async function openSource(kind, deviceId) {
  if (!window.isSecureContext) throw new Error('insecure');
  if (kind === 'screen') {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This device cannot share a window. Use a laptop in Chrome, or pick a camera.');
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access. Use Chrome or Safari.');
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: kind === 'front' ? 'user' : { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export async function listCameras() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

export class FrameLoop {
  constructor({ video, url, intervalMs = 2000, maxWidth = Infinity, quality = 0.92, onSent, onError }) {
    this.video = video;
    this.url = url;
    this.intervalMs = intervalMs;
    this.maxWidth = maxWidth;
    this.quality = quality;
    this.onSent = onSent || (() => {});
    this.onError = onError || (() => {});
    this.canvas = document.createElement('canvas');
    this.inflight = false;
    this.timer = null;
    this.sent = 0;
    this.failed = 0;
    this.paused = false;
  }

  start() {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setInterval(ms) {
    if (ms && ms !== this.intervalMs) {
      this.intervalMs = ms;
      if (this.timer) this.start();
    }
  }

  grab() {
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    const scale = Math.min(1, this.maxWidth / v.videoWidth);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.getContext('2d').drawImage(v, 0, 0, w, h);
    return new Promise((resolve) => this.canvas.toBlob((b) => resolve(b), 'image/jpeg', this.quality));
  }

  async tick() {
    if (this.inflight || this.paused || document.hidden) return;
    const pending = this.grab();
    if (!pending) return;
    this.inflight = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const blob = await pending;
      if (!blob) return;
      const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
      this.sent += 1;
      this.onSent(body);
    } catch (e) {
      this.failed += 1;
      this.onError(e.name === 'AbortError' ? new Error('upload timed out') : e);
    } finally {
      clearTimeout(t);
      this.inflight = false;
    }
  }
}
