import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks a GitHub webhook's `X-Hub-Signature-256` header (`sha256=<hex HMAC of the raw body>`) against the
 * shared secret, in constant time.
 */
export function verifySignature(secret: string, body: Uint8Array, header: string | null): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Release webhook actions that change what the site shows. */
export const releaseActions = new Set([
  'published',
  'unpublished',
  'created',
  'edited',
  'deleted',
  'prereleased',
  'released',
]);
