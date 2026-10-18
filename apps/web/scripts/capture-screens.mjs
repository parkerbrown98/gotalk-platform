// Captures product screenshots from the client's static mockups (gotalk-client/docs/mockups) into
// src/assets/screens. Run it when the mockups change; the PNGs are committed and Astro turns them into
// AVIF and WebP at build time.
//
//   pnpm --filter @gotalk-platform/web capture:screens [path/to/gotalk-client]
//
// The client checkout defaults to ../../../gotalk-client (a sibling of this repo). Its tokens stylesheet
// must exist (`pnpm --filter @gotalk/tokens build` in the client), and Inter loads from Google Fonts, so the
// script needs network access.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(process.argv[2] ?? resolve(here, '../../../../gotalk-client'));
const mockups = resolve(clientDir, 'docs/mockups');
const outDir = resolve(here, '../src/assets/screens');

/** name: output file name. file: mockup page. frame: zero-based index of `figure.frame` on that page. */
const shots = [
  { name: 'forum-topic', file: '06-forums.html', frame: 1 },
  { name: 'forum-board', file: '06-forums.html', frame: 0 },
  { name: 'feed', file: '17-feeds.html', frame: 0 },
  { name: 'chat', file: '07-chat.html', frame: 0 },
  { name: 'voice', file: '08-voice.html', frame: 0 },
  { name: 'moderation', file: '13-moderation.html', frame: 0 },
  { name: 'roles', file: '14-roles-permissions.html', frame: 1 },
  { name: 'developer', file: '16-developer.html', frame: 0 },
  { name: 'welcome', file: '21-welcome.html', frame: 0 },
  { name: 'server-settings', file: '20-server-settings.html', frame: 0 },
  { name: 'compose', file: '10-forums-more.html', frame: 2 },
];

// Text in the mockups that is out of date for marketing use.
const replacements = [['app.gotalk.io', 'app.gotalk.sh']];

if (!existsSync(resolve(clientDir, 'packages/tokens/dist/tokens.css'))) {
  console.error(`Missing ${clientDir}/packages/tokens/dist/tokens.css. Build the client's tokens first.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
try {
  for (const shot of shots) {
    await page.goto(pathToFileURL(resolve(mockups, shot.file)).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((pairs) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const [from, to] of pairs) node.nodeValue = node.nodeValue?.replaceAll(from, to) ?? null;
      }
    }, replacements);
    const frame = page.locator('figure.frame').nth(shot.frame);
    const target = frame.locator(':scope > :not(figcaption)').first();
    const caption = (await frame.locator('figcaption').first().textContent())?.trim().slice(0, 80);
    await target.screenshot({ path: resolve(outDir, `${shot.name}.png`), animations: 'disabled' });
    console.log(`${shot.name}.png  <- ${shot.file} #${shot.frame}: ${caption}`);
  }
} finally {
  await browser.close();
}
