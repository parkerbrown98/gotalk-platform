# Phase 3 work breakdown: server and client

**Status: proposal, for review.** This turns the [index protocol](index-protocol.md) into concrete work for the
two other repos, so Phase 3 of the [platform plan](platform-plan.md#phase-3--opt-in-support-in-server-and-client-)
can be scheduled. Nothing here is implemented.

The platform's own work (indexer, pages) does not depend on this being finished. It builds against the
fixtures and fake instance described in the protocol, so the three streams can run in parallel.

## On this page

- [gotalk-server](#gotalk-server)
- [gotalk-client](#gotalk-client)
- [gotalk-platform](#gotalk-platform)
- [Suggested order](#suggested-order)
- [Acceptance checklist](#acceptance-checklist)

## gotalk-server

### S1. Data model

- `places.indexable boolean not null default false`
- `boards.indexable boolean not null default true`. Effective indexability also needs a public place, a
  readable-by-`@everyone` board chain (the existing derived `is_public`) and no NSFW flag.
- `users.exclude_from_index boolean not null default false`.
- `index_changes`: `seq bigserial primary key`, `type`, `at`, `place_id`, `board_id`, `topic_id`, `user_id`.
  A partial unique index on the object coalesces repeated events for one object into the latest, per the
  protocol. Indexes on `(seq)` and on the object columns. A retention job removes rows older than 30 days, and
  keeps `delete` and `exclude` rows for the full 30 days.
- Migration through the existing advisory-locked migration path, with `sqlc` queries.

### S2. Settings and permissions

- Instance setting `directory.listed` in the `directory` section of `GET/PATCH /instance/config`, with the
  same source reporting (`default`, `config`, `settings`) and live check as the other sections.
  Administrators only. The live check fetches nothing from the platform. It validates that the instance's own
  public URL is HTTPS and reachable.
- Optional `directory.contact_email` and `directory.keys` (generated on first enable, stored like other
  secrets, public part published). Key rotation works like the gateway's: add, publish, switch, revoke.
- `PATCH /places/{place}` accepts `indexable` with `MANAGE_PLACE`. `PATCH /boards/{id}` accepts `indexable`
  with `MANAGE_BOARDS`. Both reject `true` for NSFW places and boards with a clear error.
- `PATCH /users/@me` accepts `exclude_from_index`.
- Audit log entries for every one of these changes.
- Configuration and environment variable equivalents for headless setup, documented in `configuration.md`.

### S3. Discovery

- `/.well-known/gotalk-instance` adds the `directory` object from the protocol: `listed`, `protocol`,
  `index_url`, `contact_email`, `keys`. When `directory.listed` is off, the block is omitted or `listed` is
  false.
- `GET /api/v1/instance` adds a `directory` summary (`listed`, `places_indexed`) for clients to show.

### S4. Index endpoints

Under `/api/v1/index`, unauthenticated, with their own `index` rate-limit tier:

- `GET /places`, `GET /boards/{id}/topics`, `GET /topics/{id}`, `GET /changes`, exactly as specified.
- All responses are built by one function that applies the indexability rules, so no other code path can
  return unfiltered data. It is the only place the rules live.
- `ETag` and `If-None-Match` support. `404` for anything not indexable, with no distinction from missing.
- The OpenAPI document includes the endpoints, so they appear in `/api/v1/docs`.

### S5. Event emission

Emit into `index_changes` in the same transaction as the write, for:

| Cause | Event |
|---|---|
| Topic created, edited, replied to, solved or unsolved, locked, archived, pinned, moved, or a post edited | `topic.upsert` |
| Post deleted or made a tombstone, moderator removal, topic deleted | `topic.upsert` (or `topic.delete` when the topic stops being indexable) |
| Board moved, renamed or opted in | `board.upsert` |
| Board opted out, deleted, made non-public or NSFW | `board.delete` |
| Place opted in or edited | `place.upsert` |
| Place opted out, deleted, made private or invite-only, NSFW | `place.delete` |
| A role or overwrite change that changes whether `@everyone` can read a board | `board.upsert` or `board.delete` as the result requires |
| User sets `exclude_from_index`, or deletes their account | `user.exclude` |
| User clears `exclude_from_index` | `user.include`, plus `topic.upsert` for each affected topic |
| Directory listing turned on | `place.upsert` for each indexable place |

Changes that fan out (a role overwrite, a place made private) emit one event per affected object in the same
transaction, in batches if there are many.

### S6. Ping sender

- After feed events are committed, a debounced sender (at most one ping per 30 seconds per instance) posts a
  signed ping to the platform. It uses the server's existing background-work mechanism, and failures are
  logged and retried a few times, never blocking a write.
- The sender is off unless `directory.listed` is on and `directory.keys` has a key.
- The platform URL is configurable (`directory.platform_url`, default `https://gotalk.sh`) so self-hosters and
  tests can point at another one.

### S7. Policies and notices

- Policy kinds (`terms`, `privacy`, `guidelines`) get default text for an instance that is listed. The clause
  that grants the right to display an excerpted copy is **pending legal input**. Until it exists, the setting
  to enable listing must show the operator the placeholder, and must not claim a license.
- The place owner's `indexable` toggle and the user's `exclude_from_index` toggle return a short plain-language
  `notice` string from the API for the client to display.

### S8. Tests

- Anonymous parity: for a fixture instance with public, `invite_only`, private and NSFW places, every object
  returned by `/index/*` is also readable by a signed-out visitor through the general API, and the reverse is
  not required.
- Exclusion: a user's posts disappear from `/index/topics/{id}` and a `user.exclude` event appears. A topic
  whose opening post is excluded returns `404` and emits `topic.delete`.
- Every row of the event table above, including fan-out cases.
- Coalescing, retention, and `cursor_expired`.
- Responses validate against the platform's JSON Schemas (see
  [Conformance fixtures](index-protocol.md#conformance-fixtures)).
- Rate-limit tier and `ETag` behavior.

### S9. Docs

- A new `api-index.md` page, additions to `configuration.md`, `api-instance.md`, `api-places.md` and
  `api-reference.md`, and an update to the "SEO rendering" line in the backend plan to point at the platform.

## gotalk-client

### C1. `app.gotalk.sh` is not indexed ✅

- Done. The web export carries `<meta name="robots" content="noindex">`
  ([index.html](https://github.com/parkerbrown98/gotalk-client/blob/main/apps/app/public/index.html)), and
  `public/_headers` sets `X-Robots-Tag: noindex` on hosts that read it (Cloudflare Pages, Netlify). On other
  hosts the header must be set in the host's configuration. Documented in the client's
  [releases doc](https://github.com/parkerbrown98/gotalk-client/blob/main/docs/releases.md#hosting-the-web-export).
- **No `robots.txt` that disallows crawling.** A crawler that cannot fetch a page never sees its `noindex`, and
  the URL can still be listed from links. `noindex` works only while crawling is allowed.
- Social preview tags can stay so shared links still unfurl. This avoids duplicate content against the index
  pages.
- Remaining at deploy time: confirm the header is actually served by the `app.gotalk.sh` host.

### C2. Deep links for index pages

The platform's "Open in Gotalk" button needs targets. They follow the invite-link pattern, which already carries
the instance:

| Target | Web | App and desktop |
|---|---|---|
| Place | `https://app.gotalk.sh/places/{slug}?instance={origin}` | `gotalk://places/{slug}?instance={origin}` |
| Topic | `https://app.gotalk.sh/topics/{topicId}?instance={origin}` | `gotalk://topics/{topicId}?instance={origin}` |

If the instance is not yet saved in the client, the link offers to add it first, then continues, exactly as
invite links do. Signed-out visitors can read public places, so a topic link works before sign-in and the
client's existing "reading without an account" behavior applies.

### C3. Settings UI

- **Instance admin settings:** a "Public directory" section to turn listing on, show the well-known status,
  the platform's view of the instance (status, indexed counts and last crawl, from
  `GET https://gotalk.sh/api/index/v1/instances?origin=…`), and a link to the operator guide. Copy comes from
  the server `notice`.
- **Place settings:** an "Allow this place to appear in search engines" toggle, with what is indexed and how
  removal works. Disabled with an explanation for private, invite-only and NSFW places.
- **Board settings:** an "Exclude from search engines" toggle.
- **Account settings:** "Don't show my posts in public search results", default off, with the effect and the
  removal time (within an hour).
- First-time notice when a member joins an indexable place, and a persistent indicator on indexable places
  ("Public: visible to search engines").

### C4. Tests and docs

- Unit tests for link building and parsing in `@gotalk/core`. Component tests for the settings.
- A page in the client docs, and mockups in `docs/mockups` for the new settings, matching the existing set.

## gotalk-platform

For completeness, the platform's side of Phase 3 is:

- `packages/index-protocol`: schemas and fixtures.
- `packages/fake-instance`: a server implementing the instance side from the fixtures, including the failure
  cases (expired cursors, hostile responses, slow responses).
- CI that checks the fixtures against the schemas.

## Suggested order

1. Platform: the schemas, fixtures and fake instance (unblocks everyone).
2. Server S1, S2, S3, S4 (read side first, with listing off by default).
3. Server S5, S6, then S7 and S8.
4. Client C1 (small, can ship at any time), then C2, then C3.
5. End-to-end run: a local server, the fake platform, a real indexer (Phase 4).

C1 has no dependency and is worth doing straight away, since it protects the domain from duplicate content
whenever the index launches.

## Acceptance checklist

- [ ] A local instance can turn listing on, mark a place indexable, and serve `/index/places`,
  `/index/boards/{id}/topics`, `/index/topics/{id}`, `/index/changes` that validate against the schemas.
- [ ] No object is returned by `/index/*` that a signed-out visitor cannot read.
- [ ] Deleting a post, excluding a user, making a place private and turning listing off each produce the right
  event and remove the object from `/index/*`.
- [ ] A listed instance's well-known document advertises the `directory` block and nothing else changes for
  instances that do not list.
- [ ] A signed ping is accepted by the fake platform and is debounced.
- [x] `app.gotalk.sh` serves `noindex` (in the client repo; verify the header on the live host).
- [ ] Deep links for places and topics open the right screen, including for an unsaved instance.
- [ ] Settings for the instance, place, board and account exist, with notices.
- [ ] The legal clause is in place before listing can be enabled outside development (pending legal input).
