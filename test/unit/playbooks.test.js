import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlaybook, fillTemplate, PlaybookLibrary } from '../../server/playbooks.js';

const MIN = `
id: t
title: Test
steps:
  - id: a
    title: A
    say: Do A
    check: A is visible
`;

test('parses a minimal playbook and applies defaults', () => {
  const pb = parsePlaybook(MIN);
  assert.equal(pb.id, 't');
  assert.equal(pb.steps.length, 1);
  assert.deepEqual(pb.watch, []);
  assert.deepEqual(pb.job, {});
  const s = pb.steps[0];
  assert.equal(s.min_confidence, 0.6);
  assert.equal(s.pass_say, '');
  assert.equal(s.hint, '');
});

test('rejects a playbook with no steps, with a readable message', () => {
  assert.throws(() => parsePlaybook('id: x\ntitle: X\nsteps: []\n'), /steps/);
});

test('rejects duplicate step ids', () => {
  const y = MIN + `  - id: a\n    title: A2\n    say: again\n    check: again\n`;
  assert.throws(() => parsePlaybook(y), /duplicate/i);
});

test('rejects broken YAML with the line number', () => {
  assert.throws(() => parsePlaybook('id: x\n  title: : :\n- nope'), /line/i);
});

test('accepts numbers and booleans in job facts', () => {
  const pb = parsePlaybook(MIN + 'job:\n  clearance_in: 36\n  ok: true\n');
  assert.equal(pb.job.clearance_in, 36);
});

test('fillTemplate replaces known keys and leaves unknown ones visible', () => {
  assert.equal(fillTemplate('need {n} in, {missing}', { n: 36 }), 'need 36 in, {missing}');
  assert.equal(fillTemplate(undefined, {}), '');
});

test('bundled playbooks all parse', () => {
  const dir = path.resolve('playbooks');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const pb = parsePlaybook(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(pb.steps.length > 0, f);
    assert.equal(pb.id + '.yaml', f, 'file name must match id');
  }
});

test('library loads a directory, saves, rejects bad saves without touching disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  fs.writeFileSync(path.join(dir, 't.yaml'), MIN);
  fs.writeFileSync(path.join(dir, 'broken.yaml'), 'id: [');
  const lib = new PlaybookLibrary(dir);
  lib.load();
  assert.deepEqual(lib.list().map((p) => p.id), ['t']);
  assert.equal(lib.errors().length, 1);

  const saved = lib.save('t', MIN.replace('Do A', 'Do A now'));
  assert.equal(saved.steps[0].say, 'Do A now');
  assert.match(fs.readFileSync(path.join(dir, 't.yaml'), 'utf8'), /Do A now/);

  assert.throws(() => lib.save('t', 'id: t\nsteps: nope'));
  assert.match(fs.readFileSync(path.join(dir, 't.yaml'), 'utf8'), /Do A now/);

  assert.throws(() => lib.save('other', MIN), /id/);
  assert.throws(() => lib.save('../evil', MIN), /id/);
});

test('a broken save from an editor keeps the last good version live', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  fs.writeFileSync(path.join(dir, 't.yaml'), MIN);
  const lib = new PlaybookLibrary(dir).load();
  fs.writeFileSync(path.join(dir, 't.yaml'), 'id: t\ntitle: [half saved');
  lib.load();
  assert.equal(lib.get('t').steps[0].say, 'Do A');
  assert.equal(lib.errors().length, 1);
  fs.writeFileSync(path.join(dir, 't.yaml'), MIN.replace('Do A', 'Do A2'));
  lib.load();
  assert.equal(lib.get('t').steps[0].say, 'Do A2');
  assert.equal(lib.errors().length, 0);
});
