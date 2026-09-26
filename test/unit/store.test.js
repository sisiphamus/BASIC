import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../server/store.js';

const JPEG = fs.readFileSync(path.resolve('test/fixtures/frame.jpg'));

test('old frames are pruned but evidence frames are kept', () => {
  const st = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), { maxFramesPerSession: 3 }).load();
  st.add({ id: 'abc', createdAt: 0, steps: [] });
  const evidence = st.saveFrame('abc', JPEG);
  for (let i = 0; i < 6; i++) st.saveFrame('abc', JPEG, new Set([evidence]));
  assert.deepEqual(st.frames('abc'), ['000001', '000006', '000007']);
  assert.ok(st.framePath('abc', evidence));
  assert.equal(st.framePath('abc', '000002'), null);
});

test('rejects unsafe session ids and frame ids', () => {
  const st = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'st-'))).load();
  assert.throws(() => st.sessionDir('../x'));
  st.add({ id: 'abc', createdAt: 0, steps: [] });
  assert.equal(st.framePath('abc', '../../etc/passwd'), null);
});

test('a torn last line in the event log is ignored on reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const st = new Store(dir).load();
  st.add({ id: 'abc', createdAt: 0, steps: [] });
  st.appendEvent('abc', { type: 'x' });
  fs.appendFileSync(path.join(dir, 'sessions', 'abc', 'events.jsonl'), '{"seq":2,"ty');
  const again = new Store(dir).load();
  assert.equal(again.eventsFor('abc').length, 1);
  assert.equal(again.appendEvent('abc', { type: 'y' }).seq, 2);
  const third = new Store(dir).load();
  assert.deepEqual(third.eventsFor('abc').map((e) => e.type), ['x', 'y'], 'event written after the torn line survives');
});
