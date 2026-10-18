# Deployment

[Documentation](README.md)

The site is one Node server: prerendered pages and assets are served from disk, and routes rendered on demand
(`/download`, `/self-host`, `/changelog`, the release webhook and `/healthz`) go through Astro's Node adapter. The planned hosting is Cloudflare in front of a Node
container on a small VPS or Fly.io (see the [platform plan](platform-plan.md#phase-0--decisions-and-contracts-)).

## On this page

- [Container image](#container-image)
- [Configuration](#configuration)
- [Release data](#release-data)
- [Release webhook](#release-webhook)
- [Behind Cloudflare](#behind-cloudflare)
- [Staging](#staging)

## Container image

```sh
docker build -t gotalk-platform .
docker run -p 8080:8080 gotalk-platform
```

The [Dockerfile](../Dockerfile) builds the site and copies the production dependencies into a `node:24-slim`
image that runs as the `node` user on port 8080. It has a `HEALTHCHECK` against `/healthz`. The image keeps the
latest release list in `/data` ([Release data](#release-data)); mount a volume there to keep it across upgrades:

```sh
docker run -p 8080:8080 -v gotalk-platform-data:/data -e GITHUB_WEBHOOK_SECRET=… gotalk-platform
```

The build needs network access: it bakes in a snapshot of the latest releases and pulls the server's Compose quick
start from `gotalk-server`. An optional `github_token` build secret raises GitHub's rate limit for the snapshot
(`docker build --secret id=github_token,env=GITHUB_TOKEN .`); it is not stored in the image.

CI builds the image on every change. From `main` and from `v*` tags it pushes a multi-arch image (amd64 and arm64)
to the GitHub Container Registry, after the site checks pass:

| Tag | Published from |
| --- | --- |
| `ghcr.io/parkerbrown98/gotalk-platform:edge` | Every push to `main` |
| `ghcr.io/parkerbrown98/gotalk-platform:sha-<commit>` | Every push to `main` or a tag, to pin a deploy |
| `ghcr.io/parkerbrown98/gotalk-platform:1.2.3`, `:1.2` | A `v1.2.3` tag |

```sh
docker run -p 8080:8080 ghcr.io/parkerbrown98/gotalk-platform:edge
```

The published image uses the default build arguments (production `SITE_URL`, indexing allowed). Build a staging
image yourself, as shown under [Staging](#staging).

## Configuration

Build-time (passed as Docker build arguments):

| Variable         | Default             | Meaning                                                               |
| ---------------- | ------------------- | --------------------------------------------------------------------- |
| `SITE_URL`       | `https://gotalk.sh` | Origin for canonical URLs, Open Graph URLs, the sitemap and robots.txt |
| `PUBLIC_NOINDEX` | `false`             | `true` marks every page `noindex` (staging and previews)               |
| `GITHUB_TOKEN`   | (none)              | Optional. Raises the rate limit for the release snapshot (a secret)   |

Run-time:

| Variable                   | Default (image) | Meaning                                                                                  |
| -------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `HOST`                     | `0.0.0.0`       | Address to listen on                                                                     |
| `PORT`                     | `8080`          | Port to listen on                                                                        |
| `DATA_DIR`                 | `/data`         | Where the latest release list is saved (`releases.json`). Unset: memory only             |
| `GITHUB_WEBHOOK_SECRET`    | (none)          | Secret of the [release webhook](#release-webhook). Unset: the webhook answers `404`      |
| `GITHUB_TOKEN`             | (none)          | Optional. Raises the GitHub API rate limit from 60 to 5,000 requests an hour             |
| `RELEASES_REFRESH_SECONDS` | `300`           | How often releases are re-read from GitHub, at least 60                                  |
| `GITHUB_API_URL`           | GitHub's API    | Base URL of the GitHub REST API, for testing against a fake                              |

There is no database yet. The webhook secret and the optional token are the only secrets.

## Release data

`/download`, `/self-host` and `/changelog` are rendered from the latest releases of
[gotalk-client](https://github.com/parkerbrown98/gotalk-client/releases) and
[gotalk-server](https://github.com/parkerbrown98/gotalk-server/releases), so publishing a release changes the site
without a deploy.

- **Fetching:** each server reads the 30 newest releases of both repositories from the GitHub REST API every
  `RELEASES_REFRESH_SECONDS`, and at once when the [release webhook](#release-webhook) fires. Requests are
  conditional (`If-None-Match`), so an unchanged list does not count against the rate limit. Two repositories
  every five minutes stays well under the unauthenticated limit.
- **Fallbacks:** the list lives in memory and is saved to `DATA_DIR/releases.json`. A restart loads the newer of
  that file and the snapshot baked in at build time. If GitHub is down, rate limited or answers with garbage, the
  last list keeps being served, the pages say how old it is, and the server retries with backoff (30 seconds,
  doubling, up to the refresh interval, or when GitHub's rate limit resets). With no list at all (a build without
  a snapshot that has never reached GitHub), the pages link to the GitHub releases pages instead.
- **Channels:** `/download` shows the newest stable release, or the newest pre-release while there is none.
  When a pre-release is newer than the stable release, `/download?channel=beta` offers it. Releases without
  recognized installers (for example, still uploading) are skipped.
- **Checksums:** each file shows the SHA-256 digest GitHub computes for release assets. Server releases also
  link their `checksums.txt`.
- **Caching:** the pages send `Cache-Control: public, max-age=60, s-maxage=120, stale-while-revalidate=600,
  stale-if-error=86400`, so a new release reaches visitors within about two minutes of the server learning about
  it. Without any release data the CDN keeps a page for 30 seconds only.
- **Several replicas:** each keeps its own cache. The webhook reaches one replica; the others pick the release up
  on their next refresh.

## Release webhook

Add the same webhook to both `gotalk-client` and `gotalk-server` (repository **Settings → Webhooks → Add
webhook**):

| Field        | Value                                         |
| ------------ | --------------------------------------------- |
| Payload URL  | `https://gotalk.sh/api/webhooks/github`       |
| Content type | `application/json`                            |
| Secret       | The value of `GITHUB_WEBHOOK_SECRET`          |
| Events       | "Let me select individual events": **Releases** |

The endpoint checks the `X-Hub-Signature-256` HMAC, answers `ping` with `200`, and refreshes the repository's
releases on `published`, `released`, `prereleased`, `edited`, `unpublished`, `created` and `deleted` (`202`). It
refreshes again 30 seconds later, because GitHub's API can lag a moment behind the event. Other events and
repositories are acknowledged and ignored. GitHub's **Recent Deliveries** tab shows each answer.

## Behind Cloudflare

The origin already sends:

- `Cache-Control: public, max-age=31536000, immutable` for hashed assets under `/_astro/`.
- `Cache-Control: public, max-age=0` with an `ETag` for prerendered pages, so browsers revalidate.
- Short `s-maxage` with `stale-while-revalidate` for the release pages ([Release data](#release-data)).
- A Content Security Policy as a `<meta>` element in every page, with hashes for Astro's own styles and the
  JSON-LD blocks. It allows only same-origin resources.

Set at Cloudflare:

- **Do not cache `/api/*`**, and let GitHub's webhook deliveries through bot protection (for example a WAF skip
  rule for `/api/webhooks/github`; the HMAC signature is what authenticates them).
- **Cache rule for pages:** cache prerendered HTML at the edge (for example `s-maxage` of 5 minutes with
  stale-while-revalidate), and purge on deploy. For `/download`, `/self-host` and `/changelog`, keep the
  origin's `Cache-Control` (do not override the edge TTL), or new releases take longer to appear.
- **Security headers** (a transform rule): `Strict-Transport-Security: max-age=63072000; includeSubDomains;
  preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `frame-ancestors 'none'` through a
  `Content-Security-Policy` header (it cannot be set in a `<meta>` element).
- **AI training crawlers:** block them with Cloudflare's bot rules as well. `robots.txt` is advisory; the list
  of names is in [crawlers.ts](../apps/web/src/lib/crawlers.ts).
- **Redirect** `www.gotalk.sh` to `gotalk.sh`.

## Staging

Build with `PUBLIC_NOINDEX=true` and the staging origin:

```sh
docker build --build-arg PUBLIC_NOINDEX=true --build-arg SITE_URL=https://staging.gotalk.sh -t gotalk-platform:staging .
```

Every page then carries `<meta name="robots" content="noindex">` and canonical links are omitted, while
`robots.txt` allows crawling so crawlers can see that instruction.
