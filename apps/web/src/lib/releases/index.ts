import { join } from 'node:path';

import { GitHubClient } from './github.ts';
import { trackedRepos } from './repos.ts';
import { ReleaseStore } from './store.ts';
import type { Snapshot } from './types.ts';

export interface ReleaseSettings {
  apiUrl?: string;
  token?: string;
  webhookSecret?: string;
  refreshMs: number;
  snapshotFile?: string;
}

/** Reads the release settings from the environment (see docs/deployment.md). */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ReleaseSettings {
  const seconds = Number(env.RELEASES_REFRESH_SECONDS ?? 300);
  if (!Number.isInteger(seconds) || seconds < 60) {
    console.warn(`[releases] RELEASES_REFRESH_SECONDS must be a whole number of at least 60; using 300`);
  }
  return {
    apiUrl: env.GITHUB_API_URL || undefined,
    token: env.GITHUB_TOKEN || undefined,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || undefined,
    refreshMs: (Number.isInteger(seconds) && seconds >= 60 ? seconds : 300) * 1000,
    snapshotFile: env.DATA_DIR ? join(env.DATA_DIR, 'releases.json') : undefined,
  };
}

// Written by integrations/releases.mjs at build time. Missing in a build that could not reach GitHub.
const seeds = import.meta.glob<Snapshot>('../../generated/releases-snapshot.json', {
  eager: true,
  import: 'default',
});

let store: ReleaseStore | undefined;
let settings: ReleaseSettings | undefined;

export function releaseSettings(): ReleaseSettings {
  settings ??= settingsFromEnv();
  return settings;
}

/** The process-wide release store. It starts refreshing in the background on first use. */
export function releaseStore(): ReleaseStore {
  if (!store) {
    const s = releaseSettings();
    store = new ReleaseStore({
      source: new GitHubClient({
        apiUrl: s.apiUrl,
        token: s.token,
        userAgent: 'gotalk-platform (+https://gotalk.sh)',
      }),
      repos: trackedRepos,
      seed: Object.values(seeds)[0],
      snapshotFile: s.snapshotFile,
      refreshMs: s.refreshMs,
    });
    store.start();
  }
  return store;
}

/**
 * Cache headers for pages built from release data. The CDN keeps a page for two minutes and may serve it
 * stale while it revalidates, or for a day if the origin is down. Without any release data, the page is
 * barely cached so it recovers quickly.
 */
export function releaseCacheControl(hasData: boolean): string {
  return hasData
    ? 'public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400'
    : 'public, max-age=0, s-maxage=30';
}
