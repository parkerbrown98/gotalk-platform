import { describe, expect, it } from 'vitest';

import { loadSigningVector } from './fixtures.ts';
import {
  bodySha256,
  contentDigest,
  publicKeyFromSeed,
  sign,
  signingString,
  signPingHeaders,
  verify,
  verifyPingHeaders,
  type SignedRequestParts,
  type VerifyPingOptions,
} from './signing.ts';

const vector = loadSigningVector();
const request: SignedRequestParts = {
  method: vector.method,
  host: vector.host,
  path: vector.path,
  timestamp: vector.timestamp,
  nonce: vector.nonce,
  keyId: vector.key_id,
  body: vector.body,
};

describe('signing vector', () => {
  it('reproduces every value', () => {
    expect(publicKeyFromSeed(vector.seed)).toBe(vector.public_key);
    expect(vector.key_id).toBe(vector.public_key);
    expect(bodySha256(vector.body)).toBe(vector.body_sha256);
    expect(contentDigest(vector.body)).toBe(vector.content_digest);
    expect(signingString(request)).toBe(vector.signing_string);
    expect(sign(vector.seed, request)).toBe(vector.signature);
    expect(verify(vector.public_key, request, vector.signature)).toBe(true);
  });

  it('pins the literal values', () => {
    expect(vector.public_key).toBe('A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg');
    expect(vector.signing_string.split('\n')).toEqual([
      'GOTALK-INDEX-SIG-V1',
      'POST',
      'gotalk.sh',
      '/api/index/v1/ping',
      '1792300800',
      'AAECAwQFBgcICQoLDA0ODw',
      'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg',
      vector.body_sha256,
    ]);
    expect(vector.content_digest).toMatch(/^sha-256=:[A-Za-z0-9+/]{43}=:$/);
    expect(vector.signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it('produces the same headers through signPingHeaders', () => {
    const headers = signPingHeaders({
      seed: Buffer.from(vector.seed, 'base64url'),
      body: vector.body,
      timestamp: vector.timestamp,
      nonce: vector.nonce,
    });
    expect(headers).toEqual(vector.headers);
    expect(headers).toEqual({
      'Gotalk-Key-Id': vector.key_id,
      'Gotalk-Timestamp': String(vector.timestamp),
      'Gotalk-Nonce': vector.nonce,
      'Content-Digest': vector.content_digest,
      'Gotalk-Signature': vector.signature,
    });
  });

  it('matches the gateway protocol vector when given its domain separator', () => {
    // gotalk-gateway docs/protocol.md, Appendix A, generated with Go's crypto/ed25519.
    const gateway: SignedRequestParts = {
      method: 'POST',
      host: 'push.example',
      path: '/v1/push',
      timestamp: 1760719200,
      nonce: 'AAECAwQFBgcICQoLDA0ODw',
      keyId: 'key_example',
      body: '{"subscription_id":"sub_example","mode":"id_only","notification_id":"n_1"}',
    };
    expect(bodySha256(gateway.body)).toBe('SAUX3kZI6oRsw2ZIemu0vm_ENHcqIi_nr3Mtwf_zBvo');
    expect(sign(vector.seed, gateway, 'GOTALK-SIG-V1')).toBe(
      '3-vRa4hvPv4thLZdk2BO6zN_MPuYP8x9sYVISDDvaA7eyStJU6eE_R3-lJsYlZ2Y8IpNzlOPgwEJ8kAPpba2Aw',
    );
  });
});

describe('verify', () => {
  it('rejects a tampered body, host, path, timestamp, nonce or key ID', () => {
    const tampered: Partial<SignedRequestParts>[] = [
      { body: '{"origin":"https://evil.example"}' },
      { host: 'push.gotalk.sh' },
      { path: '/api/index/v1/instances' },
      { timestamp: vector.timestamp + 1 },
      { nonce: 'AAECAwQFBgcICQoLDA0ODx' },
      { method: 'PUT' },
    ];
    for (const change of tampered) {
      expect(verify(vector.public_key, { ...request, ...change }, vector.signature)).toBe(false);
    }
  });

  it('is case-insensitive in method and host only', () => {
    expect(
      verify(vector.public_key, { ...request, method: 'post', host: 'GOTALK.SH' }, vector.signature),
    ).toBe(true);
  });

  it('rejects the wrong key, a malformed signature and the gateway domain', () => {
    const other = publicKeyFromSeed(Buffer.alloc(32, 7));
    expect(verify(other, request, vector.signature)).toBe(false);
    expect(verify(vector.public_key, request, 'not!base64')).toBe(false);
    expect(verify(vector.public_key, request, vector.signature.slice(0, -2))).toBe(false);
    expect(verify('short', request, vector.signature)).toBe(false);
    expect(verify(vector.public_key, request, vector.signature, 'GOTALK-SIG-V1')).toBe(false);
  });
});

describe('verifyPingHeaders', () => {
  const now = vector.timestamp + 10;
  const base: VerifyPingOptions = { body: vector.body, now, keys: [vector.public_key] };

  it('accepts the vector', () => {
    expect(verifyPingHeaders(vector.headers, base)).toEqual({
      ok: true,
      keyId: vector.public_key,
      nonce: vector.nonce,
      timestamp: vector.timestamp,
    });
    const lower = Object.fromEntries(Object.entries(vector.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifyPingHeaders(new Headers(lower), base).ok).toBe(true);
  });

  it('returns the gateway error codes', () => {
    const code = (headers: Record<string, string>, options: VerifyPingOptions = base) => {
      const result = verifyPingHeaders(headers, options);
      return result.ok ? 'ok' : result.code;
    };
    const unsigned = { ...vector.headers };
    delete unsigned['Gotalk-Signature'];
    expect(code(unsigned)).toBe('invalid_signature');
    expect(code({ ...vector.headers, 'Gotalk-Nonce': 'AAEC' })).toBe('invalid_signature');
    expect(code(vector.headers, { ...base, keys: [publicKeyFromSeed(Buffer.alloc(32, 1))] })).toBe(
      'unknown_key',
    );
    expect(code(vector.headers, { ...base, now: vector.timestamp + 301 })).toBe('stale_timestamp');
    expect(code(vector.headers, { ...base, now: vector.timestamp - 301 })).toBe('stale_timestamp');
    expect(code(vector.headers, { ...base, body: '{"origin":"https://evil.example"}' })).toBe(
      'invalid_signature',
    );
    expect(code({ ...vector.headers, 'Content-Digest': contentDigest('other') })).toBe('invalid_signature');
    expect(code(vector.headers, { ...base, host: 'staging.gotalk.sh' })).toBe('invalid_signature');
  });

  it('round-trips fresh random nonces', () => {
    const seed = Buffer.alloc(32, 9);
    const body = JSON.stringify({ origin: 'https://other.example' });
    const headers = signPingHeaders({ seed, body });
    expect(headers['Gotalk-Nonce']).not.toBe(signPingHeaders({ seed, body })['Gotalk-Nonce']);
    expect(verifyPingHeaders(headers, { body, keys: [publicKeyFromSeed(seed)] }).ok).toBe(true);
  });
});
