// Full-fidelity trace of everything that flows through a crew's pipeline: one JSONL file per job
// (data/traces/<session>.jsonl) plus a live broadcast for the telemetry console.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Tracer {
  constructor(dataDir, hub) {
    this.dir = path.join(dataDir, 'traces');
    this.hub = hub;
    this.seq = 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  emit(sessionId, kind, data = {}) {
    const rec = { t: new Date().toISOString(), seq: ++this.seq, session: sessionId, kind, ...data };
    try {
      fs.appendFileSync(path.join(this.dir, `${sessionId}.jsonl`), JSON.stringify(rec) + '\n');
    } catch {
      /* tracing must never break the pipeline */
    }
    this.hub?.publish(sessionId, { type: 'trace', sessionId, trace: rec });
    return rec;
  }
}

/** Width and height from a JPEG's SOF marker, without decoding the image. */
export function jpegSize(buf) {
  try {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch {
    /* not a JPEG we can read */
  }
  return null;
}

export const shortHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
