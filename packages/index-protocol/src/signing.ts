import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * Ping signing (GOTALK-INDEX-SIG-V1). The same scheme as the gateway's request signing with its own domain
 * separator, and with the public key itself (unpadded base64url) as the key ID.
 */
export const signingDomain = 'GOTALK-INDEX-SIG-V1';
export const pingHost = 'gotalk.sh';
export const pingPath = '/api/index/v1/ping';
/** Allowed clock skew for Gotalk-Timestamp, in seconds. */
export const maxTimestampSkewSeconds = 300;

/** The PKCS #8 DER prefix of an Ed25519 private key; the 32-byte seed follows it. */
const pkcs8Ed25519Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
/** The SPKI DER prefix of an Ed25519 public key; the 32-byte key follows it. */
const spkiEd25519Prefix = Buffer.from('302a300506032b6570032100', 'hex');

const base64urlPattern = /^[A-Za-z0-9_-]+$/;

/** A 32-byte seed as bytes or unpadded base64url, or an Ed25519 private KeyObject. */
export type PrivateKeyInput = Uint8Array | string | KeyObject;
/** A 32-byte public key as bytes or unpadded base64url, or an Ed25519 public KeyObject. */
export type PublicKeyInput = Uint8Array | string | KeyObject;

export interface SignedRequestParts {
  method: string;
  /** The host the request is sent to, for pings `gotalk.sh`. Lower-cased when signing. */
  host: string;
  /** The request target exactly as sent: path, then `?` and the raw query when there is one. */
  path: string;
  /** Unix seconds. */
  timestamp: number | string;
  /** 16 to 32 random bytes, unpadded base64url. */
  nonce: string;
  /** For pings, the public key (unpadded base64url). */
  keyId: string;
  body: string | Uint8Array;
}

function bytes(body: string | Uint8Array): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

function decodeKeyBytes(input: Uint8Array | string, what: string): Buffer {
  if (typeof input === 'string' && !base64urlPattern.test(input)) {
    throw new TypeError(`${what} must be unpadded base64url`);
  }
  const raw = typeof input === 'string' ? Buffer.from(input, 'base64url') : Buffer.from(input);
  if (raw.length !== 32) throw new TypeError(`${what} must be 32 bytes, got ${raw.length}`);
  return raw;
}

export function privateKeyFromSeed(seed: Uint8Array | string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([pkcs8Ed25519Prefix, decodeKeyBytes(seed, 'seed')]),
    format: 'der',
    type: 'pkcs8',
  });
}

function toPrivateKey(key: PrivateKeyInput): KeyObject {
  return typeof key === 'string' || key instanceof Uint8Array ? privateKeyFromSeed(key) : key;
}

function toPublicKey(key: PublicKeyInput): KeyObject {
  if (typeof key === 'string' || key instanceof Uint8Array) {
    return createPublicKey({
      key: Buffer.concat([spkiEd25519Prefix, decodeKeyBytes(key, 'public key')]),
      format: 'der',
      type: 'spki',
    });
  }
  return key.type === 'private' ? createPublicKey(key) : key;
}

/** The unpadded base64url public key for a seed (or private key): the value of `directory.keys[].public_key`. */
export function publicKeyFromSeed(seed: PrivateKeyInput): string {
  const jwk = createPublicKey(toPrivateKey(seed)).export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('not an Ed25519 key');
  return jwk.x;
}

/** Unpadded base64url SHA-256 of the raw body bytes. */
export function bodySha256(body: string | Uint8Array): string {
  return createHash('sha256').update(bytes(body)).digest('base64url');
}

/** The RFC 9530 `Content-Digest` header value: `sha-256=:<standard base64>:`. */
export function contentDigest(body: string | Uint8Array): string {
  return `sha-256=:${createHash('sha256').update(bytes(body)).digest('base64')}:`;
}

/** The canonical string that is signed, joined with `\n` and without a trailing newline. */
export function signingString(req: SignedRequestParts, domain: string = signingDomain): string {
  return [
    domain,
    req.method.toUpperCase(),
    req.host.toLowerCase(),
    req.path,
    String(req.timestamp),
    req.nonce,
    req.keyId,
    bodySha256(req.body),
  ].join('\n');
}

/** Signs a request; returns the unpadded base64url signature for `Gotalk-Signature`. */
export function sign(key: PrivateKeyInput, req: SignedRequestParts, domain: string = signingDomain): string {
  return cryptoSign(null, Buffer.from(signingString(req, domain), 'utf8'), toPrivateKey(key)).toString(
    'base64url',
  );
}

/** Checks a signature over the request. Returns false for a malformed key or signature. */
export function verify(
  publicKey: PublicKeyInput,
  req: SignedRequestParts,
  signature: string,
  domain: string = signingDomain,
): boolean {
  if (!base64urlPattern.test(signature)) return false;
  const sig = Buffer.from(signature, 'base64url');
  if (sig.length !== 64) return false;
  let key: KeyObject;
  try {
    key = toPublicKey(publicKey);
  } catch {
    return false;
  }
  return cryptoVerify(null, Buffer.from(signingString(req, domain), 'utf8'), key, sig);
}

export type PingHeaders = {
  'Gotalk-Key-Id': string;
  'Gotalk-Timestamp': string;
  'Gotalk-Nonce': string;
  'Content-Digest': string;
  'Gotalk-Signature': string;
};

export interface SignPingOptions {
  /** The instance's 32-byte Ed25519 seed (bytes or unpadded base64url) or private key. */
  seed: PrivateKeyInput;
  /** The exact body bytes that will be sent. */
  body: string | Uint8Array;
  host?: string;
  path?: string;
  method?: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
  /** Unpadded base64url; defaults to 16 random bytes. */
  nonce?: string;
}

/** The five headers of a signed ping. Send `body` unchanged with `Content-Type: application/json`. */
export function signPingHeaders(options: SignPingOptions): PingHeaders {
  const keyId = publicKeyFromSeed(options.seed);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString('base64url');
  const req: SignedRequestParts = {
    method: options.method ?? 'POST',
    host: options.host ?? pingHost,
    path: options.path ?? pingPath,
    timestamp,
    nonce,
    keyId,
    body: options.body,
  };
  return {
    'Gotalk-Key-Id': keyId,
    'Gotalk-Timestamp': timestamp,
    'Gotalk-Nonce': nonce,
    'Content-Digest': contentDigest(options.body),
    'Gotalk-Signature': sign(options.seed, req),
  };
}

export type PingVerificationCode = 'invalid_signature' | 'unknown_key' | 'stale_timestamp';

export type PingVerification =
  | { ok: true; keyId: string; nonce: string; timestamp: number }
  | { ok: false; code: PingVerificationCode; detail: string };

export interface VerifyPingOptions {
  method?: string;
  host?: string;
  path?: string;
  body: string | Uint8Array;
  /** Keys allowed to sign (the origin's `directory.keys[].public_key`). Omit to skip the lookup. */
  keys?: readonly string[];
  /** Unix seconds; defaults to now. */
  now?: number;
  maxSkewSeconds?: number;
}

export type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? value.join(', ') : value;
  }
  return undefined;
}

/**
 * Runs the stateless ping checks in the gateway's order: headers well formed, key listed (when `keys` is
 * given), timestamp skew, Content-Digest, signature. Nonce replay and the instance status are the caller's.
 */
export function verifyPingHeaders(headers: HeaderSource, options: VerifyPingOptions): PingVerification {
  const fail = (code: PingVerificationCode, detail: string): PingVerification => ({
    ok: false,
    code,
    detail,
  });
  const keyId = header(headers, 'Gotalk-Key-Id');
  const timestampRaw = header(headers, 'Gotalk-Timestamp');
  const nonce = header(headers, 'Gotalk-Nonce');
  const signature = header(headers, 'Gotalk-Signature');
  const digest = header(headers, 'Content-Digest');

  if (!keyId || !/^[A-Za-z0-9_-]{43}$/.test(keyId))
    return fail('invalid_signature', 'malformed Gotalk-Key-Id');
  if (!timestampRaw || !/^\d{1,12}$/.test(timestampRaw)) {
    return fail('invalid_signature', 'malformed Gotalk-Timestamp');
  }
  if (!nonce || !base64urlPattern.test(nonce)) return fail('invalid_signature', 'malformed Gotalk-Nonce');
  const nonceLength = Buffer.from(nonce, 'base64url').length;
  if (nonceLength < 16 || nonceLength > 32)
    return fail('invalid_signature', 'Gotalk-Nonce must be 16 to 32 bytes');
  if (!signature || !base64urlPattern.test(signature)) {
    return fail('invalid_signature', 'malformed Gotalk-Signature');
  }
  if (options.keys && !options.keys.includes(keyId))
    return fail('unknown_key', 'key is not in directory.keys');

  const timestamp = Number(timestampRaw);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.maxSkewSeconds ?? maxTimestampSkewSeconds)) {
    return fail('stale_timestamp', 'Gotalk-Timestamp is outside the allowed skew');
  }
  if (digest !== undefined && digest !== contentDigest(options.body)) {
    return fail('invalid_signature', 'Content-Digest does not match the body');
  }
  const req: SignedRequestParts = {
    method: options.method ?? 'POST',
    host: options.host ?? pingHost,
    path: options.path ?? pingPath,
    timestamp: timestampRaw,
    nonce,
    keyId,
    body: options.body,
  };
  if (!verify(keyId, req, signature)) return fail('invalid_signature', 'signature does not verify');
  return { ok: true, keyId, nonce, timestamp };
}
