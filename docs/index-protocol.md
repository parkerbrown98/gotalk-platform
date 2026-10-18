# Gotalk Public Index Protocol

**Status: draft v1, for review before Phase 3.** Nothing here is implemented yet.

This document specifies how a Gotalk instance opts in to the public index at `gotalk.sh`, how the index reads
its public forum content, and how removals propagate. It is the contract between `gotalk-server` (the
instance), `gotalk-platform` (the indexer) and, for settings and deep links, `gotalk-client`. The reasoning
behind the design is in the [platform plan](platform-plan.md#the-public-index).

The words MUST, SHOULD and MAY are used as in RFC 2119.

## On this page

- [Roles](#roles)
- [Principles](#principles)
- [Conventions](#conventions)
- [What is indexable](#what-is-indexable)
- [Discovery and opt-in](#discovery-and-opt-in)
- [Instance read endpoints](#instance-read-endpoints)
- [Change feed](#change-feed)
- [Reconciliation](#reconciliation)
- [Ping](#ping)
- [Registration and lifecycle](#registration-and-lifecycle)
- [Fetching rules for the indexer](#fetching-rules-for-the-indexer)
- [Errors and rate limits](#errors-and-rate-limits)
- [Versioning](#versioning)
- [Security considerations](#security-considerations)
- [Conformance fixtures](#conformance-fixtures)

## Roles

| Role | Who | Does |
|---|---|---|
| Instance | A `gotalk-server` deployment | Decides what is indexable. Serves the index read endpoints and the change feed. Optionally sends pings |
| Indexer | `gotalk-platform` at `gotalk.sh` | Verifies opt-in, reads index endpoints, stores a derived copy, serves it as pages |
| Operator | The person running an instance | Turns directory listing on or off for the instance |
| Place owner | A member with `MANAGE_PLACE` | Turns indexing on or off for a place and its boards |
| User | An account on the instance | Can exclude their own posts |

## Principles

1. **The instance is the source of truth and the only authority on what is indexable.** The indexer never
   decides visibility. It mirrors what the instance returns from the index endpoints.
2. **Pull, not push.** The indexer reads. A ping carries no content, and an instance cannot write into the
   index.
3. **The origin is the root of trust.** Whoever controls the origin's `/.well-known/gotalk-instance` controls
   the listing. No platform account, secret or challenge is needed.
4. **Removal is first class.** Every way content stops being indexable produces a `delete` event, and the
   periodic reconcile catches anything an event missed.
5. **Dedicated endpoints.** Index reads live under `/api/v1/index`, separate from the general anonymous API,
   so exclusions and opt-in flags cannot be bypassed by a shared code path.

## Conventions

- HTTPS only, except for local development against `localhost` when the indexer is run with an explicit
  development flag.
- JSON, UTF-8. Timestamps are RFC 3339 in UTC (`2026-10-18T09:24:15Z`). IDs are opaque strings that are stable
  for the life of the object. Unknown fields MUST be ignored by both sides.
- Index endpoints are `GET`, unauthenticated, and return `Cache-Control: no-cache` with an `ETag`. The indexer
  sends `If-None-Match` and the instance SHOULD answer `304` when nothing changed.
- Pagination is cursor-based: pass `next_cursor` back as `cursor`. A page has at most `limit` items
  (default 100, maximum 500 unless stated). A cursor is opaque and valid for at least 24 hours.
- The indexer identifies itself with `User-Agent: GotalkIndexer/1 (+https://gotalk.sh/crawler)`.

## What is indexable

An object is indexable only when **every** condition in its row holds, and the instance MUST NOT expose any
object that is not indexable through the index endpoints.

| Object | Conditions |
|---|---|
| Instance | The operator enabled directory listing (`directory.listed` is true) |
| Place | Visibility is `public`, the place owner turned indexing on (`indexable` true, default false), and the place is not NSFW |
| Board | Readable by `@everyone` (the derived `is_public` flag), not marked `indexable: false`, not NSFW, and every ancestor board is also indexable. Indexing a place indexes its public boards unless a board opts out |
| Topic | In an indexable board, not deleted, and its opening post is visible (see Post). Archived and locked topics are indexable and flagged. Draft or scheduled topics are not |
| Post | Not deleted and not a tombstone, not hidden by moderation, and not written by a user who excluded their posts or deleted their account |

Further rules:

- NSFW places and boards cannot be indexed in v1, whatever their flags say.
- `invite_only` and `private` places are never indexable.
- If a topic's opening post stops being visible (for example its author excluded their posts), the topic stops
  being indexable and a `topic.delete` event is emitted, even if replies remain.
- A reply whose parent is no longer visible keeps its `parent_id`. The indexer renders it at the top level.
- Revisions, drafts, reactions on individual posts, read state, member lists, chat channels, direct messages,
  attachments and link previews are not part of v1.
- Content never carries email addresses, IP addresses or avatar URLs. Authors are exposed as `id`,
  `username` and `display_name` only.

## Discovery and opt-in

`GET /.well-known/gotalk-instance` gains a `directory` object. Absent, or `listed: false`, means not listed.

```json
{
  "software": "gotalk",
  "version": "1.4.0",
  "instance_url": "https://forum.example",
  "api_base_url": "https://forum.example/api/v1",
  "api_versions": ["v1"],
  "instance_info_url": "https://forum.example/api/v1/instance",
  "directory": {
    "listed": true,
    "protocol": 1,
    "index_url": "https://forum.example/api/v1/index",
    "contact_email": "ops@forum.example",
    "keys": [
      { "alg": "Ed25519", "public_key": "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg" }
    ]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `listed` | yes | The operator's opt-in. The indexer treats the instance as listed only while this is `true` |
| `protocol` | yes | Index protocol version the instance speaks. `1` for this document |
| `index_url` | yes | Base URL of the [index read endpoints](#instance-read-endpoints). Must be on the same origin as `instance_url` |
| `contact_email` | no | Used only for abuse reports and crawl problems. Not published |
| `keys` | no | Ed25519 public keys (unpadded base64url) allowed to sign [pings](#ping). Omit it to receive no pings. The same key as the push gateway's `push.keys` entry MAY be reused |

The document is fetched with the same rules as the gateway's verification: see
[Fetching rules](#fetching-rules-for-the-indexer).

### Settings that feed the flags

| Setting | Where | Default | Who |
|---|---|---|---|
| Public directory listing | Instance settings, `directory` section | off | Administrators |
| Place `indexable` | Place settings, with `MANAGE_PLACE` | off | Place owners |
| Board `indexable` | Board settings, with `MANAGE_BOARDS` | on (inherits the place) | Place owners |
| `exclude_from_index` | Account settings | off (included) | Each user |

## Instance read endpoints

All under `index_url` (for example `https://forum.example/api/v1/index`). All are unauthenticated `GET`s. Any
object that is missing or not indexable answers `404` with the usual problem body, with no distinction between
"does not exist" and "not indexable".

### `GET /places`

Indexable places, each with its indexable boards. Cursor-paginated, ordered by `id`.

```json
{
  "items": [
    {
      "id": "plc_8Kd…",
      "slug": "rust-help",
      "name": "Rust Help",
      "description": "Questions and answers about Rust.",
      "icon_url": "https://forum.example/media/…",
      "member_count": 4210,
      "tags": ["programming", "rust"],
      "updated_at": "2026-10-17T21:04:00Z",
      "boards": [
        {
          "id": "brd_2Qa…",
          "parent_id": null,
          "slug": "beginners",
          "name": "Beginners",
          "description": "New to Rust? Start here.",
          "position": 1,
          "updated_at": "2026-10-17T21:04:00Z"
        }
      ]
    }
  ],
  "next_cursor": null
}
```

`parent_id` is a board ID, or `null` for a top-level entry. Categories that only group boards are included so
the hierarchy can be rebuilt.

### `GET /boards/{board_id}/topics`

Topic summaries for one indexable board. Parameters: `cursor`, `limit`, `updated_since` (RFC 3339, optional).
Ordered by `updated_at` ascending then `id`, so a client can resume after a gap.

```json
{
  "items": [
    {
      "id": "top_7Hq…",
      "slug": "why-does-borrow-checker-complain",
      "title": "Why does the borrow checker complain here?",
      "author": { "id": "usr_41x…", "username": "ferris", "display_name": "Ferris" },
      "created_at": "2026-10-10T14:02:00Z",
      "updated_at": "2026-10-17T20:11:00Z",
      "reply_count": 12,
      "pinned": false,
      "locked": false,
      "archived": false,
      "solved": true,
      "tags": ["lifetimes"]
    }
  ],
  "next_cursor": "eyJ…"
}
```

### `GET /topics/{topic_id}`

The topic summary plus its posts, in post-number order. Parameters: `cursor`, `limit` (default 50, maximum
100). A topic with `reply_count` replies is read with repeated page requests.

```json
{
  "id": "top_7Hq…",
  "place_id": "plc_8Kd…",
  "board_id": "brd_2Qa…",
  "slug": "why-does-borrow-checker-complain",
  "title": "Why does the borrow checker complain here?",
  "created_at": "2026-10-10T14:02:00Z",
  "updated_at": "2026-10-17T20:11:00Z",
  "reply_count": 12,
  "pinned": false,
  "locked": false,
  "archived": false,
  "solved": true,
  "tags": ["lifetimes"],
  "posts": [
    {
      "id": "pst_9Lm…",
      "number": 1,
      "parent_id": null,
      "author": { "id": "usr_41x…", "username": "ferris", "display_name": "Ferris" },
      "content": "I get error E0502 when…",
      "created_at": "2026-10-10T14:02:00Z",
      "edited_at": null,
      "is_solution": false
    }
  ],
  "next_cursor": "eyJ…"
}
```

- `content` is the Markdown source. The indexer renders and sanitizes it. The instance MUST NOT send
  pre-rendered HTML.
- Post `number` is stable and increasing. Posts removed from the index leave gaps in the numbering. The indexer
  keeps the numbers and does not renumber.
- `reply_count` counts indexable replies, not all replies.

### Metadata

Instance name, description, icon and software version come from the existing `GET /api/v1/instance`.

## Change feed

### `GET /changes`

An ordered stream of references to changed objects. It carries IDs and times, never content.

Parameters: `cursor` (omit to start at the beginning of retained history), `limit` (maximum 500).

```json
{
  "events": [
    { "seq": 10231, "type": "topic.upsert", "at": "2026-10-17T20:11:00Z", "place_id": "plc_8Kd…", "board_id": "brd_2Qa…", "topic_id": "top_7Hq…" },
    { "seq": 10232, "type": "topic.delete", "at": "2026-10-17T20:12:00Z", "place_id": "plc_8Kd…", "board_id": "brd_2Qa…", "topic_id": "top_3Za…" },
    { "seq": 10233, "type": "user.exclude", "at": "2026-10-17T20:15:00Z", "user_id": "usr_41x…" }
  ],
  "next_cursor": "eyJ…",
  "has_more": false
}
```

| Type | Fields | Meaning |
|---|---|---|
| `place.upsert` | `place_id` | A place became indexable or its details or boards changed. Re-read `GET /places` for it |
| `place.delete` | `place_id` | The place is no longer indexable: opted out, made private or non-public, deleted, or marked NSFW. Drop the place and everything under it |
| `board.upsert` | `place_id`, `board_id` | A board became indexable or changed. Re-read the place |
| `board.delete` | `place_id`, `board_id` | The board and its topics are no longer indexable |
| `topic.upsert` | `place_id`, `board_id`, `topic_id` | A topic became indexable, was edited, got a reply, or had a post removed. Re-read `GET /topics/{id}`. Also emitted when a topic moves boards |
| `topic.delete` | `place_id`, `board_id`, `topic_id` | The topic is no longer indexable, for any reason, including deletion |
| `user.exclude` | `user_id` | The user excluded their posts or deleted their account. Drop every post by this user, and any topic whose opening post is theirs |
| `user.include` | `user_id` | The user included their posts again. The instance also emits `topic.upsert` for each affected topic, so this event needs no action beyond clearing a local flag |

Rules:

- `delete` means "no longer indexable", not necessarily "deleted". After a `delete`, a later `upsert` of the same
  object makes it indexable again.
- `seq` is strictly increasing per instance. Events are delivered in `seq` order.
- The instance MAY coalesce events: several events for one object can be replaced by the latest one. Consumers
  MUST treat every event as "read the current state", and MUST NOT rely on seeing every intermediate change.
- The instance MUST retain `delete` and `exclude` events for at least 30 days, and SHOULD retain all events for
  at least 30 days.
- If the cursor is older than retained history, the instance answers `410 cursor_expired`. The indexer then runs
  a [reconcile](#reconciliation) and starts a new feed from the latest cursor.
- Order and delivery are at least once. Events are idempotent.
- `GET /changes` without a cursor starts at the oldest retained event. `GET /changes?cursor=latest` returns no
  events and a `next_cursor` for the current end, so a reconcile can resume the feed afterwards.

## Reconciliation

The indexer runs a full reconcile for each listed instance at least every 24 hours, after a `cursor_expired`,
and when an instance is first verified.

1. Take the feed's current cursor with `cursor=latest`.
2. Enumerate `GET /places` and every board's `GET /boards/{id}/topics`.
3. Add or refresh anything new or with a newer `updated_at` than the stored copy, by reading `GET /topics/{id}`.
4. Delete everything the indexer has for the instance that the enumeration did not return.
5. Resume the feed from the cursor taken in step 1. Events that arrive during the sweep are harmless because
   they are idempotent.

Step 4 is what bounds the worst-case removal time. The 24-hour promise applies to instances within the default
size caps (see [Fetching rules](#fetching-rules-for-the-indexer)).

## Ping

A ping tells the indexer that the change feed has new events. It carries no content and is optional.

`POST https://gotalk.sh/api/index/v1/ping`

```json
{ "origin": "https://forum.example" }
```

Signed with an Ed25519 key advertised in `directory.keys`, over this signing string (joined with a single `\n`,
no trailing newline):

```
GOTALK-INDEX-SIG-V1
{METHOD}
{HOST}
{PATH_AND_QUERY}
{TIMESTAMP}
{NONCE}
{KEY_ID}
{BODY_SHA256_BASE64URL}
```

Headers match the [gateway's request signing](https://github.com/parkerbrown98/gotalk-gateway/blob/main/docs/protocol.md#request-signing):
`Gotalk-Key-Id`, `Gotalk-Timestamp`, `Gotalk-Nonce`, `Content-Digest`, `Gotalk-Signature`. Differences:

- The domain separator is `GOTALK-INDEX-SIG-V1`, so a signature for one service cannot be replayed to the
  other, even with a shared key.
- There are no registered key IDs. `Gotalk-Key-Id` is the public key itself (unpadded base64url), and the
  indexer looks it up in the origin's well-known `directory.keys`, refetching the document at most once a
  minute if the key is unknown.
- `HOST` is `gotalk.sh`.

Checks: signature, timestamp skew of at most 300 seconds, nonce not seen in 600 seconds, the key is listed in
the well-known document of the origin in the body, and the instance is `pending` or `listed`.

Responses: `202 Accepted` (the instance is queued for a feed read), `401` (invalid signature or unknown key),
`404` (unknown instance), `429` with `Retry-After`. At most one ping per instance is accepted every 30 seconds
and the instance is never crawled more often than its rate limits allow. A ping is a hint. The indexer reads the
feed on a timer even without pings (every 5 minutes for a `listed` instance).

Instances SHOULD send a ping at most once per 30 seconds after one or more feed events, and SHOULD NOT send
pings for instances with `listed: false`.

## Registration and lifecycle

### Register

`POST https://gotalk.sh/api/index/v1/instances`, unauthenticated, rate limited per IP.

```json
{ "origin": "https://forum.example" }
```

The indexer normalizes the origin (IDN, default ports, https only), fetches the well-known document and checks
`directory.listed` is `true` and `directory.protocol` is supported. It then stores the instance and answers
`201 Created`:

```json
{ "origin": "https://forum.example", "status": "pending" }
```

- If the document is unreachable or `listed` is not true, the answer is `422 verification_failed` with a
  `detail` that names the failed check. Nothing is stored.
- Registering an origin that is already registered is idempotent and returns the current status.
- Registering a blocked origin answers `403 origin_blocked`.
- There is no challenge token. Control of the origin is shown by the well-known document itself, which only the
  origin's operator can change, so the registration call proves nothing and needs no secret.

`GET https://gotalk.sh/api/index/v1/instances?origin=…` returns the public status of an origin
(`status`, `listed_since`, counts of indexed places and topics, and the last crawl time). It is what the
[operator status page](platform-plan.md#phase-6--operator-experience-and-moderation-) shows.

### Status lifecycle

| Status | Meaning | Pages served |
|---|---|---|
| `pending` | Verified. Being crawled. Has not passed the quality gate | Yes, `noindex`, not in sitemaps or the directory |
| `listed` | Passed the quality gate | Yes, indexable, in sitemaps and the directory |
| `stale` | The origin has been unreachable for 7 days | Yes, `noindex`, removed from sitemaps and the directory |
| `suspended` | Suspended by the platform operators for abuse | No, `410` |
| `blocked` | Origin on the blocklist | No, `410`. Registration refused |
| `removed` | The operator turned listing off, or the instance was unreachable for 30 days | No, `410`. Data purged |

Transitions:

| From | To | When |
|---|---|---|
| (none) | `pending` | Successful registration |
| `pending` | `listed` | The [quality gate](platform-plan.md#abuse-privacy-and-legal) passes: 14 days since verification, 5 distinct authors, 50 public posts, no blocklist hits |
| `pending`, `listed`, `stale` | `removed` | The well-known document is fetched and `directory.listed` is not `true`. Purge starts immediately |
| `listed`, `pending` | `stale` | The origin fails to answer for 7 days. Transient failures do not count as listed-off |
| `stale` | `listed` or `pending` | The origin answers again and the crawl succeeds. The status it had before `stale` is restored |
| `stale` | `removed` | Unreachable for 30 days |
| any | `suspended` or `blocked` | A platform operator action |
| `removed` | `pending` | The operator registers again. The quality gate restarts |

The indexer re-fetches the well-known document of every `pending`, `listed` and `stale` instance every 15
minutes. This, not the feed, is what makes "turn listing off" take effect within the one-hour removal promise.

A purge deletes the instance's rows and sets pages to `410`. The `takedowns` table keeps only origin, remote ID
and a hash for pages removed by a takedown request.

## Fetching rules for the indexer

The indexer fetches operator-supplied origins, so it MUST:

- Use HTTPS on port 443 only, unless explicitly configured for development.
- Resolve DNS, refuse any address that is not public (loopback, private, link-local, carrier-grade NAT, multicast
  and cloud metadata ranges), and check again at connect time. Ignore system proxies.
- Never follow redirects. A redirect is an error. Hosts that moved are handled by re-registration.
- Time out connect at 5 seconds and the whole response at 30 seconds. Limit well-known responses to 64 KiB and
  index responses to 5 MiB.
- Require `Content-Type: application/json` and reject anything else.
- Send at most 2 requests at a time to one origin and honor `Retry-After` and `429`. Back off exponentially on
  errors, with a per-origin circuit breaker.
- Treat all response data as untrusted: validate against the schema, cap string lengths, render and sanitize
  Markdown on its side, and never fetch URLs found inside content.
- Apply per-instance caps. Defaults for `pending` and for any instance: 50 places, 5,000 boards, 100,000
  topics and 2,000,000 posts. Beyond a cap the indexer stops adding content and records that fact on the
  instance's status. Caps are configuration, and verified instances can be raised.
- In v1, content images and attachments are not fetched and not rendered. An image in a post appears as a text
  link to the original. This avoids hotlinking, leaking visitors' IPs to instances and running an image proxy.

## Errors and rate limits

Errors use RFC 9457 problem details, the same as the server API.

| Status | `type` suffix | Where | Meaning |
|---|---|---|---|
| 404 | `not_found` | Instance endpoints | Missing or not indexable |
| 410 | `cursor_expired` | `GET /changes` | The cursor is older than retained history. Run a reconcile |
| 429 | `rate_limited` | Both | Honor `Retry-After` |
| 403 | `origin_blocked` | Platform registration | Origin is blocked |
| 422 | `verification_failed` | Platform registration | The well-known check failed. `detail` names the check |
| 401 | `invalid_signature`, `unknown_key`, `stale_timestamp`, `replayed_nonce` | Platform ping | As in the gateway protocol |

Instances SHOULD give `/api/v1/index/*` its own rate-limit tier, keyed per IP, sized for a crawler (for example
10 requests per second with bursts of 50). They MUST NOT charge it against user tiers.

## Versioning

- `directory.protocol` is an integer. This document is version 1.
- Adding fields and event types is not a breaking change. Consumers ignore unknown fields and unknown event types.
- A breaking change takes a new protocol number. Because every endpoint is advertised in the well-known document
  as a full URL, an instance can serve two protocol versions side by side, and the indexer uses the highest one
  it supports. The indexer treats an instance with an unsupported `protocol` as not listed and reports why on its
  status.

## Security considerations

- **Only the origin can list itself.** The registration call is unauthenticated and harmless: it does nothing
  unless the origin's own document says `listed: true`.
- **Ping abuse.** Pings are signed and rate limited, and they only move a crawl earlier. A forged ping cannot add
  content.
- **Hostile instances.** The indexer's fetch rules, caps and sanitization exist because an operator can serve
  anything. An instance that serves content outside its declared bounds, oversized responses or inconsistent
  data is moved to `suspended`.
- **Leaking non-public content.** The risk is on the instance side, so the rules in
  [What is indexable](#what-is-indexable) are tested in `gotalk-server` against its anonymous-read behavior:
  nothing returned from `/index/*` may be unreadable by a signed-out visitor.
- **Re-listing after removal.** A takedown is keyed by origin and remote ID, so a re-crawl cannot restore a
  removed page. This does not stop an instance from re-publishing under new IDs. That is handled by suspension.
- **Timing.** The removal promise (1 hour with feed and ping or the 15-minute well-known check, 24 hours worst
  case) depends on the reconcile and well-known cadences above. They are product commitments, so changes to them
  need a policy update.

## Conformance fixtures

To keep the three repos aligned, this repo will hold the fixtures that define the contract:

- `packages/index-protocol/schemas/`: JSON Schema for the well-known `directory` block, every endpoint response
  and every event type.
- `packages/index-protocol/fixtures/`: example documents, including the edge cases above: a topic whose opening
  post is excluded, a board moved between places, a `cursor_expired` response, a coalesced feed and an
  NSFW-skipped place.
- `packages/fake-instance`: a small server that implements the instance side from the fixtures, used by
  indexer tests and available to `gotalk-server` for contract tests.

`gotalk-server` is expected to validate its responses against the schemas in its own tests.
