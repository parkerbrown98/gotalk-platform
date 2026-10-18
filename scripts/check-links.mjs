// Checks that every internal link and asset reference in the built site resolves to a file.
//
//   node scripts/check-links.mjs apps/web/dist/client
//
// External links are not fetched; CI should not fail because a third-party site is down.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'apps/web/dist/client');
if (!existsSync(root)) {
  console.error(`No build output at ${root}. Run the build first.`);
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
})(root);

const pages = files.filter((f) => f.endsWith('.html'));
const ids = new Map(
  pages.map((f) => [f, new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]),
);

/** Resolves a site path to the file the server would send, mirroring `build.format: 'file'`. */
function target(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/$/, '');
  for (const candidate of [clean, `${clean}.html`, `${clean}/index.html`]) {
    const path = join(root, candidate);
    if (candidate && existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

const attr = /\s(?:href|src)="([^"]+)"|\ssrcset="([^"]+)"/g;
const problems = [];
let checked = 0;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const from = '/' + relative(root, page).replace(/(index)?\.html$/, '');
  for (const m of html.matchAll(attr)) {
    const refs = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().split(/\s+/)[0]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|data:)/.test(ref) || ref.startsWith('//')) continue;
      checked++;
      const url = new URL(ref, `https://site.invalid${from}`);
      const file = url.pathname === '/' ? join(root, 'index.html') : target(url.pathname);
      if (!file) {
        problems.push(`${relative(root, page)}: ${ref} (no such file)`);
        continue;
      }
      const hash = url.hash.slice(1);
      if (hash && file.endsWith('.html') && !ids.get(file)?.has(decodeURIComponent(hash))) {
        problems.push(`${relative(root, page)}: ${ref} (no element with id "${hash}")`);
      }
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} broken internal link(s):\n` + problems.map((p) => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check-links: ${checked} internal references across ${pages.length} pages resolve.`);
