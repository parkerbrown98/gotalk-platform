import type { RepoKey, RepoRef } from './types.ts';

/** The repositories whose releases the site shows. */
export const trackedRepos: Record<RepoKey, RepoRef> = {
  client: { owner: 'parkerbrown98', repo: 'gotalk-client' },
  server: { owner: 'parkerbrown98', repo: 'gotalk-server' },
};
