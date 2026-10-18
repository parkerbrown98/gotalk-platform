import type { APIRoute } from 'astro';

import { releaseSettings, releaseStore } from '../../../lib/releases/index.ts';
import { releaseActions, verifySignature } from '../../../lib/releases/webhook.ts';

// GitHub release webhook (docs/deployment.md#release-webhook). Rendered on demand: it refreshes the
// in-memory release cache so /download, /self-host and /changelog change within a CDN cache lifetime.
export const prerender = false;

const MAX_BODY = 1024 * 1024;
// GitHub's API can lag a moment behind the event, so a second refresh follows the first.
const FOLLOW_UP_MS = 30_000;

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length')) > MAX_BODY) return null;
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const POST: APIRoute = async ({ request }) => {
  const secret = releaseSettings().webhookSecret;
  if (!secret) return json(404, { error: 'The release webhook is not configured on this server.' });

  const body = await readBody(request);
  if (!body) return json(413, { error: 'Payload too large.' });
  if (!verifySignature(secret, body, request.headers.get('x-hub-signature-256'))) {
    return json(401, { error: 'Missing or invalid X-Hub-Signature-256.' });
  }

  const event = request.headers.get('x-github-event');
  if (event === 'ping') return json(200, { ok: true });
  if (event !== 'release') return json(202, { ignored: `event ${event ?? '(none)'}` });

  let payload: { action?: string; repository?: { full_name?: string } };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json(400, { error: 'The body is not JSON. Set the webhook content type to application/json.' });
  }
  const store = releaseStore();
  const key = store.keyFor(payload.repository?.full_name ?? '');
  if (!key) return json(202, { ignored: `repository ${payload.repository?.full_name ?? '(none)'}` });
  if (!releaseActions.has(payload.action ?? ''))
    return json(202, { ignored: `action ${payload.action ?? '(none)'}` });

  void store.refresh(key, { force: true });
  setTimeout(() => void store.refresh(key, { force: true }), FOLLOW_UP_MS).unref();
  return json(202, { refreshing: key });
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
