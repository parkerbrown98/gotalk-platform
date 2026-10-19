# @gotalk-platform/index-protocol

The machine-readable contract of the [Gotalk public index protocol](../../docs/index-protocol.md): JSON Schemas
for every document, example documents (fixtures) that validate against them, a cross-language signing test
vector, and TypeScript helpers to validate documents and sign or verify pings.

The protocol document is the specification. If this package and the document disagree, fix one of them in the
same change.

## Contents

```
schemas/      JSON Schema (draft 2020-12), one file per document, $id https://gotalk.sh/schemas/index/v1/<name>.schema.json
fixtures/     Example documents, manifest.json, signing-vector.json
src/          validate.ts (Ajv), signing.ts (node:crypto), fixtures.ts, types.ts
scripts/      check-fixtures.ts: validates every fixture against its schema
```

| Schema                  | Document                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| `common`                | Shared `$defs`: `id`, `timestamp`, `cursor`, `author`, `problem` |
| `well-known`            | `GET /.well-known/gotalk-instance`, with an optional `directory` |
| `directory`             | The `directory` block on its own                                 |
| `places-page`           | `GET {index_url}/places`                                         |
| `board-topics-page`     | `GET {index_url}/boards/{id}/topics`                             |
| `topic`                 | `GET {index_url}/topics/{id}` (one page of posts)                |
| `changes-page`          | `GET {index_url}/changes`                                        |
| `event`                 | One change feed event                                            |
| `problem`               | RFC 9457 problem details (`application/problem+json`)            |
| `ping-request`          | `POST https://gotalk.sh/api/index/v1/ping` body                  |
| `registration-request`  | `POST https://gotalk.sh/api/index/v1/instances` body             |
| `registration-response` | Its `201` answer                                                 |
| `instance-status`       | `GET https://gotalk.sh/api/index/v1/instances?origin=`           |

Schemas reference each other by absolute `$id`, so load all of them into one validator. Objects allow unknown
properties (consumers ignore unknown fields), except `author`, which only allows `id`, `username` and
`display_name`, and the ping and registration request bodies. Event types that the schema does not know are
valid, so new types can be added without breaking consumers.

`fixtures/manifest.json` lists every fixture with the schema it must match, the HTTP status it is served with
and the request it answers. `fixtures/signing-vector.json` holds a fixed seed, nonce and timestamp and the
exact signing string, `Content-Digest` and signature a correct GOTALK-INDEX-SIG-V1 implementation produces.

## Use from TypeScript

The package ships TypeScript sources (erasable syntax only), so Node runs them directly.

```ts
import { assertValid, validate, signPingHeaders, verifyPingHeaders } from '@gotalk-platform/index-protocol';

const { valid, errors } = validate('places-page', body);
assertValid('topic', body); // throws SchemaValidationError with readable paths

const headers = signPingHeaders({ seed, body: JSON.stringify({ origin }) });
const result = verifyPingHeaders(request.headers, {
  body,
  keys: wellKnown.directory.keys.map((k) => k.public_key),
});
```

Raw files are exported too: `@gotalk-platform/index-protocol/schemas/topic.schema.json` and
`@gotalk-platform/index-protocol/fixtures/manifest.json`.

## Use from gotalk-server (Go)

Copy `schemas/` and `fixtures/` into the server's `testdata` (for example `internal/index/testdata/protocol`)
and record the platform commit they came from. Then, in tests:

- Load every `schemas/*.schema.json` into one compiler (for example `santhosh-tekuri/jsonschema/v6`, which
  supports draft 2020-12), keyed by its `$id`, and validate each `/api/v1/index/*` response against the schema
  for its route.
- Iterate `fixtures/manifest.json` and check that each fixture validates, as a guard that the copy is intact.
- Reproduce `fixtures/signing-vector.json` with `crypto/ed25519`: derive the public key from the seed, build the
  signing string, and compare the signature byte for byte.

When the protocol changes here, copy the files again in the same server change that implements it.

## Checks

```sh
pnpm --filter @gotalk-platform/index-protocol test       # schemas, fixtures, invalid documents, signing
pnpm --filter @gotalk-platform/index-protocol check      # just the fixtures against the manifest
pnpm --filter @gotalk-platform/index-protocol typecheck
```

Fixtures are hand-maintained JSON. IDs are fixed UUIDv7-shaped strings; keep them stable, because the
[fake instance](../fake-instance) seeds its data from these files and its tests compare its responses with
them.
