import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A release as the GitHub REST API returns it, trimmed to the fields the site reads. */
export interface ApiRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets: {
    name: string;
    size: number;
    browser_download_url: string;
    digest?: string | null;
    state?: string;
  }[];
}

export type Mode = 'ok' | 'down' | 'rate-limited' | 'malformed' | 'hang';

/**
 * A fake of GitHub's `GET /repos/{owner}/{repo}/releases`, with ETags, outages, rate limits and slow
 * answers. Tests set `releases` per `owner/repo` and switch `mode`.
 */
export class FakeGitHub {
  releases = new Map<string, ApiRelease[]>();
  mode: Mode = 'ok';
  requests: { path: string; ifNoneMatch?: string; authorization?: string }[] = [];
  url = '';
  private server?: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://fake');
      this.requests.push({
        path: url.pathname,
        ifNoneMatch: req.headers['if-none-match'] as string | undefined,
        authorization: req.headers.authorization,
      });
      const m = /^\/repos\/([^/]+)\/([^/]+)\/releases$/.exec(url.pathname);
      if (this.mode === 'hang') return; // never answers
      if (this.mode === 'down') {
        res.writeHead(503).end('unavailable');
        return;
      }
      if (this.mode === 'rate-limited') {
        res
          .writeHead(403, {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
          })
          .end('{"message":"API rate limit exceeded"}');
        return;
      }
      if (!m) {
        res.writeHead(404).end('{"message":"Not Found"}');
        return;
      }
      if (this.mode === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"oops":');
        return;
      }
      const body = JSON.stringify(this.releases.get(`${m[1]}/${m[2]}`) ?? []);
      const etag = `W/"${Buffer.from(body).toString('base64url').slice(-16)}${body.length}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', etag }).end(body);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise((resolve) => this.server?.close(resolve));
  }
}

const sha = (seed: string) => seed.repeat(64).slice(0, 64);

/** A client release with the asset names the client's release workflow publishes. */
export function clientRelease(
  version: string,
  opts: Partial<ApiRelease> & { day?: number } = {},
): ApiRelease {
  const { day = 1, ...overrides } = opts;
  const tag = `v${version}`;
  const base = `https://github.com/parkerbrown98/gotalk-client/releases/download/${tag}`;
  const file = (name: string, size: number, seed: string) => ({
    name,
    size,
    browser_download_url: `${base}/${name}`,
    digest: `sha256:${sha(seed)}`,
    state: 'uploaded',
  });
  const v = version.replace(/-.*/, '');
  return {
    tag_name: tag,
    name: `Gotalk ${tag}`,
    draft: false,
    prerelease: version.includes('-'),
    published_at: new Date(Date.UTC(2030, 0, day)).toISOString(),
    html_url: `https://github.com/parkerbrown98/gotalk-client/releases/tag/${tag}`,
    body: `Release ${tag}.`,
    assets: [
      file(`Gotalk-${v}-1.x86_64.rpm`, 6_149_574, 'a'),
      file(`Gotalk_${v}_aarch64.dmg`, 5_775_773, 'b'),
      file(`Gotalk_${v}_amd64.AppImage`, 84_703_736, 'c'),
      file(`Gotalk_${v}_amd64.deb`, 6_148_340, 'd'),
      file(`Gotalk_${v}_x64-setup.exe`, 5_054_199, 'e'),
      file(`Gotalk_${v}_x64.dmg`, 5_956_379, 'f'),
      file(`Gotalk_${v}_x64_en-US.msi`, 5_640_192, '1'),
      file('Gotalk_aarch64.app.tar.gz', 5_556_906, '2'),
    ],
    ...overrides,
  };
}

/** A server release with the archive names the server's release workflow publishes. */
export function serverRelease(
  version: string,
  opts: Partial<ApiRelease> & { day?: number } = {},
): ApiRelease {
  const { day = 1, ...overrides } = opts;
  const tag = `v${version}`;
  const base = `https://github.com/parkerbrown98/gotalk-server/releases/download/${tag}`;
  const file = (name: string, seed: string) => ({
    name,
    size: 10_000_000,
    browser_download_url: `${base}/${name}`,
    digest: `sha256:${sha(seed)}`,
    state: 'uploaded',
  });
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: version.includes('-'),
    published_at: new Date(Date.UTC(2030, 0, day)).toISOString(),
    html_url: `https://github.com/parkerbrown98/gotalk-server/releases/tag/${tag}`,
    body: '**Full Changelog**: https://github.com/parkerbrown98/gotalk-server/commits/' + tag,
    assets: [
      file('checksums.txt', '0'),
      ...['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64'].map((p, i) =>
        file(`gotalk-server_${version}_${p}.tar.gz`, String(i + 3)),
      ),
      file(`gotalk-server_${version}_windows_amd64.zip`, '9'),
    ],
    ...overrides,
  };
}
