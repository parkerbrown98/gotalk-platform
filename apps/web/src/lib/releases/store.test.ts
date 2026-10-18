import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientRelease, serverRelease } from '../../../test/fake-github.ts';
import { GitHubError, normalizeReleases, type FetchResult } from './github.ts';
import { trackedRepos } from './repos.ts';
import { ReleaseStore, type ReleaseSource } from './store.ts';
import type { RepoRef, Snapshot } from './types.ts';

/** A scripted release source: answers from `next`, records calls. */
class Source implements ReleaseSource {
  calls: { repo: string; etag?: string }[] = [];
  answers = new Map<string, (() => FetchResult | Promise<FetchResult>)[]>();

  queue(repo: 'gotalk-client' | 'gotalk-server', ...fns: (() => FetchResult | Promise<FetchResult>)[]) {
    this.answers.set(repo, [...(this.answers.get(repo) ?? []), ...fns]);
  }

  async listReleases(ref: RepoRef, etag?: string): Promise<FetchResult> {
    this.calls.push({ repo: ref.repo, etag });
    const next = this.answers.get(ref.repo)?.shift();
    if (!next) throw new GitHubError('no scripted answer', 503);
    return next();
  }
}

const ok =
  (...versions: string[]) =>
  (): FetchResult => ({
    status: 'ok',
    releases: normalizeReleases(versions.map((v, i) => clientRelease(v, { day: 10 - i }))),
    etag: `"${versions.join(',')}"`,
  });
const notModified = (): FetchResult => ({ status: 'not-modified', etag: '"same"' });
const fail =
  (status = 503, retryAt?: Date) =>
  (): FetchResult => {
    throw new GitHubError(`GitHub answered HTTP ${status}`, status, retryAt);
  };

function setup(opts: { seed?: Snapshot; snapshotFile?: string } = {}) {
  let now = Date.UTC(2030, 5, 1);
  const source = new Source();
  const logs: string[] = [];
  const store = new ReleaseStore({
    source,
    repos: trackedRepos,
    refreshMs: 300_000,
    coldWaitMs: 200,
    now: () => now,
    log: (level, message) => logs.push(`${level}: ${message}`),
    ...opts,
  });
  return { store, source, logs, advance: (ms: number) => (now += ms) };
}

afterEach(() => vi.useRealTimers());

describe('ReleaseStore', () => {
  it('fetches on first use, then serves from memory until the refresh interval passes', async () => {
    const { store, source, advance } = setup();
    source.queue('gotalk-client', ok('0.2.0', '0.1.0'), notModified);
    const view = await store.get('client');
    expect(view.releases.map((r) => r.tag)).toEqual(['v0.2.0', 'v0.1.0']);
    expect(view.stale).toBe(false);
    expect(view.fetchedAt?.toISOString()).toBe('2030-06-01T00:00:00.000Z');

    await store.get('client');
    expect(source.calls).toHaveLength(1);

    advance(300_000);
    await store.get('client');
    await store.refresh('client'); // wait for the background refresh the read started
    expect(source.calls).toHaveLength(2);
    expect(source.calls[1].etag).toBe('"0.2.0,0.1.0"');
    expect((await store.get('client')).releases).toHaveLength(2);
  });

  it('keeps serving the last releases through an outage, marked stale, and backs off', async () => {
    const { store, source, logs, advance } = setup();
    source.queue('gotalk-client', ok('0.2.0'), fail(), fail(), ok('0.3.0', '0.2.0'));
    await store.get('client');

    advance(300_000);
    await store.refresh('client');
    let view = await store.get('client');
    expect(view.releases.map((r) => r.tag)).toEqual(['v0.2.0']);
    expect(view.stale).toBe(true);
    expect(logs.at(-1)).toMatch(/failed .*serving releases from 2030-06-01/);

    await store.refresh('client');
    expect(source.calls).toHaveLength(2); // backing off: 30 s after the first failure
    advance(30_000);
    await store.refresh('client');
    expect(source.calls).toHaveLength(3);
    advance(30_000);
    await store.refresh('client');
    expect(source.calls).toHaveLength(3); // 60 s after the second failure
    advance(30_000);
    await store.refresh('client');
    view = await store.get('client');
    expect(view.releases[0].tag).toBe('v0.3.0');
    expect(view.stale).toBe(false);
    expect(logs.at(-2)).toMatch(/reachable again/);
  });

  it('waits out a rate limit, unless forced by a webhook', async () => {
    const { store, source, advance } = setup();
    const reset = new Date(Date.UTC(2030, 5, 1, 1));
    source.queue('gotalk-client', fail(403, reset), ok('0.2.0'), ok('0.3.0'));
    await store.get('client');
    advance(10 * 60_000);
    await store.refresh('client');
    expect(source.calls).toHaveLength(1);
    await store.refresh('client', { force: true });
    expect((await store.get('client')).releases[0].tag).toBe('v0.2.0');
  });

  it('shares one request between concurrent readers', async () => {
    const { store, source } = setup();
    let release!: () => void;
    source.queue('gotalk-client', () => new Promise((r) => (release = () => r(ok('0.2.0')()))));
    const reads = [store.get('client'), store.get('client'), store.refresh('client', { force: true })];
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await Promise.all(reads);
    expect(source.calls).toHaveLength(1);
  });

  it('renders without releases when nothing is known and GitHub does not answer in time', async () => {
    const { store, source } = setup();
    source.queue('gotalk-client', () => new Promise(() => {}));
    const started = Date.now();
    const view = await store.get('client');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(view).toEqual({ releases: [], fetchedAt: null, stale: false });
  });

  it('starts from the build snapshot and replaces it once GitHub answers', async () => {
    const seed: Snapshot = {
      version: 1,
      savedAt: '2030-05-01T00:00:00.000Z',
      repos: {
        client: {
          releases: normalizeReleases([clientRelease('0.1.0')]),
          fetchedAt: '2030-05-01T00:00:00.000Z',
          etag: '"seed"',
        },
      },
    };
    const { store, source } = setup({ seed });
    source.queue('gotalk-client', fail());
    // Due at once (the seed is old), but the seed is served while the refresh runs and after it fails.
    let view = await store.get('client');
    expect(view.releases[0].tag).toBe('v0.1.0');
    await store.refresh('client');
    view = await store.get('client');
    expect(view).toMatchObject({ stale: true, fetchedAt: new Date('2030-05-01T00:00:00.000Z') });
    expect(source.calls[0].etag).toBe('"seed"');
  });

  it('saves releases to the data directory and prefers them over an older build snapshot after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'releases-'));
    const snapshotFile = join(dir, 'nested', 'releases.json');
    const seed: Snapshot = {
      version: 1,
      savedAt: '2030-01-01T00:00:00.000Z',
      repos: { client: { releases: [], fetchedAt: '2030-01-01T00:00:00.000Z' } },
    };

    const first = setup({ seed, snapshotFile });
    first.source.queue('gotalk-client', ok('0.2.0'));
    first.source.queue('gotalk-server', () => ({
      status: 'ok',
      releases: normalizeReleases([serverRelease('0.1.0')]),
    }));
    await first.store.get('client');
    await first.store.get('server');
    const saved = JSON.parse(await readFile(snapshotFile, 'utf8')) as Snapshot;
    expect(saved.repos.client?.releases[0].tag).toBe('v0.2.0');
    expect(saved.repos.server?.releases[0].tag).toBe('v0.1.0');

    // Restart while GitHub is down: the saved releases win over the build snapshot.
    const second = setup({ seed, snapshotFile });
    second.source.queue('gotalk-client', fail());
    const view = await second.store.get('client');
    expect(view.releases[0].tag).toBe('v0.2.0');
    expect(second.source.calls[0].etag).toBe('"0.2.0"');
  });

  it('saves the first confirmation of build-snapshot releases, so the data directory is seeded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'releases-'));
    const snapshotFile = join(dir, 'releases.json');
    const releases = normalizeReleases([clientRelease('0.1.0')]);
    const seed: Snapshot = {
      version: 1,
      savedAt: '2030-05-01T00:00:00.000Z',
      repos: { client: { releases, fetchedAt: '2030-05-01T00:00:00.000Z' } },
    };
    const { store, source } = setup({ seed, snapshotFile });
    source.queue('gotalk-client', notModified);
    await store.get('client');
    await store.refresh('client');
    const saved = JSON.parse(await readFile(snapshotFile, 'utf8')) as Snapshot;
    expect(saved.repos.client).toMatchObject({ fetchedAt: '2030-06-01T00:00:00.000Z', etag: '"same"' });
  });

  it('saves one repository after another when refreshes finish together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'releases-'));
    const snapshotFile = join(dir, 'releases.json');
    const { store, source, logs } = setup({ snapshotFile });
    source.queue('gotalk-client', ok('0.2.0'));
    source.queue('gotalk-server', () => ({
      status: 'ok',
      releases: normalizeReleases([serverRelease('0.1.0')]),
    }));
    await Promise.all([store.refresh('client'), store.refresh('server')]);
    expect(logs.filter((l) => l.startsWith('warn'))).toEqual([]);
    const saved = JSON.parse(await readFile(snapshotFile, 'utf8')) as Snapshot;
    expect(Object.keys(saved.repos).sort()).toEqual(['client', 'server']);
    expect(saved.repos.server?.releases[0].tag).toBe('v0.1.0');
  });

  it('ignores a corrupt saved file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'releases-'));
    const snapshotFile = join(dir, 'releases.json');
    await writeFile(snapshotFile, '{"version":7}');
    const { store, source, logs } = setup({ snapshotFile });
    source.queue('gotalk-client', ok('0.2.0'));
    expect((await store.get('client')).releases[0].tag).toBe('v0.2.0');
    expect(logs[0]).toMatch(/not a release snapshot/);
  });

  it('keeps working when the data directory cannot be written', async () => {
    const { store, source, logs } = setup({ snapshotFile: '/dev/null/releases.json' });
    source.queue('gotalk-client', ok('0.2.0'));
    expect((await store.get('client')).releases[0].tag).toBe('v0.2.0');
    expect(logs.some((l) => l.includes('could not save'))).toBe(true);
  });

  it('maps GitHub repository names to tracked repositories', () => {
    const { store } = setup();
    expect(store.keyFor('ParkerBrown98/Gotalk-Server')).toBe('server');
    expect(store.keyFor('someone/gotalk-server')).toBeUndefined();
  });
});
