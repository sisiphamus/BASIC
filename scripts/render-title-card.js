// Renders docs/assets/title-card.html to the README's title card PNG (2x, 2560×960).
//   node scripts/render-title-card.js
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHROME } from '../test/e2e/helpers.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets');
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 480 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(dir, 'title-card.html')).href);
await page.evaluate(() => document.fonts.ready);
const fonts = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight}: ${f.status}`));
console.log(fonts.join('\n'));
await page.screenshot({ path: path.join(dir, 'title-card.png') });
await browser.close();
