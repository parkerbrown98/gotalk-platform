import type { Release, ReleaseAsset, RepoRef } from './types.ts';

export interface GitHubOptions {
  /** Base URL of the REST API, `https://api.github.com` unless testing. */
  apiUrl?: string;
  /** Optional token. Raises the rate limit from 60 to 5,000 requests an hour. */
  token?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}

export type FetchResult =
  { status: 'ok'; releases: Release[]; etag?: string } | { status: 'not-modified'; etag?: string };

/** A failure to get releases. `retryAt` is set when GitHub said when to come back (rate limits). */
export class GitHubError extends Error {
  readonly status: number;
  readonly retryAt?: Date;

  constructor(message: string, status: number, retryAt?: Date) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.retryAt = retryAt;
  }
}

/** How many releases are read per repository: enough for the changelog and a stable release behind betas. */
export const PAGE_SIZE = 30;

interface ApiAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
  state?: string;
}

interface ApiRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets: ApiAsset[];
}

function toAsset(a: ApiAsset): ReleaseAsset | null {
  if (a.state && a.state !== 'uploaded') return null;
  const asset: ReleaseAsset = { name: a.name, size: a.size, url: a.browser_download_url };
  const m = /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? '');
  if (m) asset.sha256 = m[1].toLowerCase();
  return asset;
}

/** Normalizes the GitHub API's release list: published releases only, newest first. */
export function normalizeReleases(list: ApiRelease[]): Release[] {
  return list
    .filter((r) => !r.draft && r.published_at)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name?.trim() || r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      prerelease: r.prerelease,
      publishedAt: new Date(r.published_at as string).toISOString(),
      url: r.html_url,
      notes: r.body ?? '',
      assets: r.assets.map(toAsset).filter((a): a is ReleaseAsset => a !== null),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function rateLimitReset(res: Response): Date | undefined {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (retryAfter > 0) return new Date(Date.now() + retryAfter * 1000);
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (reset > 0) return new Date(reset * 1000);
  }
  return undefined;
}

/** Reads a repository's releases from the GitHub REST API, with conditional requests. */
export class GitHubClient {
  private readonly apiUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetch: typeof fetch;

  constructor(opts: GitHubOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.token = opts.token || undefined;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.userAgent = opts.userAgent ?? 'gotalk-platform';
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  /** Lists releases. With `etag`, an unchanged list costs no rate limit and returns `not-modified`. */
  async listReleases(ref: RepoRef, etag?: string): Promise<FetchResult> {
    const url = `${this.apiUrl}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/releases?per_page=${PAGE_SIZE}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (etag) headers['If-None-Match'] = etag;

    let res: Response;
    try {
      res = await this.fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable';
      throw new GitHubError(`GitHub ${reason} (${ref.owner}/${ref.repo})`, 0);
    }
    const nextEtag = res.headers.get('etag') ?? undefined;
    if (res.status === 304) {
      await res.body?.cancel();
      return { status: 'not-modified', etag: nextEtag ?? etag };
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new GitHubError(
        `GitHub answered HTTP ${res.status} for ${ref.owner}/${ref.repo} releases`,
        res.status,
        rateLimitReset(res),
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GitHubError(`GitHub sent a malformed release list for ${ref.owner}/${ref.repo}`, res.status);
    }
    if (!Array.isArray(body)) {
      throw new GitHubError(`GitHub sent a malformed release list for ${ref.owner}/${ref.repo}`, res.status);
    }
    return { status: 'ok', releases: normalizeReleases(body as ApiRelease[]), etag: nextEtag };
  }
}
