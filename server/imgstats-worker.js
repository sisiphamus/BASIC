// Runs image statistics on a worker thread so decoding never blocks the server.
import { parentPort } from 'node:worker_threads';
import { imageStats } from './imgstats.js';

parentPort.on('message', ({ id, buf }) => {
  let stats = null;
  try {
    stats = imageStats(Buffer.from(buf));
  } catch {
    stats = null;
  }
  parentPort.postMessage({ id, stats });
});
