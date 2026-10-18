# Deployment

[Documentation](README.md)

The site is one Node server: prerendered pages and assets are served from disk, and routes rendered on demand
(only `/healthz` today) go through Astro's Node adapter. The planned hosting is Cloudflare in front of a Node
container on a small VPS or Fly.io (see the [platform plan](platform-plan.md#phase-0--decisions-and-contracts-)).

## On this page

- [Container image](#container-image)
- [Configuration](#configuration)
- [Behind Cloudflare](#behind-cloudflare)
- [Staging](#staging)

## Container image

```sh
docker build -t gotalk-platform .
docker run -p 8080:8080 gotalk-platform
```

The [Dockerfile](../Dockerfile) builds the site and copies the production dependencies into a `node:24-slim`
image that runs as the `node` user on port 8080. It has a `HEALTHCHECK` against `/healthz`. CI builds the image
on every change but does not push it.

## Configuration

Build-time (passed as Docker build arguments):

| Variable         | Default             | Meaning                                                               |
| ---------------- | ------------------- | --------------------------------------------------------------------- |
| `SITE_URL`       | `https://gotalk.sh` | Origin for canonical URLs, Open Graph URLs, the sitemap and robots.txt |
| `PUBLIC_NOINDEX` | `false`             | `true` marks every page `noindex` (staging and previews)               |

Run-time:

| Variable | Default (image) | Meaning           |
| -------- | --------------- | ----------------- |
| `HOST`   | `0.0.0.0`       | Address to listen on |
| `PORT`   | `8080`          | Port to listen on  |

The site has no secrets and no database in Phase 1.

## Behind Cloudflare

The origin already sends:

- `Cache-Control: public, max-age=31536000, immutable` for hashed assets under `/_astro/`.
- `Cache-Control: public, max-age=0` with an `ETag` for pages, so browsers revalidate.
- A Content Security Policy as a `<meta>` element in every page, with hashes for Astro's own styles and the
  JSON-LD blocks. It allows only same-origin resources.

Set at Cloudflare:

- **Cache rule for pages:** cache HTML at the edge (for example `s-maxage` of 5 minutes with
  stale-while-revalidate), and purge on deploy.
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
