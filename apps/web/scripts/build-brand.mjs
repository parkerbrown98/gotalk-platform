// Builds the favicon set, manifest icons and the default social image from the client's brand files
// (gotalk-client/docs/brand). Run it when the brand changes; the outputs in public/ are committed.
//
//   pnpm --filter @gotalk-platform/web build:brand [path/to/gotalk-client]
//
// The social image is rendered in Chromium with Inter from Google Fonts, so the script needs network access.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import sharp from 'sharp';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(process.argv[2] ?? resolve(here, '../../../../gotalk-client'));
const brand = resolve(clientDir, 'docs/brand');
const pub = resolve(here, '../public');
mkdirSync(resolve(pub, 'brand'), { recursive: true });

const svg = (name) => resolve(brand, `${name}.svg`);
const png = (name, size) => sharp(svg(name), { density: 384 }).resize(size, size).png().toBuffer();

for (const name of ['glyph', 'icon', 'icon-square', 'icon-macos']) {
  copyFileSync(svg(name), resolve(pub, 'brand', `${name}.svg`));
}
copyFileSync(svg('favicon'), resolve(pub, 'favicon.svg'));

writeFileSync(resolve(pub, 'apple-touch-icon.png'), await png('icon-square', 180));
writeFileSync(resolve(pub, 'icon-192.png'), await png('icon', 192));
writeFileSync(resolve(pub, 'icon-512.png'), await png('icon', 512));
writeFileSync(resolve(pub, 'icon-maskable-512.png'), await png('icon-square', 512));

// An .ico file is a small directory header followed by PNG images.
const icoSizes = [16, 32, 48];
const images = await Promise.all(icoSizes.map((s) => png('favicon', s)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], e);
  header.writeUInt8(icoSizes[i], e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync(resolve(pub, 'favicon.ico'), Buffer.concat([header, ...images]));

const glyph = readFileSync(svg('glyph'), 'utf8');
const ogHtml = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; box-sizing: border-box; padding: 88px 96px; display: flex;
    flex-direction: column; justify-content: space-between; font-family: Inter, sans-serif; color: #f4f4f6;
    background: radial-gradient(900px 520px at 12% 0%, rgba(255,87,87,0.16), rgba(255,87,87,0) 70%), #0e0f11; }
  .mark { display: flex; align-items: center; gap: 20px; font-size: 40px; font-weight: 600; }
  .mark svg { width: 64px; height: auto; }
  h1 { margin: 0; font-size: 68px; line-height: 1.1; font-weight: 600; letter-spacing: -0.5px; max-width: 980px; }
  p { margin: 0; font-size: 28px; color: #a8a9ab; }
</style></head><body>
  <div class="mark">${glyph}<span>Gotalk</span></div>
  <h1>The forum-first community platform you can host yourself.</h1>
  <p>Forums, chat and voice. Open source. gotalk.sh</p>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(ogHtml, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(
    resolve(pub, 'og-default.png'),
    await sharp(await page.screenshot())
      .png()
      .toBuffer(),
  );
} finally {
  await browser.close();
}

console.log('wrote public/favicon.{svg,ico}, apple-touch-icon.png, icon-*.png, og-default.png, brand/*.svg');
