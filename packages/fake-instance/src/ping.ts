import {
  pingPath,
  signPingHeaders,
  type PingHeaders,
  type PrivateKeyInput,
} from '@gotalk-platform/index-protocol';

export interface PingOptions {
  /** The instance's Ed25519 seed or private key; its public key must be in the origin's `directory.keys`. */
  seed: PrivateKeyInput;
  /** The instance origin sent in the body, for example `https://forum.example`. */
  origin: string;
  /** Signing time, as a Date or unix seconds. Defaults to now. */
  now?: Date | number;
  /** Unpadded base64url; defaults to 16 random bytes. */
  nonce?: string;
  /** Signs for this host instead of the platform URL's host (the production value is `gotalk.sh`). */
  signHost?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface PingResult {
  status: number;
  headers: Headers;
  body: string;
  /** What was sent. */
  request: { url: string; headers: PingHeaders & { 'Content-Type': string }; body: string };
}

/** POSTs a signed ping (GOTALK-INDEX-SIG-V1) to `${platformUrl}/api/index/v1/ping`. */
export async function ping(platformUrl: string, options: PingOptions): Promise<PingResult> {
  const base = new URL(platformUrl);
  const path = `${base.pathname.replace(/\/+$/, '')}${pingPath}`;
  const url = new URL(path, base).toString();
  const body = JSON.stringify({ origin: options.origin });
  const timestamp =
    options.now === undefined
      ? undefined
      : typeof options.now === 'number'
        ? Math.floor(options.now)
        : Math.floor(options.now.getTime() / 1000);
  const headers = {
    'Content-Type': 'application/json',
    ...signPingHeaders({
      seed: options.seed,
      body,
      host: options.signHost ?? base.host,
      path,
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    }),
  };
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
    request: { url, headers, body },
  };
}
