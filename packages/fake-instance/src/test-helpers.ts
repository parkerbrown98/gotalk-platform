import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { assertValid, type SchemaName } from '@gotalk-platform/index-protocol';

import type { FakeInstance } from './server.ts';

export interface Got<T = unknown> {
  status: number;
  headers: Headers;
  text: string;
  json: T;
}

/** GETs a path from the fake and parses JSON when there is a body. */
export async function get<T = unknown>(
  fake: FakeInstance,
  path: string,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${fake.url}${path}`, { headers, redirect: 'manual' });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json: json as T } satisfies Got<T>;
}

/** The schema a fake route's 200 response must match. */
export function schemaFor(path: string): SchemaName {
  const pathname = path.split('?')[0] ?? path;
  if (pathname === '/.well-known/gotalk-instance') return 'well-known';
  if (pathname.endsWith('/places')) return 'places-page';
  if (pathname.endsWith('/changes')) return 'changes-page';
  if (/\/boards\/[^/]+\/topics$/.test(pathname)) return 'board-topics-page';
  if (/\/topics\/[^/]+$/.test(pathname)) return 'topic';
  throw new Error(`no schema for ${path}`);
}

/** GETs a document, checks the protocol's headers and validates it against its schema. */
export async function getDoc<T>(fake: FakeInstance, path: string): Promise<T & {}> {
  const res = await get<T>(fake, path);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${res.text}`);
  if (res.headers.get('content-type') !== 'application/json') throw new Error(`${path}: wrong content type`);
  if (res.headers.get('cache-control') !== 'no-cache') throw new Error(`${path}: missing Cache-Control`);
  if (!/^"[A-Za-z0-9_-]+"$/.test(res.headers.get('etag') ?? ''))
    throw new Error(`${path}: missing strong ETag`);
  assertValid(schemaFor(path), res.json);
  return res.json as T & {};
}

/** GETs a problem response and validates it. */
export async function getProblem(fake: FakeInstance, path: string, status: number) {
  const res = await get<{ code: string; status: number; type: string }>(fake, path);
  if (res.status !== status) throw new Error(`${path}: expected ${status}, got ${res.status} ${res.text}`);
  if (res.headers.get('content-type') !== 'application/problem+json') {
    throw new Error(`${path}: wrong problem content type ${res.headers.get('content-type')}`);
  }
  assertValid('problem', res.json);
  return res.json;
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  chunks: Buffer[];
  body: Buffer;
  /** Milliseconds from sending the request to the headers and to the end of the body. */
  headersAfter: number;
  endAfter: number;
}

/** A raw node:http GET that records chunk boundaries and timings. Rejects after `timeoutMs`. */
export function rawGet(url: string, timeoutMs = 5000): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = httpRequest(url, (res) => {
      const headersAfter = performance.now() - started;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          chunks,
          body: Buffer.concat(chunks),
          headersAfter,
          endAfter: performance.now() - started,
        }),
      );
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}
