# Development

[Documentation](README.md)

## On this page

- [Layout](#layout)
- [Design tokens](#design-tokens)
- [Product screenshots](#product-screenshots)
- [Brand assets](#brand-assets)
- [Pages and copy](#pages-and-copy)
- [Release pages](#release-pages)
- [SEO and crawlers](#seo-and-crawlers)
- [Checks](#checks)

## Layout

```
apps/web/                 Astro site (the only app until the indexer arrives in Phase 4)
  astro.config.mjs        Node adapter, fonts, CSP, sitemap, tokens and releases integrations
  integrations/tokens.mjs Generates the --gt-* stylesheet from @gotalk/tokens
  integrations/releases.mjs  Bakes a release snapshot and pulls the server's Compose quick start at build time
  public/                 Favicons, manifest, social image, brand SVGs (generated, committed)
  scripts/                Maintainer scripts: capture-screens.mjs, build-brand.mjs
  src/
    assets/screens/       Product screenshots captured from the client mockups (committed)
    components/           Header, Footer, Seo, Screenshot, Icon, FileList, StaleNotice
    generated/            Release snapshot and server quick start (written by the build, ignored by git)
    layouts/              BaseLayout
    lib/                  site.ts (names and links), seo.ts, crawlers.ts (robots policy)
    lib/releases/         GitHub release fetcher, cache, asset classification, release-notes Markdown
    pages/                Routes, plus robots.txt, llms.txt, healthz and the release webhook (api/webhooks)
    styles/global.css     Base styles; imports the generated tokens
  test/                   Site test against the built server, and a fake GitHub API
  vitest.config.ts        Test projects: unit (src/**/*.test.ts) and site (test/)
scripts/check-links.mjs   Internal link checker for the build output
```

Pages are prerendered by default. A route that needs a live server opts out with `export const prerender = false`,
as the release pages and [healthz.ts](../apps/web/src/pages/healthz.ts) do, and is rendered by the Node adapter.
The link checker finds these routes in `src/pages` by that line.

## Design tokens

Colors, spacing, radii and type come from `@gotalk/tokens` in the client repo, as `--gt-*` custom properties.
Do not copy token values into this repo.

The package is not published to npm yet, so it is a git dependency pinned to a client commit in
[apps/web/package.json](../apps/web/package.json):

```json
"@gotalk/tokens": "github:parkerbrown98/gotalk-client#<commit>&path:/packages/tokens"
```

The package ships TypeScript sources only. The [tokens integration](../apps/web/integrations/tokens.mjs) runs
the package's own `toCss(theme)` on every `dev`, `build` and `check`, and writes
`src/styles/generated/tokens.css` (ignored by git). Vite bundles it like any other stylesheet.

To pick up token changes, update the commit in `package.json` and run `pnpm install`. Publishing
`@gotalk/tokens` to npm would replace the pinned commit with a version range; nothing else changes.

Inter is loaded through Astro's fonts API from Fontsource at build time and self-hosted, so pages make no
third-party font requests.

## Product screenshots

Screenshots in `src/assets/screens/` are captured from the client's static mockups
(`gotalk-client/docs/mockups`). Astro serves them as AVIF with a WebP fallback at several widths.

```sh
# in the client checkout, once: build the tokens stylesheet the mockups load
pnpm --filter @gotalk/tokens build
# here
pnpm --filter @gotalk-platform/web capture:screens [path/to/gotalk-client]
```

The script expects the client as a sibling checkout by default and needs network access (the mockups load
Inter from Google Fonts). The shot list and a few text fixes (such as the web app's domain) are at the top of
[capture-screens.mjs](../apps/web/scripts/capture-screens.mjs). Commit the PNGs.

## Brand assets

The favicon set, manifest icons, brand SVGs and the default social image (`og-default.png`, 1200 by 630) are
generated from the client's `docs/brand`:

```sh
pnpm --filter @gotalk-platform/web build:brand [path/to/gotalk-client]
```

The client's `banner.svg` is not used as the social image because it lists iOS and Android, which the site
does not claim yet (see [brand and copy](brand-and-copy.md#claims-we-can-and-cannot-make-yet)). Change brand
files in the client repo first, then re-run the script and commit the outputs.

## Pages and copy

Copy follows [brand and copy](brand-and-copy.md). Before adding a claim, check its
[claims table](brand-and-copy.md#claims-we-can-and-cannot-make-yet). External destinations live in
[site.ts](../apps/web/src/lib/site.ts) so they change in one place.

## Release pages

`/download`, `/self-host` and `/changelog` render the latest `gotalk-client` and `gotalk-server` releases on demand
(see [Deployment](deployment.md#release-data) for caching, fallbacks and the webhook).

- [lib/releases](../apps/web/src/lib/releases) has the GitHub client (`github.ts`), the cache (`store.ts`), the
  asset classifier and channel selection (`assets.ts`), the release-notes renderer (`markdown.ts`) and the webhook
  signature check (`webhook.ts`). `index.ts` wires them to the environment. The modules other than `index.ts`
  use only Node APIs and erasable TypeScript (`erasableSyntaxOnly`), because the build integration imports them
  with plain Node.
- Installer names are matched in `classifyClientAsset` and `classifyServerAsset`. If a release workflow changes
  its file names, update the patterns and the tests next to them; an unrecognized file is not listed.
- Release notes are user content (GitHub's generated notes quote pull request titles): raw HTML is escaped,
  links get `rel="ugc nofollow noopener"` and images become links.
- `pnpm dev` and `pnpm build` read real releases from GitHub. Set `GITHUB_TOKEN` if you hit the rate limit, or
  `GITHUB_API_URL` to point at a fake. The [/self-host](../apps/web/src/pages/self-host.astro) Compose commands
  come from the server's `docs/getting-started.md` at its latest release tag; the build fails if that section
  moves, rather than ship a copy that drifts.

## SEO and crawlers

- [Seo.astro](../apps/web/src/components/Seo.astro) sets the title, description, canonical URL, Open Graph and
  Twitter tags, and JSON-LD. The home page carries `Organization` and `WebSite` structured data.
- [crawlers.ts](../apps/web/src/lib/crawlers.ts) is the one list of AI training and AI search crawlers. It
  generates `robots.txt`. Review it regularly.
- The sitemap is generated by `@astrojs/sitemap` at `/sitemap-index.xml`.
- `SITE_URL` sets the canonical origin (default `https://gotalk.sh`). `PUBLIC_NOINDEX=true` builds a staging
  site: every page is `noindex`, and `robots.txt` allows crawling so that instruction is seen.

## Checks

`pnpm verify` runs what CI runs: Prettier, ESLint (with `jsx-a11y` rules), `astro check`, the unit tests, the
build, the link check and the site test. The link check fails on missing files and on `#anchors` that do not
exist on the target page. External links are not fetched.

- `pnpm test` runs the unit tests (Vitest): the GitHub client against a fake API (ETags, outages, rate limits,
  timeouts, malformed answers), the cache (backoff, outage fallback, snapshots, restarts), the asset classifier
  and channels, release-notes sanitizing and webhook signatures.
- `pnpm test:site` runs the built server (`pnpm build` first) against the fake GitHub API: the three release pages,
  a signed webhook that brings in a new release without a deploy, an outage, a restart during the outage, and
  every internal link on those pages.

Phase 1 was verified with Lighthouse 13 (mobile and desktop presets) against the production server, all pages
scoring 99 or 100 in performance, accessibility, best practices and SEO. To re-run:

```sh
pnpm build && pnpm --filter @gotalk-platform/web start   # in one terminal
CHROME_PATH="$(node -e "import('playwright').then(p=>console.log(p.chromium.executablePath()))")" \
  npx lighthouse@13 http://127.0.0.1:4321/ --view
```

(`pnpm --filter @gotalk-platform/web exec playwright install chromium` provides the browser.)
