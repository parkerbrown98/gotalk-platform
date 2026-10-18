// Release data as the site uses it. Kept free of Astro and Vite APIs (and to erasable TypeScript) so the
// build-time snapshot integration can import it with plain Node.

export type RepoKey = 'client' | 'server';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  /** Lower-case hex SHA-256 from the asset's GitHub digest, when GitHub has computed one. */
  sha256?: string;
}

export interface Release {
  tag: string;
  name: string;
  /** The tag without a leading `v`. */
  version: string;
  prerelease: boolean;
  /** ISO 8601. */
  publishedAt: string;
  url: string;
  /** Release notes as GitHub Markdown. */
  notes: string;
  assets: ReleaseAsset[];
}

export interface RepoState {
  /** Published releases, newest first. Drafts are never included. */
  releases: Release[];
  /** When GitHub last answered with data or "not modified". ISO 8601, or null if never. */
  fetchedAt: string | null;
  /** ETag of the last response, sent back as If-None-Match. */
  etag?: string;
}

export interface Snapshot {
  version: 1;
  savedAt: string;
  repos: Partial<Record<RepoKey, RepoState>>;
}
