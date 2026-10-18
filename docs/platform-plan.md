# Gotalk — Platform Plan

This document lays out the phases for `gotalk-platform`, the website at `gotalk.sh`. It is the fourth plan
alongside [backend-plan.md](https://github.com/parkerbrown98/gotalk-server/blob/main/docs/backend-plan.md),
[client-plan.md](https://github.com/parkerbrown98/gotalk-client/blob/main/docs/client-plan.md) and
[gateway-plan.md](https://github.com/parkerbrown98/gotalk-gateway/blob/main/docs/gateway-plan.md).

Status key: ⬜ not started · 🟨 in progress · ✅ done. Everything below is ⬜ unless marked.

## Table of contents

- [What the platform site is for](#what-the-platform-site-is-for)
- [Domains and responsibilities](#domains-and-responsibilities)
- [Goals and non-goals](#goals-and-non-goals)
- [Architecture (decided)](#architecture-decided)
- [Site map](#site-map)
- [Downloads](#downloads)
- [The public index](#the-public-index)
- [SEO strategy](#seo-strategy)
- [Abuse, privacy and legal](#abuse-privacy-and-legal)
- [Cross-repo dependencies](#cross-repo-dependencies)
- [Phases](#phases)
- [Risks](#risks)
- [Open questions](#open-questions)

## What the platform site is for

Two jobs, in this order:

1. **Explain Gotalk and get people running it.** A visitor learns what Gotalk is (a forum-first, self-hostable
   alternative to Discord, where any client can connect to any instance) and can download the desktop client,
   open the web app, or install the server.
2. **Be a search-engine index for opt-in public forums.** Instances that choose to opt in have their public
   places, boards and topics rendered as crawlable pages, so the discussions people have on Gotalk can be found
   on the open web.

The second job exists because of a gap the other plans leave on purpose. The server's
[backend plan](https://github.com/parkerbrown98/gotalk-server/blob/main/docs/backend-plan.md) defers "SEO
rendering (OpenGraph/JSON-LD pages, sitemaps)" to a web client and notes the API "already provides the readable
slugs and anonymous read access it needs". But the web client is an Expo single-page app at `app.gotalk.sh`,
which search engines index poorly, and instances only serve an API. Today nothing serves crawlable HTML for any
Gotalk forum. This site fills that gap.

## Domains and responsibilities

| Host | Serves | Owner |
|---|---|---|
| `gotalk.sh` | This site: landing, downloads, docs pointers, the public index | `gotalk-platform` |
| `app.gotalk.sh` | The web app (Expo export of `gotalk-client`) | `gotalk-client` |
| `api.gotalk.sh` | Gotalk Official, the hosted instance | `gotalk-server` |

Consequences:

- `app.gotalk.sh` is an application shell. It is `noindex` (meta tag and `X-Robots-Tag` header, with crawling
  left allowed so the instruction is seen) so it never competes with the index pages for the same content. The
  client change is made, see [cross-repo dependencies](#cross-repo-dependencies).
- Every index page links into the app with a "Open in Gotalk" action. The two sites need a shared link format, so
  the platform builds on the client's existing invite-link shape (`https://<web client>/…?instance=<origin>` and
  `gotalk://…?instance=<origin>`). Topic deep links are a client dependency.
- `gotalk.sh` never holds user sessions or credentials. Signing in happens in the app, against an instance.

## Goals and non-goals

**Goals**

- A landing page that explains Gotalk in one screen and gets a visitor to a download or the web app within one
  click.
- Accurate, always-current download links for the desktop client and the server, without manual edits per release.
- Crawlable, fast, correctly canonicalized pages for the public content of opted-in instances.
- Opt-in is **explicit, verifiable and reversible**: an operator controls it from their own instance, and
  removing content or turning it off removes it from the index quickly.
- Cheap to run: mostly cacheable pages, one Postgres, one worker. No accounts to manage.
- Visually continuous with the app: reuse the design tokens in `@gotalk/tokens` rather than redefining them.

**Non-goals**

- Not a federation layer or a content host of record. Instances stay the source of truth. The index holds a
  derived, disposable copy that can be rebuilt from instances at any time.
- Not a place to sign in, post or reply. Index pages are read-only and link into the app.
- No platform accounts in v1. Operators manage listing from their instance's admin settings.
- No paid listing, ads or sponsored placement. Ranking inside the directory is never for sale.
- Not the documentation site. Server and client docs stay in their repos and are linked, not copied. A hosted
  docs site can be added later without changing this design.
- No private content, ever. Only content that signed-out visitors can already read through the instance API.

## Architecture (decided)

```
 visitors / crawlers ──► CDN cache ──► gotalk-platform web (SSR)  ──► Postgres (index)
                                                                         ▲
 instance (gotalk-server) ◄── (2) crawl public API, conditional reads ── │
        │                                                                │
        └── (1) well-known document advertises opt-in ──► gotalk-platform indexer (worker)
        └── (3) signed "changed" ping (optional, speeds up freshness) ───┘
```

### Framework: Astro with the Node adapter

The site has two very different halves: a small, mostly static marketing surface, and a large, data-driven
index that could grow to many pages per instance. The choice needs to be good at both.

| Option | For | Against |
|---|---|---|
| **Astro (SSR, hybrid)** | Static-first with per-route opt-in to on-demand rendering. Zero client JavaScript by default, which helps Core Web Vitals on content-heavy pages. Marketing pages prerender at build time. Index pages render on demand and are cached at the CDN. Plain CSS fits `tokens.css`. | Less batteries-included for authenticated dashboards (not needed in v1). |
| Next.js | Mature ISR and a large ecosystem. Could share React with `gotalk-client`. | The app is React Native, so `@gotalk/ui` components do not carry over to the web DOM anyway. Heavier runtime and more JavaScript shipped by default for what are mostly read-only documents. Framework churn is a cost. |
| SvelteKit / Nuxt | Good SSR. | No existing skill or code reuse in the project, no advantage over Astro here. |
| Static site generator only | Cheapest. | Cannot render an index that changes constantly without a rebuild per change. |
| Go templates inside `gotalk-server` | Single binary. | Wrong coupling. The marketing site and index are not part of an instance, and instances are run by other people. |

**Decision: Astro, `output: 'server'` with the Node adapter, marketing routes prerendered.** Index routes render
on demand from Postgres and send `Cache-Control` with `s-maxage` and `stale-while-revalidate`, so a CDN
(Cloudflare or similar) absorbs crawler and visitor load. Interactive bits (OS-aware download button, copy
buttons, directory filters) are small islands using plain TypeScript or a tiny UI library.

This is a revisable decision. Because the rendering layer only reads from the index database through a small
data-access module, switching frameworks later would not touch the indexer or the database.

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, pnpm workspace | Same toolchain as `gotalk-client`. The indexer shares types with the web app. |
| Layout | `apps/web` (Astro), `apps/indexer` (Node worker), `packages/index-db` (schema, queries, migrations) | The web app only reads. The indexer only writes. |
| Database | PostgreSQL | Index store, crawl state, sitemap source. Postgres full-text search for directory search. |
| Queries and migrations | Drizzle ORM and `drizzle-kit` migrations | Type-safe, SQL-first, light. |
| Job scheduling | `pg-boss` (Postgres-backed) | Retries, backoff and scheduling with no extra infrastructure, the same reasoning as `river` in the gateway. |
| Styling | `@gotalk/tokens` (`--gt-*` variables, generated at build time from the package), Inter through Astro's fonts API, plain CSS | One source of design tokens for the app and the site. The package is a pinned git dependency until it is published to npm; see [Development](development.md#design-tokens). |
| Markdown | `markdown-it` or `remark` with a strict sanitizer | Post bodies are user Markdown and must be rendered and sanitized on our side. |
| Cache | CDN in front, plus HTTP caching headers. Optional Redis later | Pages are cacheable by URL. No Redis needed at launch. |
| Observability | Structured logs, Prometheus metrics from the indexer, Search Console and CDN analytics | Crawl health and index freshness are the main signals. |
| Analytics | Privacy-friendly and cookie-free (Plausible or self-hosted equivalent) | A privacy-focused product should not need a cookie banner. |
| Testing | Vitest, Playwright for page-level checks, fake instance server for indexer tests | The indexer is tested against a local fake instance in CI. |
| Deployment | Docker image for web and indexer, Kustomize or Helm alongside the other repos | Matches how the server and gateway ship. |

## Site map

### Marketing (prerendered)

| Route | Purpose |
|---|---|
| `/` | Landing page: what Gotalk is, the three pillars (forums, chat and voice, self-hosting), product visuals, primary calls to action (Download, Open web app) |
| `/download` | Desktop, mobile and web entry points with OS detection. See [Downloads](#downloads) |
| `/self-host` | Install the server: Docker Compose snippet, binaries, Kubernetes, links to server docs |
| `/features` | Forums, chat, voice, moderation, roles, API and bots, privacy |
| `/open-source` | Licenses, repositories, how to contribute |
| `/compare` | A factual feature comparison with other community platforms. Kept out of the hero and main copy |
| `/explore` | Entry to the public index. Dynamic, see below |
| `/list-your-instance` | Operator guide to opting in, what gets indexed and how to remove it |
| `/privacy`, `/terms`, `/guidelines`, `/content-policy` | Platform policies, including what the index stores. Required before launching the index |
| `/changelog` | Rendered from GitHub release notes |
| `/robots.txt`, `/sitemap-index.xml`, `/llms.txt` | Crawl controls. See [SEO strategy](#seo-strategy) |

The visual language follows the app's dark canvas, hairline borders and Inter type scale from the client's
[DESIGN.md](https://github.com/parkerbrown98/gotalk-client/blob/main/DESIGN.md). Hero visuals reuse the product
mockups (`docs/mockups` in the client repo) as the starting point, exported as optimized images rather than
embedded HTML.

### Public index (server-rendered, cached)

| Route | Content |
|---|---|
| `/explore` | Featured and recently active places, search box, category filters |
| `/explore/{host}` | An instance: name, description, software version, its listed places |
| `/explore/{host}/{place}` | A place: description, member count, boards, recent topics |
| `/explore/{host}/{place}/{board}` | A board: paginated topic list (`?page=n`) |
| `/explore/{host}/{place}/t/{topicId}-{slug}` | A topic: opening post and replies, paginated, with structured data |
| `/explore/search?q=` | Directory search. `noindex`. Never an indexable URL |

URL notes:

- The instance host is part of the path because place slugs are only unique within an instance.
- The topic ID, not the slug, is the key. A wrong or stale slug 301-redirects to the current one, so renames do
  not break links.
- If an instance changes domains, an alias table 301-redirects the old host to the new one once the operator
  verifies both.
- Pagination uses real links (`?page=n`) with `rel="next"`/`prev` hints, and page 1 is the canonical form.

## Downloads

The download page must never go stale and must never require a platform-site deploy per release.

- **Source of truth:** the GitHub Releases of `gotalk-client` (desktop installers for macOS arm64 and x64, Linux
  and Windows) and `gotalk-server` (binaries for Linux, macOS and Windows, plus the container image).
- **Fetching:** the web app reads the latest non-prerelease release through the GitHub Releases API on the
  server, caches it in memory and in Postgres, and refreshes on a timer and on a release webhook. If GitHub is
  down, the last cached release is served. A `beta` channel toggle shows pre-releases (tags with a suffix, such
  as `v0.1.0-beta.1`).
- **OS detection:** the primary button picks the right installer from the user agent. A small islands script
  does this, and the page still lists every asset without JavaScript.
- **Integrity:** link to the release page and show checksums where release workflows publish them.
- **Honest notes:** macOS builds are signed and notarized. Windows installers are currently unsigned, so the page
  says SmartScreen will warn on first launch, matching the client's
  [releases doc](https://github.com/parkerbrown98/gotalk-client/blob/main/docs/releases.md).
- **Other entry points:** "Open web app" goes to `app.gotalk.sh`. iOS and Android store badges appear only when
  the apps are published. Until then the page says mobile is coming and does not link to nothing.
- **Server:** `/self-host` shows the Docker Compose quick start verbatim from the server's getting-started
  guide. To avoid drift, the snippet is pulled from the server repo at build time and not retyped.
- **Gotalk Official:** the page mentions `api.gotalk.sh` as the quickest way to try Gotalk without installing
  anything, since the client already offers it first.

## The public index

### What gets indexed

Only content a signed-out visitor can already read on the instance, and only if it is opted in at every level:

| Level | Condition |
|---|---|
| Instance | Operator turned on directory listing and the domain is verified |
| Place | Visibility is `public`, the place is marked indexable by its owners, and it is not NSFW |
| Board | The board's derived `is_public` flag is true (`@everyone` can read it), it is not marked unindexable, and it is not NSFW |
| Topic and posts | Not deleted, not a tombstone, not hidden by moderation, and not written by a user who excluded their posts. Archived and locked topics are indexed and flagged. A topic whose opening post is not visible is not indexed. Tombstoned replies are dropped, not shown as empty |

Opt-in is two levels because the instance operator and the place owner are often different people. An operator
turning listing on does not publish every place. Place owners choose per place (default off), and the operator
can still exclude anything. The index never mirrors `invite_only` or `private` places, whatever the flags say,
and NSFW places and boards cannot be indexed in v1.

Chat is **not** indexed in v1. Channels and DMs are conversational and ephemeral, and the signed-out read rule
covers boards, not chat. Forum boards only.

The exact rules are in the [index protocol](index-protocol.md#what-is-indexable).

### How content gets from an instance to the index

**Decision: pull, with an optional push hint.** The platform reads each opted-in instance's dedicated index
endpoints. Instances do not push content.

Why pull:

- An instance is not trusted to assert what the index should say. The platform reads what the instance exposes
  for signed-out visitors, so the index can never contain more than the instance already shows publicly.
- Operators run the instance as-is. There is no new write path or credentials to leak.
- It is idempotent and rebuildable. If the index is wrong, drop the table and re-crawl.

Why a push hint on top: crawling every instance on a timer is slow for freshness and wasteful for quiet
instances. The instance can send a small signed "something changed" ping (no content in it) that moves the
instance to the front of the crawl queue. It reuses the gateway's design (Ed25519 signed request over method,
path, timestamp, nonce and body hash, with its own domain separator), so an operator can use the same instance
keypair.

### The opt-in contract

The full contract is specified in the [index protocol](index-protocol.md). In short:

1. **Advertise opt-in in the well-known document.** `/.well-known/gotalk-instance` gains a `directory` block:
   `{ "listed": true, "protocol": 1, "index_url": "…/api/v1/index", "contact_email": "…", "keys": […] }`. Absent
   or `listed: false` means not listed. The origin's well-known document is the root of trust, the same rule the
   gateway uses: whoever controls the origin controls the instance.
2. **Dedicated index endpoints on the instance.** `GET /api/v1/index/places`, `/boards/{id}/topics` and
   `/topics/{id}` return only indexable objects, built by one function on the server so exclusions and opt-in
   flags cannot be bypassed. The existing anonymous API is not used, because it cannot honor per-place opt-in or
   per-user exclusion.
3. **A public change feed.** `GET /api/v1/index/changes?cursor=…&limit=…` returns an ordered stream of
   `place`, `board`, `topic` and `user` events (`upsert`, `delete`, `exclude`, `include`) carrying IDs, never
   content. `delete` means "no longer indexable", so a place going private or a board becoming staff-only
   propagates as an event and the platform does not have to guess. The indexer reads the feed every 5 minutes,
   or sooner on a ping.
4. **Periodic reconcile.** A full sweep every 24 hours compares the platform's set against the instance's
   listing. Anything the instance no longer returns is removed.
5. **Optional ping.** `POST https://gotalk.sh/api/index/v1/ping`, signed, body `{ "origin": "…" }`. It is
   rate-limited per instance and carries no content.

There is no fallback that crawls the existing public endpoints. Those endpoints cannot express the opt-in flags
or user exclusions, so indexing through them would publish content that owners did not agree to. The server work
in [Phase 3](phase-3-work-breakdown.md) is a hard prerequisite for the index, though not for the marketing site.

### Instance registration and lifecycle

1. The operator enables **Public directory listing** in the instance admin settings (a new `directory` section
   next to storage, email, voice and CORS). The instance starts advertising the well-known block.
2. The operator submits the instance origin at `gotalk.sh/list-your-instance`, or the instance registers
   itself with `POST /api/index/v1/instances` and `{ "origin": "…" }`. No platform account, key or secret is
   needed.
3. The platform **verifies** by fetching `https://{origin}/.well-known/gotalk-instance` and checking that the
   `directory` block says `listed: true`. No challenge token is needed: only the origin's operator can change
   that document, so the registration call proves nothing and cannot list an origin it does not control.
4. A newly verified instance enters `pending` state. Its pages are crawled but served `noindex` until it passes
   the [quality gate](#abuse-privacy-and-legal), so spam instances do not get search value on day one.
5. The instance becomes `listed`. Place owners opt their places in from place settings. Places appear in the
   index on the next crawl.
6. **Removal paths, all of which must work:** the operator turns listing off (the platform re-reads the
   well-known document every 15 minutes, sees `listed: false` and purges); a place owner turns a place off
   (a `place.delete` event); a user deletes or excludes a post (a `topic.upsert`, `topic.delete` or
   `user.exclude` event); the operator reports a takedown to the platform directly; the origin stops answering
   for a sustained period (the instance goes `stale` after 7 days and is removed after 30).
7. **Deleted pages return `410 Gone`**, not `404`, so search engines drop them faster, and the platform submits
   removals where the search engines' tooling allows it.

**Purge targets:** content removed on an instance should be gone from the platform within 1 hour when the ping
or the feed is working, and within 24 hours in the worst case (reconcile cadence). These are product promises to
be written into the policies. The status lifecycle and its transitions are in the
[protocol](index-protocol.md#registration-and-lifecycle).

### Data model (sketch)

| Table | Holds |
|---|---|
| `instances` | origin, host, name, description, icon, software and version, status (`pending`, `listed`, `stale`, `suspended`, `blocked`, `removed`), last well-known check, last crawl, feed cursor |
| `places` | instance, remote ID, slug, name, description, member count, icon, category tags, indexable flag |
| `boards` | place, remote ID, slug, name, description, order |
| `topics` | board, remote ID, slug, title, author display name, created, updated, reply count, solved, locked, content hash, indexable flag |
| `posts` | topic, remote ID, number, author display name, rendered and sanitized HTML, Markdown excerpt, created, edited |
| `crawl_state` | per instance cursors, ETags, backoff, error counts |
| `takedowns` | origin, remote ID, reason, who requested, when. Prevents re-indexing |
| `release_cache` | latest release metadata for downloads |

All derived. No table is the only copy of anything, except `takedowns` and the allow/deny lists.

### Crawler behavior

- **Polite by default.** Per-instance concurrency of 1 to 2 requests, a global rate limit, `User-Agent:
  GotalkIndexer/1.0 (+https://gotalk.sh/crawler)`, honoring `Retry-After` and `429`, exponential backoff, and a
  circuit breaker per instance.
- **SSRF-safe.** The platform fetches arbitrary operator-supplied origins. It must resolve DNS first and refuse
  non-public addresses, ignore proxies, not follow redirects across origins, cap response size and time out. The
  server's link-preview fetcher already does this and its rules are the reference.
- **Bounded work.** Caps on pages per topic, topics per board and total index size per instance (configurable,
  with the default for unverified or new instances low).
- **Sanitized output only.** Post HTML is rendered and sanitized by the platform. Instance-provided HTML is never
  trusted or embedded as is.

## SEO strategy

Because the index is the product's search presence, the technical SEO choices are decided up front.

- **Canonical:** index pages are the canonical URL for the content they render. No other crawlable page for that
  content exists, because the app is a SPA that is `noindex`. An operator who runs their own crawlable pages
  could later publish a `canonical_base`, which is deferred past v1.
- **Rendering:** fully server-rendered HTML with content in the first response. No content requires JavaScript.
- **Structured data:** `DiscussionForumPosting` for topics (with `Comment` entries for replies and
  `interactionStatistic`), `BreadcrumbList` on every index page, `Organization` and `WebSite` with a
  `SearchAction` on the home page, `SoftwareApplication` on the download page. Validate in CI with a schema check.
- **Meta:** unique `title` and `description` per page, OpenGraph and Twitter cards, generated social preview
  images for topics and places (satori or similar), and correct `lang`.
- **Sitemaps:** a sitemap index with sharded files (at most 50,000 URLs or 50 MB each), per instance, with
  accurate `lastmod` taken from content `updated_at`. Only indexable, non-pending URLs appear.
- **robots.txt:** allow marketing and index paths, disallow `/explore/search`, API and pagination parameters
  beyond reason. Document the crawler.
- **AI crawler policy:** allow search engines. Disallow AI **training** crawlers (for example `GPTBot`,
  `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Bytespider`). Allow AI **search and answer**
  crawlers that fetch pages to cite and link back (for example `OAI-SearchBot`, `ChatGPT-User`,
  `PerplexityBot`). The list lives in one config file and is reviewed regularly because crawler names change.
  `robots.txt` is advisory, so Cloudflare bot rules back it up for the training crawlers. `llms.txt` links to
  the marketing and download pages and states the same policy.
- **Thin and duplicate content:** a topic with no replies and a very short body is served `noindex, follow`
  until it grows. Pages deeper than a bounded pagination depth are `noindex`. No tag or filter combinations are
  indexable.
- **Link policy:** all user-authored outbound links get `rel="ugc nofollow noopener"`. The platform does not
  pass ranking to what users post.
- **Performance targets:** LCP under 2.0 s and CLS under 0.05 on the 75th percentile for marketing pages and
  topic pages, measured in field data. Pages are small because there is almost no JavaScript.
- **Speed of indexing:** the sitemap `lastmod` plus IndexNow submissions for changed URLs.
- **Status codes:** `200`, `301` for renamed and moved, `410` for removed content, `404` for unknown, `503` with
  `Retry-After` during maintenance. Never soft 404s.
- **Internationalization:** English first. Content keeps its own language in `lang` attributes. Localized
  marketing pages are a later phase.

## Abuse, privacy and legal

The index turns other people's content into pages on a domain we run, so these are launch requirements, not
polish.

- **Spam farms.** Anyone can set up an instance. Verification is required, new instances stay `noindex`
  (`pending`) until they pass an automatic **quality gate**: at least 14 days since verification, 5 distinct
  authors, 50 public posts, and no hits on the abuse blocklist. The thresholds are configuration. There is no
  manual review step, so suspend and blocklist carry the weight for anything the gate lets through. Links
  are `nofollow`. There is a manual suspend and a permanent blocklist
  by origin. Reports are accepted from the public at `/report`.
- **Takedown.** A person can request removal of a specific page. Takedowns are recorded so a re-crawl does not
  bring the page back. Instance-side deletes also remove it.
- **Author privacy.** The index shows the display name and username already public on the instance, and not
  email, IP, profile data or avatars at launch. A server-side per-user preference to exclude one's posts from
  public indexes is a cross-repo dependency and a launch requirement. It **defaults to included**. Erasure:
  when an account is deleted on the instance, its posts go away through the feed. A post from an excluded user
  is dropped from the feed as a delete, and the topic keeps indexing without it.
- **Opt-in consent chain.** The operator consents for the instance, the place owner for the place, and each
  user can exclude their own posts. Because the user setting defaults to included, members must be told clearly
  that public places may be indexed: a notice in the place's settings, in the instance's terms and the first
  time a member joins an indexable place. Whether this is sufficient everywhere is a legal question, see
  [open questions](#open-questions).
- **Content licensing.** Re-publishing user content needs a license grant. The server's policy documents (Terms
  and others, served through the API) should include an opt-in clause for indexed instances. The platform's
  own terms must state that it displays an excerpted copy and links back.
- **Minors, illegal content, moderation.** Index pages inherit what the instance shows, but we are now a
  publisher of a copy. We need a content policy and the ability to act on reports without waiting for the
  operator.
- **Security of the platform itself.** Strict `Content-Security-Policy`, sanitization of all user HTML, no
  inline scripts on topic pages, SSRF-safe fetching (above), no cookies on index pages.

## Cross-repo dependencies

None of the index work can ship until the instance and client side exist. Tracked here so the phases are not
blocked by surprises.

| Repo | Needed | Phase |
|---|---|---|
| `gotalk-server` | `directory` block in `/.well-known/gotalk-instance`. `directory` section in instance config and admin settings. Per-place and per-board `indexable` flags. Dedicated index endpoints (`/api/v1/index/places`, `/boards/{id}/topics`, `/topics/{id}`) and the change feed `/api/v1/index/changes` with deletes and visibility changes. Optional signed ping on content change. Per-user "exclude my posts from public indexes" setting. Policy text for indexed instances. Details in the [work breakdown](phase-3-work-breakdown.md#gotalk-server) | 3 |
| `gotalk-client` | `noindex` for `app.gotalk.sh`. Place and topic deep links (`/places/{slug}?instance=…`, `/topics/{id}?instance=…`, following the invite-link pattern) that the "Open in Gotalk" button can target. Place settings UI for the indexable toggle. Admin UI for directory listing. Account setting to exclude one's posts. A short member-facing notice. Details in the [work breakdown](phase-3-work-breakdown.md#gotalk-client) | 3 |
| `gotalk-gateway` | None required. Design reuse only (signed requests, verification). A shared instance registry could be considered later | — |
| `gotalk-platform` (this repo) | Everything else | 1 to 7 |

## Phases

### Phase 0 — Decisions and contracts 🟨

No site code. Settle what is expensive to change.

Status: the product, policy and technical decisions are settled, and the written deliverables are drafted. Still
open: review and sign-off of the protocol and work breakdown, and the legal input, which is deliberately
deferred. See the checklist after the table.

#### Settled decisions

| Topic | Decision |
|---|---|
| Framework and layout | Astro SSR on Node, pnpm workspace with `apps/web`, `apps/indexer` and `packages/index-db` (see [Architecture](#architecture-decided)) |
| Canonical ownership | The platform page (`gotalk.sh/explore/…`) is always canonical in v1. An operator-supplied `canonical_base` is deferred to [Later](#later) |
| Index location | A path on the main domain, `gotalk.sh/explore/…`, so all ranking stays on one domain. No subdomain |
| Consent chain | Operator opts in the instance, place owner opts in the place (default off), and each user can exclude their own posts. The per-user setting **defaults to included**, so it needs prominent notice in the instance terms and place settings |
| AI crawlers | Search-engine crawlers allowed. AI **training** crawlers disallowed. AI **search and answer** crawlers allowed. See [SEO strategy](#seo-strategy) |
| Official instance | `api.gotalk.sh` is the first index source. Its places still opt in individually, the same as any other instance |
| Removal promise | Gone within 1 hour when the ping or feed is working, within 24 hours in the worst case |
| Quality gate | Automatic, no manual review: a verified instance leaves `pending` after 14 days, 5 or more distinct authors, 50 or more public posts, and no blocklist hits. Thresholds are configuration, not code |
| Hosting | Cloudflare in front. Node containers for web and indexer on a small VPS or Fly.io. Managed Postgres |
| Analytics | Plausible (cloud or self-hosted), cookie-free. Operators get no traffic data in v1 |
| Headline | "The forum-first community platform you can host yourself." No competitor in the hero or main copy |
| Competitors | Not named in the hero or main copy. A factual `/compare` page is allowed |
| Public repo | `parkerbrown98/gotalk-platform` |

#### Deliverables

- [x] **Index protocol spec:** [index-protocol.md](index-protocol.md). The `directory` well-known block,
  dedicated read endpoints, change feed events and cursor semantics, reconcile, ping, registration, status
  lifecycle, fetch rules and conformance fixtures. Marked draft v1 until the server work starts.
- [x] **Cross-repo work for Phase 3:** [phase-3-work-breakdown.md](phase-3-work-breakdown.md), with tasks and an
  acceptance checklist for the server and the client.
- [x] **Policy drafts:** [privacy](policies/privacy.md), [terms](policies/terms.md),
  [content policy](policies/content-policy.md) and [crawler policy](policies/crawler.md). They state intended
  behavior and are not legally reviewed. Placeholders in `[brackets]` mark open items.
- [x] **Brand and copy:** [brand-and-copy.md](brand-and-copy.md). Asset mapping, visual system, voice, claims
  guardrails, first-pass page copy and meta titles.
- [ ] **Review and sign-off** of the protocol and the work breakdown by whoever will build the server and client
  sides. Changes after sign-off need a protocol version note.
- [ ] **Legal input** (deliberately deferred) on the consent model, the content-license clause in the terms and
  the privacy and policy text. See [open questions](#open-questions). The index must not launch without it.

Done when the protocol and work breakdown are signed off and legal input has been received and reflected in the
policies. The product and technical decisions are done.

### Phase 1 — Repo foundation and landing page 🟨

Status: built and verified locally; the only open item is the staging deployment, which needs the hosting
accounts. See [Development](development.md) and [Deployment](deployment.md).

- ✅ Scaffold `gotalk-platform`: pnpm workspace, `apps/web` (Astro 7 with the Node adapter), TypeScript, ESLint
  with `jsx-a11y` rules, Prettier, CI (format, lint, type-check, build, link check, container image build).
- ✅ Consume `@gotalk/tokens` for `--gt-*` variables, Inter, base layout, header and footer, responsive down to
  390 px. The package is a git dependency pinned to a client commit until it is published to npm; an Astro
  integration generates the stylesheet from the package's own `toCss(theme)` at build time.
- ✅ Build `/`, `/features`, `/open-source` with real copy and product visuals from the client mockups. The
  screenshots are captured by a script and served as AVIF and WebP. Download buttons go to the client's GitHub
  releases until `/download` exists (Phase 2); releases are pre-releases, so the copy says Gotalk is in beta.
- ✅ Metadata, OpenGraph defaults, favicon set, `robots.txt` (with the AI crawler policy), a basic sitemap,
  `llms.txt`, `WebSite` and `Organization` structured data, a strict same-origin Content Security Policy, and a
  `PUBLIC_NOINDEX` switch for staging builds.
- ✅ Accessibility pass: skip link, keyboard order and focus states checked in Chromium, the mobile menu works
  without JavaScript, contrast fixed in the open menu, reduced motion honored.
- ⬜ Deploy to a staging host behind the CDN. The container image, health check, Cloudflare settings and staging
  build are ready ([Deployment](deployment.md)); choosing the VPS or Fly.io and creating the accounts is left.

Done when `gotalk.sh` can launch as a polished landing page with accurate content and passing Lighthouse
scores (performance, accessibility, best practices, SEO at 95 or above). Lighthouse 13 against the production
build scores 99 to 100 in all four categories on every page, mobile and desktop, with mobile LCP under 2 s and
no layout shift.

### Phase 2 — Downloads and self-host ⬜

- Release fetcher with cache, refresh and a release webhook, for `gotalk-client` and `gotalk-server`.
- `/download` with OS detection, all assets listed without JavaScript, checksums, beta channel toggle, notes
  on signing.
- `/self-host` with Compose snippet pulled from the server repo at build time, binaries, Kubernetes links.
- `/changelog` from release notes.
- Web app entry (`app.gotalk.sh`) and Gotalk Official mention.
- Tests for the fetcher against a fake GitHub API, including outage fallback.

Done when publishing a release in either repo updates the site within minutes with no site deploy, and the
page degrades cleanly when GitHub is unreachable.

### Phase 3 — Opt-in support in server and client ⬜

Work in other repos, driven by the Phase 0 spec.

- Server: `directory` well-known block, instance config section, `indexable` flags, change feed, ping,
  per-user exclusion, policy text.
- Client: `noindex` on the app, deep links, place and admin settings UI, notice to members.
- A fake instance in this repo's test tooling that implements the contract, so Phase 4 can proceed in parallel.

Done when a locally run instance can opt in, mark a place indexable, and emit the feed, including deletes, with
tests in the server repo.

### Phase 4 — Indexer ⬜

- `packages/index-db`: schema, migrations, data-access.
- `apps/indexer`: registration endpoint and verification, crawl queue, feed consumer, conditional fetches,
  reconcile sweep, ping endpoint, backoff and circuit breakers.
- SSRF-safe HTTP client, size and time limits, Markdown rendering and sanitization.
- Status lifecycle (`pending`, `listed`, `suspended`, `stale`, `removed`), takedown list, purge on opt-out.
- Metrics: crawl lag, error rate per instance, index size, purge latency.

Done when, in tests against the fake instance and a real local server, a post's creation, edit and deletion
appear in and disappear from the index within the freshness targets, and a hostile origin (private IP,
redirects, giant bodies, slow responses) is refused.

### Phase 5 — Index pages and SEO ⬜

- Routes under `/explore` with SSR and CDN cache headers, canonical, `410` and redirect behavior.
- Structured data, OpenGraph and generated preview images.
- Sharded sitemaps with accurate `lastmod`, IndexNow submissions, `robots.txt`, `noindex` rules for pending,
  thin and deep pages.
- Directory search (Postgres full-text) and filters, which are `noindex`.
- "Open in Gotalk" actions linking into the app and the `gotalk://` scheme.
- Schema validation, link checks and page-level Playwright tests in CI.

Done when an opted-in test instance's public place appears under `/explore`, validates in the Rich Results
test, is correctly canonicalized, and its removal produces a `410` and a sitemap update.

### Phase 6 — Operator experience and moderation ⬜

- `/list-your-instance` guide and the submission and verification flow with clear errors.
- Operator-facing status page per origin (via a signed or well-known-authenticated view): what is indexed, last
  crawl, errors, and how to remove it.
- Quality gate automation and the abuse tools: suspend, blocklist, takedown intake and the `/report` flow, with
  an internal admin view protected by SSO.
- Crawler documentation page and contact path.

Done when an operator who has never talked to us can list an instance, see what is indexed, and remove it,
and we can suspend an abusive instance in minutes.

### Phase 7 — Launch hardening ⬜

- Load test the SSR path behind the CDN, including a crawler storm. Tune cache headers and the per-instance
  caps.
- Search Console, Bing Webmaster Tools and sitemap submission. Field Core Web Vitals monitoring.
- Backup and restore for the index database (which is rebuildable, so this is about speed of recovery).
- Disaster drill: drop the index and rebuild from a set of instances.
- Policy review and final legal sign-off. Announce.

Done when the site survives a crawler load test with the origin staying healthy, a full rebuild is routine, and
the legal items are signed off.

### Later

- Localized marketing pages.
- A hosted documentation site aggregating the three repos' docs.
- Indexing chat threads that operators explicitly mark public (needs its own consent model).
- A shared instance registry with the push gateway, so an operator registers once.
- Featured and curated collections in the directory, always editorial and never paid.
- Operator-supplied `canonical_base`, for instances that serve their own crawlable pages.
- Rendering images from posts through an image proxy. In v1 images appear as text links, to avoid hotlinking and
  leaking visitors' IPs to instances.
- Public stats and an instance status directory.

## Risks

| Risk | Mitigation |
|---|---|
| SEO spam through throwaway instances | Verification, `pending` and `noindex` by default, quality gate, `nofollow`, blocklist, manual suspend |
| Deleted or private content lingering in the index | Change feed with deletes, ping, reconcile sweep, purge SLO, `410` on removal, takedown list |
| Duplicate-content or thin-content penalties | Canonical on index pages, `noindex` on thin and deep pages, `app.gotalk.sh` is `noindex` |
| Legal exposure from republishing user content | Two-level opt-in, license clause, content policy, takedown process, legal review before launch |
| Crawler used for SSRF or as an amplifier | Public-address-only fetching, no cross-origin redirects, caps, per-instance rate limits |
| Server and client work slips, blocking the index | The marketing site (Phases 1 and 2) ships independently. The fake instance unblocks the indexer. There is deliberately no fallback that crawls the existing public endpoints, because they cannot honor opt-in flags or user exclusions. The index waits for the server instead |
| Index grows faster than the database | Per-instance caps, sharded sitemaps, CDN caching, Postgres FTS now and a dedicated engine later behind one query |
| Framework lock-in | Rendering reads through a small data-access layer, so the framework is swappable |

## Open questions

The product decisions are settled in [Phase 0](#phase-0--decisions-and-contracts-). What remains:

1. **Legal review of the consent model.** With the per-user exclusion defaulting to included, is notice plus an
   easy opt-out enough in the jurisdictions that matter (for example GDPR's lawful basis and erasure duties), or
   does any region need opt-in? If so, the default changes for those users, and the server setting needs a way
   to express that.
2. **Content license wording.** The exact clause for the server's Terms that lets an indexed instance's content
   be displayed as an excerpted copy on `gotalk.sh`, and the matching platform terms.
3. **Plausible: cloud or self-hosted.** Decide when hosting is set up. It does not affect the design.
4. **Backfill of existing content.** When an instance first lists, do its already-public topics appear
   immediately (subject to the quality gate), or only content created after the opt-in? Backfill is the
   plan's default because the value of the index depends on it, but the user-exclusion notice period should
   come first.
5. **Retention of removed content.** How long the `takedowns` table keeps the identity of removed pages, since
   it must not become a second copy of what was removed. Proposed: store only origin, remote ID and a hash.
6. **License for this repo.** The server is AGPL-3.0 and the client is MIT. A hosted site is the AGPL's
   motivating case, so AGPL-3.0 would require forks that run a competing index to share their changes. MIT
   would match the client. Decide before the first public commit.
7. **Contact addresses and legal entity.** The policy drafts need a legal entity, a privacy contact, a report and
   takedown channel and a crawler contact, plus published IP ranges for the indexer once hosting exists.

Questions 1 and 2 are the legal work that is deferred for now. The index must not launch until they are
answered. The marketing site (Phases 1 and 2) does not depend on them.
