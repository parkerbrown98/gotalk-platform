# @gotalk-platform/fake-instance

A small Node HTTP server (`node:http` only) that implements the instance side of the
[index protocol](../../docs/index-protocol.md): the well-known `directory` block, `GET /api/v1/instance` and
the four index endpoints with cursors, ETags and the change feed. Its data is seeded from the
[index-protocol fixtures](../index-protocol/fixtures), plus objects the fixtures leave out because they are not
indexable (an NSFW place, a members-only board, an opted-out board, a private place, a deleted and a draft topic,
and a topic whose opening post's author excluded their posts).

It is for the Phase 4 indexer's tests, and for anyone who needs a protocol-correct instance to point at:
mutations produce the feed events a real instance would, and failure modes reproduce hostile or broken origins.

## Run it

```sh
node packages/fake-instance/src/cli.ts --port 8787            # prints the origin, http://127.0.0.1:8787
node packages/fake-instance/src/cli.ts --port 8787 --control  # also serves /__fake/* to drive it over HTTP
node packages/fake-instance/src/cli.ts --help
```

With `--control`, another process can call any mutation and set faults:

```sh
curl -s localhost:8787/__fake/state
curl -s -X POST localhost:8787/__fake/call -d '{"method":"excludeUser","args":["0195faae-93e0-79c7-bfbc-ce60b9bd3c01"]}'
curl -s -X POST localhost:8787/__fake/faults -d '{"route":"/api/v1/index/places","fault":{"kind":"status","status":429}}'
curl -s -X DELETE localhost:8787/__fake/faults
```

The control routes do not exist unless `control: true` (or `--control`) is set.

## Use it in tests

```ts
import { createFakeInstance, fixtureIds } from '@gotalk-platform/fake-instance';

const fake = await createFakeInstance(); // 127.0.0.1, a free port
fake.url; // http://127.0.0.1:53124
fake.indexUrl; // ${origin}/api/v1/index

fake.addPost(fixtureIds.linesTopic, { authorId: fixtureIds.ana, content: 'Thanks!' }); // topic.upsert
fake.excludeUser(fixtureIds.gopher); // user.exclude, topic.delete for topics they opened
fake.setPlaceVisibility(fixtureIds.homelab, 'private'); // place.delete
fake.setListed(false); // well-known listed: false
fake.expireBefore(fake.state.lastSeq); // older cursors get 410 cursor_expired
fake.setFault('/api/v1/index/topics/*', { kind: 'slow', delayMs: 2000 });

await fake.ping('http://127.0.0.1:4321'); // a signed ping to /api/index/v1/ping
await fake.close();
```

Options: `port`, `host`, `publicOrigin` (advertise another origin), `seed` (Ed25519 seed for `directory.keys`;
defaults to the signing vector's), `noKeys`, `contactEmail`, `control`, `coalesce` (keep only the latest event
per object), `seedEvents` (initial `place.upsert` and `topic.upsert` history, default on), `firstSeq`, `now`
(a clock), and `dataset` (your own data instead of the fixtures).

Mutations (also on `fake.state`): `addUser`, `addTopic`, `editTopic`, `deleteTopic`, `moveTopic`, `addPost`,
`editPost`, `deletePost`, `setPostHidden`, `excludeUser`, `includeUser`, `setPlace`, `setPlaceIndexable`,
`setPlaceVisibility`, `setBoard`, `moveBoard`, `setListed`, `expireBefore`, `pruneHistory` and `emit` (append
any event, including unknown types). `fake.requests` records every request and `fake.maxConcurrent` the highest
number in flight at once.

### Faults

`fake.setFault(route, fault, { times? })` applies to an exact path, a prefix ending in `*`, or `*` for every
route; the most specific wins, and `times` limits how many requests it affects. `null` clears it.

| Kind                 | Behavior                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `slow`               | `delayMs` before the headers; with `intervalMs`, the body trickles in `chunkBytes` pieces        |
| `huge`               | A valid document padded past `bytes` (default 6 MiB); `chunked: true` omits `Content-Length`     |
| `wrong-content-type` | `text/html` (or `contentType`) with an HTML page, or the real JSON with `keepBody`               |
| `invalid-json`       | The real body cut in half                                                                        |
| `schema-violation`   | `author-email` (default), `missing-field` or `wrong-type`; in-process, a custom `mutate`         |
| `redirect`           | `302` (or `status`) to `https://elsewhere.example` plus the path (or `location`)                 |
| `status`             | Any status with a problem body; `429` and `503` send `Retry-After` (default 30, or `retryAfter`) |
| `hang`               | Never responds; with `afterHeaders`, sends headers and a few bytes, then stalls                  |

## Checks

```sh
pnpm --filter @gotalk-platform/fake-instance test
pnpm --filter @gotalk-platform/fake-instance typecheck
```

The tests validate every response against the index-protocol schemas, compare the seeded responses with the
fixtures, walk every cursor, and check each mutation's events against the feed
fixtures.
