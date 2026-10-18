import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GitHubClient } from '../src/lib/releases/github.ts';
import { trackedRepos } from '../src/lib/releases/repos.ts';

const QUICKSTART_HEADING = '## Quick start (Docker Compose)';

/**
 * Pulls the Docker Compose quick start from the server's getting-started guide, at the server's latest
 * release tag (or `main` before the first release), so /self-host never drifts from the server docs.
 *
 * @param {string} ref
 */
async function fetchQuickstart(ref) {
  const { owner, repo } = trackedRepos.server;
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/docs/getting-started.md`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const doc = await res.text();
  const start = doc.indexOf(QUICKSTART_HEADING);
  if (start < 0) throw new Error(`${url} has no "${QUICKSTART_HEADING}" section`);
  const block = /```(?:sh|bash|shell)\n([\s\S]*?)\n```/.exec(doc.slice(start));
  if (!block || !block[1].includes('docker compose up')) {
    throw new Error(`the quick start in ${url} no longer starts with a docker compose code block`);
  }
  return {
    ref,
    source: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(ref)}/docs/getting-started.md#quick-start-docker-compose`,
    code: block[1],
  };
}

/**
 * Bakes the latest releases of the client and server into the build, as the release cache's fallback for a
 * cold start while GitHub is unreachable, and pulls the server's Compose quick start for /self-host.
 *
 * The release snapshot is best effort: without it the site fetches releases at runtime. The quick start is
 * required: the build fails rather than ship a hand-copied snippet. `astro dev` and `astro check` reuse
 * existing files and only fetch what is missing.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function gotalkReleases() {
  return {
    name: 'gotalk-releases',
    hooks: {
      'astro:config:setup': async ({ command, config, logger }) => {
        const generated = (name) => fileURLToPath(new URL(`./src/generated/${name}`, config.root));
        const snapshotFile = generated('releases-snapshot.json');
        const quickstartFile = generated('server-quickstart.json');
        const fresh = command === 'build';
        mkdirSync(dirname(snapshotFile), { recursive: true });

        let serverTag;
        if (fresh || !existsSync(snapshotFile)) {
          const client = new GitHubClient({ token: process.env.GITHUB_TOKEN, timeoutMs: 15_000 });
          const snapshot = { version: 1, savedAt: new Date().toISOString(), repos: {} };
          try {
            for (const [key, ref] of Object.entries(trackedRepos)) {
              const result = await client.listReleases(ref);
              if (result.status !== 'ok') throw new Error('unexpected not-modified answer');
              snapshot.repos[key] = {
                releases: result.releases,
                fetchedAt: snapshot.savedAt,
                etag: result.etag,
              };
            }
            writeFileSync(snapshotFile, JSON.stringify(snapshot));
            logger.info('wrote src/generated/releases-snapshot.json');
          } catch (err) {
            logger.warn(
              `could not snapshot releases (${err.message}); the site will fetch them at runtime. ` +
                'Set GITHUB_TOKEN if the build hit the rate limit.',
            );
          }
        }
        if (existsSync(snapshotFile)) {
          try {
            serverTag = JSON.parse(readFileSync(snapshotFile, 'utf8')).repos?.server?.releases?.[0]?.tag;
          } catch {
            serverTag = undefined;
          }
        }

        if (fresh || !existsSync(quickstartFile)) {
          const quickstart = await fetchQuickstart(serverTag ?? 'main');
          writeFileSync(quickstartFile, JSON.stringify(quickstart));
          logger.info(`wrote src/generated/server-quickstart.json from gotalk-server ${quickstart.ref}`);
        }
      },
    },
  };
}
