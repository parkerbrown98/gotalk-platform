// End-to-end checks of the built site (`pnpm build` first): the server renders /download, /self-host and
// /changelog from a fake GitHub API, picks up a new release from a signed webhook without a deploy, and
// keeps serving the last known releases when GitHub is down, including after a restart.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clientRelease, FakeGitHub, serverRelease } from './fake-github.ts';

const entry = fileURLToPath(new URL('../dist/server/entry.mjs', import.meta.url));
const SECRET = 'test-webhook-secret';
const CLIENT = 'parkerbrown98/gotalk-client';
const SERVER = 'parkerbrown98/gotalk-server';

const fake = new FakeGitHub();
let dataDir: string;
let site: { url: string; proc: ChildProcess } | undefined;

async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  await new Promise((r) => srv.close(r));
  return port;
}

async function startSite() {
  const port = await freePort();
  const proc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      GITHUB_API_URL: fake.url,
      GITHUB_TOKEN: '',
      GITHUB_WEBHOOK_SECRET: SECRET,
      DATA_DIR: dataDir,
      RELEASES_REFRESH_SECONDS: '60',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://127.0.0.1:${port}`;
  await eventually(async () => expect((await fetch(`${url}/healthz`)).status).toBe(200));
  site = { url, proc };
}

async function stopSite() {
  if (!site) return;
  const exited = new Promise((r) => site!.proc.once('exit', r));
  site.proc.kill('SIGTERM');
  await exited;
  site = undefined;
}

async function eventually(check: () => Promise<void>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function page(path: string) {
  const res = await fetch(site!.url + path);
  return { status: res.status, headers: res.headers, html: await res.text() };
}

function webhook(event: string, payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  return fetch(`${site!.url}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
    },
    body,
  });
}

beforeAll(async () => {
  if (!existsSync(entry)) throw new Error('Build the site first: pnpm build');
  dataDir = await mkdtemp(join(tmpdir(), 'gotalk-site-'));
  await fake.start();
  fake.releases.set(CLIENT, [clientRelease('9.0.0-beta.1', { day: 1 })]);
  fake.releases.set(SERVER, [
    serverRelease('9.0.0-beta.1', {
      body: "## What's Changed\n* Faster setup <script>alert(1)</script> by @someone in https://github.com/parkerbrown98/gotalk-server/pull/1",
    }),
  ]);
  await startSite();
});

afterAll(async () => {
  await stopSite();
  await fake.stop();
});

describe('built site', () => {
  it('renders /download from the releases GitHub reports', async () => {
    let res!: Awaited<ReturnType<typeof page>>;
    await eventually(async () => {
      res = await page('/download');
      expect(res.html).toContain('Version 9.0.0-beta.1');
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400',
    );
    expect(res.html).toContain(
      'href="https://github.com/parkerbrown98/gotalk-client/releases/download/v9.0.0-beta.1/Gotalk_9.0.0_aarch64.dmg"',
    );
    expect(res.html).toContain('b'.repeat(64)); // the asset's SHA-256
    expect(res.html).toContain('every release so far is a pre-release');
    expect(res.html).not.toContain('channel=beta'); // no stable release, so no toggle
    expect(res.html).not.toContain('Gotalk_aarch64.app.tar.gz'); // updater bundle
    expect(res.html).toContain('"softwareVersion":"9.0.0-beta.1"');
    expect(res.html).toContain('https://app.gotalk.sh');
    expect(res.html).toContain('api.gotalk.sh');
    expect(res.html).toContain('id="primary-download"');
  });

  it('renders /self-host with the server release and the quick start from the server docs', async () => {
    let html = '';
    await eventually(async () => {
      html = (await page('/self-host')).html;
      expect(html).toContain('Server version 9.0.0-beta.1');
    });
    expect(html).toContain(
      'git clone --depth 1 --branch v9.0.0-beta.1 https://github.com/parkerbrown98/gotalk-server.git',
    );
    expect(html).toContain('docker compose up -d');
    expect(html).toContain('docker pull ghcr.io/parkerbrown98/gotalk-server:9.0.0-beta.1');
    expect(html).toContain('gotalk-server_9.0.0-beta.1_linux_arm64.tar.gz');
    expect(html).toContain('>checksums.txt</a>');
  });

  it('renders /changelog with sanitized release notes', async () => {
    let html = '';
    await eventually(async () => {
      html = (await page('/changelog')).html;
      expect(html).toContain('Gotalk server 9.0.0-beta.1');
    });
    expect(html).toContain('Gotalk apps 9.0.0-beta.1');
    expect(html).toContain("<h3>What's Changed</h3>");
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('rel="ugc nofollow noopener"');
    const apps = (await page('/changelog?product=apps')).html;
    expect(apps).toContain('Gotalk apps 9.0.0-beta.1');
    expect(apps).not.toContain('Gotalk server 9.0.0-beta.1');
  });

  it('every internal link on the on-demand pages resolves', async () => {
    const hrefs = new Set<string>();
    for (const path of ['/download', '/download?channel=beta', '/self-host', '/changelog']) {
      for (const m of (await page(path)).html.matchAll(/\s(?:href|src)="(\/[^/"][^"]*|\/)"/g)) {
        hrefs.add(m[1].replace(/#.*$/, '') || '/');
      }
    }
    expect(hrefs.size).toBeGreaterThan(10);
    for (const href of hrefs) {
      expect((await fetch(site!.url + href)).status, href).toBe(200);
    }
  });

  it('authenticates webhooks', async () => {
    expect((await webhook('ping', { zen: 'hi' }, 'wrong')).status).toBe(401);
    expect((await webhook('ping', { zen: 'hi' })).status).toBe(200);
    expect(await (await webhook('push', {})).json()).toEqual({ ignored: 'event push' });
    expect(
      await (await webhook('release', { action: 'published', repository: { full_name: 'x/y' } })).json(),
    ).toEqual({
      ignored: 'repository x/y',
    });
    const res = await fetch(`${site!.url}/api/webhooks/github`);
    expect(res.status).toBe(405);
  });

  it('shows a new release after a webhook, without a deploy, with the beta channel toggle', async () => {
    fake.releases.set(CLIENT, [
      clientRelease('9.2.0-beta.1', { day: 9 }),
      clientRelease('9.1.0', { day: 5 }),
      clientRelease('9.0.0-beta.1', { day: 1 }),
    ]);
    const res = await webhook('release', { action: 'published', repository: { full_name: CLIENT } });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ refreshing: 'client' });

    await eventually(async () => expect((await page('/download')).html).toContain('Version 9.1.0'), 3000);
    const stable = (await page('/download')).html;
    expect(stable).toContain('href="/download?channel=beta"');
    expect(stable).not.toContain('<span class="badge">Beta</span> Version');
    const beta = (await page('/download?channel=beta')).html;
    expect(beta).toContain('Version 9.2.0-beta.1');
    expect(beta).toContain('Get the stable release');
  });

  it('keeps serving the last releases when GitHub is down, and says so', async () => {
    fake.mode = 'down';
    await webhook('release', { action: 'edited', repository: { full_name: CLIENT } });
    await eventually(async () => {
      const { status, html } = await page('/download');
      expect(status).toBe(200);
      expect(html).toContain('Version 9.1.0');
      expect(html).toMatch(/couldn(&#39;|')t reach GitHub just now/);
    }, 3000);
  });

  it('serves the saved releases after a restart while GitHub is still down', async () => {
    await stopSite();
    await startSite();
    const { status, html, headers } = await page('/download');
    expect(status).toBe(200);
    expect(html).toContain('Version 9.1.0');
    expect(headers.get('cache-control')).toContain('s-maxage=120');
    fake.mode = 'ok';
  });
});
