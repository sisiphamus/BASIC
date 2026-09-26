import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import QRCode from 'qrcode';
import { decodeQr } from '../../server/qr.js';

test('decodes a small QR code inside a full-size glasses-like photo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const png = path.join(dir, 'qr.png');
  await QRCode.toFile(png, 'BP2-0418-7731', { margin: 2, width: 160 });
  const jpg = path.join(dir, 'frame.jpg');
  // 1080x1440 gray scene with the 160 px code placed off-center, like a small label on the unit
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x8a8f96:s=1080x1440', '-i', png, '-filter_complex', 'overlay=620:900', '-frames:v', '1', '-q:v', '3', jpg]);
  assert.equal(decodeQr(fs.readFileSync(jpg)), 'BP2-0418-7731');
});

test('no code, garbage, or non-JPEG input returns null without throwing', () => {
  assert.equal(decodeQr(fs.readFileSync(path.resolve('test/fixtures/frame.jpg'))), null);
  assert.equal(decodeQr(Buffer.from([0xff, 0xd8, 1, 2, 3])), null);
  assert.equal(decodeQr(Buffer.from('hello')), null);
});
