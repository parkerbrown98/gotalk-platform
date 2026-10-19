import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  loadSigningVector,
  validate,
  verifyPingHeaders,
  type PingVerification,
  type WellKnown,
} from '@gotalk-platform/index-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ping } from './ping.ts';
import { createFakeInstance, type FakeInstance } from './server.ts';

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  verification: PingVerification;
}

/** A minimal platform that verifies pings against the fake's well-known keys. */
async function fakePlatform(keysFor: () => string[]) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const verification = verifyPingHeaders(req.headers, {
        method: req.method ?? '',
        host: req.headers.host ?? '',
        path: req.url ?? '',
        body,
        keys: keysFor(),
      });
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
        verification,
      });
      res.writeHead(verification.ok ? 202 : 401).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let fake: FakeInstance;
let platform: Awaited<ReturnType<typeof fakePlatform>>;

beforeAll(async () => {
  fake = await createFakeInstance();
  platform = await fakePlatform(() => (fake.wellKnown().directory?.keys ?? []).map((k) => k.public_key));
});
afterAll(async () => {
  await fake.close();
  await platform.close();
});

describe('ping', () => {
  it('sends a signed ping the platform verifies with the well-known key', async () => {
    const result = await fake.ping(platform.url);
    expect(result.status).toBe(202);
    const got = platform.received.at(-1)!;
    expect(got.method).toBe('POST');
    expect(got.url).toBe('/api/index/v1/ping');
    expect(got.headers['content-type']).toBe('application/json');
    expect(JSON.parse(got.body)).toEqual({ origin: fake.origin });
    expect(validate('ping-request', JSON.parse(got.body)).valid).toBe(true);
    expect(got.verification).toMatchObject({ ok: true, keyId: fake.publicKey });
    const wellKnown = (await (await fetch(fake.wellKnownUrl)).json()) as WellKnown;
    expect(wellKnown.directory?.keys?.map((k) => k.public_key)).toContain(got.headers['gotalk-key-id']);
  });

  it('signs with the given time and keeps a base path', async () => {
    const now = new Date(Date.now() - 60_000);
    await fake.ping(`${platform.url}/`, { now });
    const got = platform.received.at(-1)!;
    expect(got.headers['gotalk-timestamp']).toBe(String(Math.floor(now.getTime() / 1000)));
    expect(got.verification.ok).toBe(true);

    await fake.ping(`${platform.url}/platform`);
    expect(platform.received.at(-1)?.url).toBe('/platform/api/index/v1/ping');
    expect(platform.received.at(-1)?.verification.ok).toBe(true);
  });

  it('is rejected when the key is not advertised or the time is stale', async () => {
    const other = await createFakeInstance({ seed: Buffer.alloc(32, 3) });
    try {
      expect((await other.ping(platform.url)).status).toBe(401);
      expect(platform.received.at(-1)?.verification).toMatchObject({ ok: false, code: 'unknown_key' });
    } finally {
      await other.close();
    }
    expect((await fake.ping(platform.url, { now: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect(platform.received.at(-1)?.verification).toMatchObject({ ok: false, code: 'stale_timestamp' });
  });

  it('reproduces the signing vector headers for gotalk.sh', async () => {
    const vector = loadSigningVector();
    const result = await ping(platform.url, {
      seed: vector.seed,
      origin: 'https://forum.example',
      now: vector.timestamp,
      nonce: vector.nonce,
      signHost: 'gotalk.sh',
    });
    const { 'Content-Type': contentType, ...signed } = result.request.headers;
    expect(contentType).toBe('application/json');
    expect(signed).toEqual(vector.headers);
    expect(result.request.body).toBe(vector.body);
  });
});
