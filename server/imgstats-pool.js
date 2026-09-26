// One background worker for image statistics. Best effort: if it is busy or broken, frames just skip stats.
import { Worker } from 'node:worker_threads';

let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./imgstats-worker.js', import.meta.url));
  worker.unref();
  worker.on('message', ({ id, stats }) => {
    const done = waiting.get(id);
    waiting.delete(id);
    done?.(stats);
  });
  worker.on('error', () => {
    for (const done of waiting.values()) done(null);
    waiting.clear();
    worker = null;
  });
  return worker;
}

export function statsAsync(buf) {
  if (waiting.size > 3) return Promise.resolve(null); // falling behind: skip this frame
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    try {
      getWorker().postMessage({ id, buf });
    } catch {
      waiting.delete(id);
      resolve(null);
    }
  });
}

/** Stop the worker (server shutdown). */
export async function stopStats() {
  const w = worker;
  worker = null;
  for (const done of waiting.values()) done(null);
  waiting.clear();
  if (w) await w.terminate();
}
