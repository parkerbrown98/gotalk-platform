import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { clientRelease, FakeGitHub } from '../../../test/fake-github.ts';
import { GitHubClient, GitHubError, normalizeReleases } from './github.ts';

const ref = { owner: 'parkerbrown98', repo: 'gotalk-client' };
const fake = new FakeGitHub();
let client: GitHubClient;

beforeAll(async () => {
  client = new GitHubClient({ apiUrl: await fake.start(), token: 'tok', timeoutMs: 300 });
});
afterAll(() => fake.stop());
afterEach(() => {
  fake.mode = 'ok';
  fake.releases.clear();
  fake.requests = [];
});

describe('GitHubClient', () => {
  it('reads and normalizes releases, newest first, without drafts', async () => {
    fake.releases.set('parkerbrown98/gotalk-client', [
      clientRelease('0.1.0-beta.1', { day: 1 }),
      clientRelease('0.2.0', { day: 9 }),
      clientRelease('0.3.0-beta.1', { day: 20, draft: true }),
    ]);
    const res = await client.listReleases(ref);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.releases.map((r) => r.tag)).toEqual(['v0.2.0', 'v0.1.0-beta.1']);
    const r = res.releases[0];
    expect(r).toMatchObject({
      version: '0.2.0',
      prerelease: false,
      name: 'Gotalk v0.2.0',
      notes: 'Release v0.2.0.',
    });
    expect(r.assets[1]).toEqual({
      name: 'Gotalk_0.2.0_aarch64.dmg',
      size: 5_775_773,
      url: 'https://github.com/parkerbrown98/gotalk-client/releases/download/v0.2.0/Gotalk_0.2.0_aarch64.dmg',
      sha256: 'b'.repeat(64),
    });
    expect(fake.requests[0]).toMatchObject({
      path: '/repos/parkerbrown98/gotalk-client/releases',
      authorization: 'Bearer tok',
    });
  });

  it('sends the ETag back and reports an unchanged list', async () => {
    fake.releases.set('parkerbrown98/gotalk-client', [clientRelease('0.2.0')]);
    const first = await client.listReleases(ref);
    expect(first.etag).toBeTruthy();
    const second = await client.listReleases(ref, first.etag);
    expect(second).toEqual({ status: 'not-modified', etag: first.etag });
    expect(fake.requests[1].ifNoneMatch).toBe(first.etag);
  });

  it.each([
    ['down', 'GitHub answered HTTP 503'],
    ['malformed', 'malformed release list'],
    ['hang', 'GitHub timed out'],
  ] as const)('fails with a GitHubError when GitHub is %s', async (mode, message) => {
    fake.mode = mode;
    await expect(client.listReleases(ref)).rejects.toThrow(message);
  });

  it('reports when a rate limit resets', async () => {
    fake.mode = 'rate-limited';
    const err = await client.listReleases(ref).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).status).toBe(403);
    expect((err as GitHubError).retryAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it('reports an unreachable API', async () => {
    const offline = new GitHubClient({ apiUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
    await expect(offline.listReleases(ref)).rejects.toThrow('GitHub unreachable');
  });
});

describe('normalizeReleases', () => {
  it('skips unpublished entries and assets that are still uploading, and tolerates missing digests', () => {
    const r = clientRelease('1.0.0');
    r.assets[0].state = 'starter';
    r.assets[1].digest = null;
    const [out] = normalizeReleases([r, { ...clientRelease('1.1.0'), published_at: null }]);
    expect(out.tag).toBe('v1.0.0');
    expect(out.assets).toHaveLength(r.assets.length - 1);
    expect(out.assets[0].sha256).toBeUndefined();
  });
});
