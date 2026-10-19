import { formatErrors, validate, type ChangesPage, type PlacesPage } from '@gotalk-platform/index-protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixtureIds as ids } from './dataset.ts';
import { createFakeInstance, type FakeInstance } from './server.ts';
import { get, rawGet, schemaFor } from './test-helpers.ts';

let fake: FakeInstance;
beforeEach(async () => {
  fake = await createFakeInstance();
});
afterEach(() => fake.close());

const places = '/api/v1/index/places';
const routes = [
  '/.well-known/gotalk-instance',
  places,
  `/api/v1/index/boards/${ids.beginners}/topics`,
  `/api/v1/index/topics/${ids.borrowTopic}`,
  '/api/v1/index/changes',
];

describe('slow', () => {
  it('delays the headers', async () => {
    fake.setFault(places, { kind: 'slow', delayMs: 300 });
    const res = await rawGet(`${fake.url}${places}`);
    expect(res.status).toBe(200);
    expect(res.headersAfter).toBeGreaterThanOrEqual(280);
    expect(validate('places-page', JSON.parse(res.body.toString())).valid).toBe(true);
  });

  it('trickles the body in chunks', async () => {
    fake.setFault(places, { kind: 'slow', intervalMs: 20, chunkBytes: 1024 });
    const res = await rawGet(`${fake.url}${places}`);
    const expected = await (await fetch(`${fake.url}${places}`)).text();
    const chunks = Math.ceil(Buffer.byteLength(expected) / 1024);
    expect(chunks).toBeGreaterThan(2);
    expect(res.body.toString()).toBe(expected);
    expect(res.chunks.length).toBeGreaterThanOrEqual(chunks);
    expect(res.endAfter - res.headersAfter).toBeGreaterThanOrEqual((chunks - 1) * 20 - 10);
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(expected));
  });

  it('still answers If-None-Match', async () => {
    const etag = (await get(fake, places)).headers.get('etag') ?? '';
    fake.setFault(places, { kind: 'slow', delayMs: 50 });
    expect((await get(fake, places, { 'If-None-Match': etag })).status).toBe(304);
  });
});

describe('huge', () => {
  it('sends a valid document over 5 MiB with Content-Length', async () => {
    fake.setFault(places, { kind: 'huge' });
    const res = await rawGet(`${fake.url}${places}`);
    expect(Number(res.headers['content-length'])).toBeGreaterThan(5 * 1024 * 1024);
    expect(res.body.length).toBe(Number(res.headers['content-length']));
    const doc = JSON.parse(res.body.toString()) as PlacesPage;
    expect(validate('places-page', doc).valid).toBe(true);
    expect(doc.items).toHaveLength(3);
  });

  it('can hide the size until it is read', async () => {
    fake.setFault(places, { kind: 'huge', bytes: 2 * 1024 * 1024, chunked: true });
    const res = await rawGet(`${fake.url}${places}`);
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.body.length).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('stops writing when the client goes away', async () => {
    fake.setFault(places, { kind: 'huge', bytes: 64 * 1024 * 1024 });
    const controller = new AbortController();
    const res = await fetch(`${fake.url}${places}`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    expect((await get(fake, '/api/v1/index/changes?cursor=latest')).status).toBe(200);
  });
});

describe('wrong-content-type', () => {
  it('serves an HTML page as text/html', async () => {
    fake.setFault(places, { kind: 'wrong-content-type' });
    const res = await get(fake, places);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.text).toMatch(/^<!doctype html>/);
  });

  it('can keep the JSON body under the wrong type', async () => {
    fake.setFault(places, { kind: 'wrong-content-type', contentType: 'text/plain', keepBody: true });
    const res = await get(fake, places);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(validate('places-page', res.json).valid).toBe(true);
  });
});

describe('invalid-json', () => {
  it.each(routes)('truncates %s mid-document', async (path) => {
    fake.setFault(path, { kind: 'invalid-json' });
    const res = await get(fake, path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(() => JSON.parse(res.text)).toThrow();
  });
});

describe('schema-violation', () => {
  for (const variant of ['author-email', 'missing-field', 'wrong-type'] as const) {
    it.each(routes)(`${variant} breaks %s`, async (path) => {
      fake.setFault(path, { kind: 'schema-violation', variant });
      const res = await get(fake, path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(validate(schemaFor(path), res.json).valid).toBe(false);
    });
  }

  it('author-email puts an email in an author', async () => {
    const path = `/api/v1/index/topics/${ids.borrowTopic}`;
    fake.setFault(path, { kind: 'schema-violation' });
    const result = validate('topic', (await get(fake, path)).json);
    expect(formatErrors(result.errors)).toContain('/author must NOT have additional properties (email)');
  });

  it('accepts a custom mutation in-process', async () => {
    fake.setFault(places, {
      kind: 'schema-violation',
      mutate: (doc) => ({ ...(doc as PlacesPage), next_cursor: 42 }),
    });
    const result = validate('places-page', (await get(fake, places)).json);
    expect(result.errors.map((e) => e.instancePath)).toContain('/next_cursor');
  });
});

describe('redirect', () => {
  it('redirects to another origin', async () => {
    fake.setFault(places, { kind: 'redirect' });
    const res = await get(fake, `${places}?limit=1`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://elsewhere.example${places}?limit=1`);
  });

  it('takes a location and status', async () => {
    fake.setFault('/.well-known/gotalk-instance', {
      kind: 'redirect',
      status: 301,
      location: 'http://127.0.0.1:1/',
    });
    const res = await get(fake, '/.well-known/gotalk-instance');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('http://127.0.0.1:1/');
  });
});

describe('status', () => {
  it('answers 500 with a problem', async () => {
    fake.setFault(places, { kind: 'status', status: 500 });
    const res = await get<{ status: number; code: string }>(fake, places);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('retry-after')).toBeNull();
    expect(validate('problem', res.json).valid).toBe(true);
  });

  it('answers 429 with Retry-After and rate_limited', async () => {
    fake.setFault('*', { kind: 'status', status: 429, retryAfter: 7 });
    for (const path of routes) {
      const res = await get<{ code: string }>(fake, path);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('7');
      expect(res.json.code).toBe('rate_limited');
      expect(validate('problem', res.json).valid).toBe(true);
    }
  });

  it('defaults Retry-After for 503', async () => {
    fake.setFault(places, { kind: 'status', status: 503 });
    expect((await get(fake, places)).headers.get('retry-after')).toBe('30');
  });
});

describe('hang', () => {
  it('never sends headers', async () => {
    fake.setFault(places, { kind: 'hang' });
    await expect(fetch(`${fake.url}${places}`, { signal: AbortSignal.timeout(200) })).rejects.toThrow();
    expect((await get(fake, '/api/v1/index/changes?cursor=latest')).status).toBe(200);
  });

  it('can hang after the headers', async () => {
    fake.setFault(places, { kind: 'hang', afterHeaders: true });
    const res = await fetch(`${fake.url}${places}`, { signal: AbortSignal.timeout(300) });
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });

  it('does not stop close()', async () => {
    const local = await createFakeInstance();
    local.setFault('*', { kind: 'hang' });
    const pending = fetch(`${local.url}${places}`).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await local.close();
    expect(await pending).toBeInstanceOf(Error);
  });
});

describe('fault selection', () => {
  it('applies a fault a limited number of times', async () => {
    fake.setFault(places, { kind: 'status', status: 503 }, { times: 2 });
    expect((await get(fake, places)).status).toBe(503);
    expect((await get(fake, places)).status).toBe(503);
    expect((await get(fake, places)).status).toBe(200);
  });

  it('prefers the most specific route', async () => {
    fake.setFault('*', { kind: 'status', status: 500 });
    fake.setFault('/api/v1/index/topics/*', { kind: 'status', status: 502 });
    fake.setFault(`/api/v1/index/topics/${ids.linesTopic}`, { kind: 'status', status: 503 });
    expect((await get(fake, places)).status).toBe(500);
    expect((await get(fake, `/api/v1/index/topics/${ids.borrowTopic}`)).status).toBe(502);
    expect((await get(fake, `/api/v1/index/topics/${ids.linesTopic}`)).status).toBe(503);
    fake.setFault('*', null);
    expect((await get(fake, places)).status).toBe(200);
    fake.clearFaults();
    expect((await get(fake, `/api/v1/index/topics/${ids.borrowTopic}`)).status).toBe(200);
  });

  it('is deterministic', async () => {
    fake.setFault('/api/v1/index/changes', { kind: 'invalid-json' });
    const a = await get(fake, '/api/v1/index/changes');
    const b = await get(fake, '/api/v1/index/changes');
    expect(a.text).toBe(b.text);
    fake.clearFaults();
    const full = await get<ChangesPage>(fake, '/api/v1/index/changes');
    expect(full.text.startsWith(a.text)).toBe(true);
  });

  it('records requests and concurrency', async () => {
    fake.setFault(places, { kind: 'slow', delayMs: 100 });
    await Promise.all([
      get(fake, places),
      get(fake, places),
      get(fake, places, { 'User-Agent': 'GotalkIndexer/1' }),
    ]);
    expect(fake.maxConcurrent).toBe(3);
    expect(fake.requests.map((r) => r.url)).toEqual([places, places, places]);
    expect(fake.requests.some((r) => r.headers['user-agent'] === 'GotalkIndexer/1')).toBe(true);
  });
});
