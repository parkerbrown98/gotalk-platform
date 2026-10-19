import { readFileSync } from 'node:fs';

import type { SchemaName } from './types.ts';

export const fixturesDir = new URL('../fixtures/', import.meta.url);

export interface FixtureEntry {
  /** File name in fixtures/. */
  file: string;
  /** The schema the document must validate against. */
  schema: SchemaName;
  /** The HTTP status the document is served with (or, for requests, the expected answer). */
  status: number;
  /** Where the document appears, for example `GET {index_url}/places` or `POST https://gotalk.sh/...`. */
  request: string;
  description: string;
}

export interface FixtureManifest {
  fixtures: FixtureEntry[];
  /** Cross-language test vectors that are not protocol documents. */
  vectors: { file: string; description: string }[];
}

export function readFixture<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, fixturesDir), 'utf8')) as T;
}

export function loadManifest(): FixtureManifest {
  return readFixture<FixtureManifest>('manifest.json');
}

export interface SigningVector {
  description: string;
  seed: string;
  public_key: string;
  key_id: string;
  method: string;
  host: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: string;
  body_sha256: string;
  signing_string: string;
  content_digest: string;
  signature: string;
  headers: Record<string, string>;
}

export function loadSigningVector(): SigningVector {
  return readFixture<SigningVector>('signing-vector.json');
}
