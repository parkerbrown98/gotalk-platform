import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { GitHubError, type FetchResult } from './github.ts';
import type { Release, RepoKey, RepoRef, RepoState, Snapshot } from './types.ts';

export interface ReleaseSource {
  listReleases(ref: RepoRef, etag?: string): Promise<FetchResult>;
}

export type Logger = (level: 'info' | 'warn', message: string) => void;

export interface StoreOptions {
  source: ReleaseSource;
  repos: Record<RepoKey, RepoRef>;
  /** Releases baked into the build, used until something newer is known. */
  seed?: Snapshot;
  /** Where the latest releases are saved, so a restart during a GitHub outage still has them. */
  snapshotFile?: string;
  /** How often releases are re-read from GitHub. */
  refreshMs?: number;
  /** How long a request waits for the first fetch when nothing at all is known yet. */
  coldWaitMs?: number;
  now?: () => number;
  log?: Logger;
}

/** What a page renders from: the releases known now, and whether the last refresh failed. */
export interface RepoView {
  releases: Release[];
  /** When GitHub last answered, or null if it never has (no build snapshot, no saved file). */
  fetchedAt: Date | null;
  /** The last attempt to refresh failed; `releases` may be out of date. */
  stale: boolean;
}

interface Entry extends RepoState {
  /** Do not ask GitHub again before this time (ms), unless forced. */
  nextAttempt: number;
  failures: number;
  error?: string;
}

const MIN_BACKOFF_MS = 30_000;

function emptyEntry(): Entry {
  return { releases: [], fetchedAt: null, nextAttempt: 0, failures: 0 };
}

function isSnapshot(v: unknown): v is Snapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Snapshot;
  return s.version === 1 && typeof s.repos === 'object' && s.repos !== null;
}

function isRepoState(v: unknown): v is RepoState {
  if (!v || typeof v !== 'object') return false;
  const s = v as RepoState;
  return Array.isArray(s.releases) && (s.fetchedAt === null || typeof s.fetchedAt === 'string');
}

const newer = (a?: RepoState, b?: RepoState) => ((a?.fetchedAt ?? '') >= (b?.fetchedAt ?? '') ? a : b);

/**
 * Keeps the latest releases of each repository in memory and refreshes them from GitHub on a timer, on
 * demand and on webhooks. Whatever was last known is always served: a GitHub outage, rate limit or bad
 * response leaves the previous releases in place and backs off.
 */
export class ReleaseStore {
  private readonly opts: Required<Omit<StoreOptions, 'seed' | 'snapshotFile'>> &
    Pick<StoreOptions, 'seed' | 'snapshotFile'>;
  private readonly entries: Record<RepoKey, Entry>;
  private readonly inflight = new Map<RepoKey, Promise<void>>();
  private loading?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private saved = false;
  /** Saves run one after another, so two refreshes finishing together cannot race on the file. */
  private saving: Promise<void> = Promise.resolve();

  constructor(opts: StoreOptions) {
    this.opts = {
      ...opts,
      refreshMs: opts.refreshMs ?? 5 * 60_000,
      coldWaitMs: opts.coldWaitMs ?? 6000,
      now: opts.now ?? Date.now,
      log: opts.log ?? ((level, message) => console[level](`[releases] ${message}`)),
    };
    this.entries = { client: emptyEntry(), server: emptyEntry() };
  }

  get repoKeys(): RepoKey[] {
    return Object.keys(this.opts.repos) as RepoKey[];
  }

  /** The repository a GitHub `owner/name` refers to, if the site tracks it. */
  keyFor(fullName: string): RepoKey | undefined {
    const wanted = fullName.toLowerCase();
    return this.repoKeys.find((k) => {
      const r = this.opts.repos[k];
      return `${r.owner}/${r.repo}`.toLowerCase() === wanted;
    });
  }

  async get(key: RepoKey): Promise<RepoView> {
    await this.load();
    const entry = this.entries[key];
    if (this.opts.now() >= entry.nextAttempt) {
      const refreshing = this.refresh(key);
      if (entry.fetchedAt === null && entry.releases.length === 0) {
        // Nothing to show yet: give the first fetch a moment instead of rendering an empty page.
        await Promise.race([refreshing, new Promise((r) => setTimeout(r, this.opts.coldWaitMs).unref?.())]);
      }
    }
    return this.view(key);
  }

  /** Re-reads a repository's releases. Concurrent calls share one request; `force` skips the backoff. */
  refresh(key: RepoKey, { force = false } = {}): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    if (!force && this.opts.now() < this.entries[key].nextAttempt) return Promise.resolve();
    const p = this.doRefresh(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Refreshes every repository when due, every 30 seconds, until `stop`. */
  start(): void {
    if (this.timer) return;
    const tick = () => {
      void this.load().then(() => Promise.all(this.repoKeys.map((k) => this.refresh(k))));
    };
    this.timer = setInterval(tick, Math.min(30_000, this.opts.refreshMs));
    this.timer.unref?.();
    tick();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private view(key: RepoKey): RepoView {
    const e = this.entries[key];
    return {
      releases: e.releases,
      fetchedAt: e.fetchedAt ? new Date(e.fetchedAt) : null,
      stale: e.error !== undefined,
    };
  }

  private async doRefresh(key: RepoKey): Promise<void> {
    await this.load();
    const entry = this.entries[key];
    const ref = this.opts.repos[key];
    let result: FetchResult;
    try {
      result = await this.opts.source.listReleases(ref, entry.etag);
    } catch (err) {
      entry.failures++;
      entry.error = err instanceof Error ? err.message : String(err);
      const backoff = Math.min(MIN_BACKOFF_MS * 2 ** (entry.failures - 1), this.opts.refreshMs);
      const retryAt = err instanceof GitHubError ? err.retryAt?.getTime() : undefined;
      entry.nextAttempt = Math.max(this.opts.now() + backoff, retryAt ?? 0);
      this.opts.log(
        'warn',
        `refreshing ${ref.owner}/${ref.repo} failed (${entry.error}); serving releases from ${entry.fetchedAt ?? 'nowhere'}`,
      );
      return;
    }

    const now = this.opts.now();
    entry.fetchedAt = new Date(now).toISOString();
    entry.etag = result.etag;
    entry.nextAttempt = now + this.opts.refreshMs;
    if (entry.error) this.opts.log('info', `${ref.owner}/${ref.repo} reachable again`);
    entry.failures = 0;
    entry.error = undefined;
    if (result.status === 'ok') {
      const before = entry.releases[0]?.tag;
      entry.releases = result.releases;
      if (result.releases[0]?.tag !== before) {
        this.opts.log(
          'info',
          `${ref.owner}/${ref.repo} latest release is ${result.releases[0]?.tag ?? 'none'}`,
        );
      }
    }
    // Save new releases, and the first confirmation of releases that came from the build snapshot.
    if (result.status === 'ok' || !this.saved) await this.save();
  }

  /** Loads the saved and build-time snapshots once, keeping whichever is newer for each repository. */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      let saved: Snapshot | undefined;
      if (this.opts.snapshotFile) {
        try {
          const parsed: unknown = JSON.parse(await readFile(this.opts.snapshotFile, 'utf8'));
          if (isSnapshot(parsed)) saved = parsed;
          else this.opts.log('warn', `ignoring ${this.opts.snapshotFile}: not a release snapshot`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.opts.log('warn', `could not read ${this.opts.snapshotFile}: ${(err as Error).message}`);
          }
        }
      }
      for (const key of this.repoKeys) {
        const candidates = [saved?.repos[key], this.opts.seed?.repos[key]].filter(isRepoState);
        const best = candidates.reduce<RepoState | undefined>((a, b) => newer(a, b), undefined);
        if (best)
          Object.assign(this.entries[key], {
            releases: best.releases,
            fetchedAt: best.fetchedAt,
            etag: best.etag,
          });
      }
    })();
    return this.loading;
  }

  private save(): Promise<void> {
    this.saving = this.saving.then(() => this.write());
    return this.saving;
  }

  private async write(): Promise<void> {
    const file = this.opts.snapshotFile;
    if (!file) return;
    const snapshot: Snapshot = { version: 1, savedAt: new Date(this.opts.now()).toISOString(), repos: {} };
    for (const key of this.repoKeys) {
      const { releases, fetchedAt, etag } = this.entries[key];
      snapshot.repos[key] = { releases, fetchedAt, etag };
    }
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(tmp, JSON.stringify(snapshot));
      await rename(tmp, file);
      this.saved = true;
    } catch (err) {
      this.opts.log('warn', `could not save ${file}: ${(err as Error).message}`);
    }
  }
}
