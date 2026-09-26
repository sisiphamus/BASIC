#!/usr/bin/env node
// Clear rehearsal jobs before the real demo without deleting anything:
// moves data/sessions to data/archive/<timestamp>/sessions. Stop the server first.
import fs from 'node:fs';
import path from 'node:path';

const data = path.resolve(process.env.DATA_DIR || 'data');
const src = path.join(data, 'sessions');
if (!fs.existsSync(src) || !fs.readdirSync(src).length) {
  console.log('Nothing to archive.');
  process.exit(0);
}
const dest = path.join(data, 'archive', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dest, { recursive: true });
fs.renameSync(src, path.join(dest, 'sessions'));
console.log(`Moved ${fs.readdirSync(path.join(dest, 'sessions')).length} jobs to ${dest}. Start the server for a clean floor.`);
