import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { publicKeyFromSeed, type PrivateKeyInput, type WellKnown } from '@gotalk-platform/index-protocol';

import { FaultTable, hugeBody, htmlPage, invalidJson, violateSchema, type Fault } from './faults.ts';
import { ping, type PingOptions, type PingResult } from './ping.ts';
import { FakeState, ReadError, type StateOptions } from './state.ts';

/** The default signing seed: bytes 00 01 … 1f, the seed of the protocol's signing vector. */
export const defaultSeed = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

export const indexPath = '/api/v1/index';

export interface FakeInstanceOptions extends StateOptions {
  /** Default 127.0.0.1. */
  host?: string;
  /** Default 0 (a free port). */
  port?: number;
  /** The origin to advertise, when it differs from the listening address (behind a proxy, for example). */
  publicOrigin?: string;
  /** The Ed25519 seed whose public key is advertised in `directory.keys` and signs pings. */
  seed?: PrivateKeyInput;
  /** Advertise no ping key. */
  noKeys?: boolean;
  contactEmail?: string;
  /** Serve `/__fake/*` control routes so another process can drive mutations and faults. Default false. */
  control?: boolean;
  name?: string;
  description?: string;
  iconUrl?: string | null;
  version?: string;
  /** The well-known `gateway_url` (the instance's real-time WebSocket). Default `ws(s)://{origin}/api/v1/gateway`. */
  gatewayUrl?: string;
}

export interface RequestRecord {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  at: Date;
}

/** Mutation methods of FakeState, exposed on the instance and to the `/__fake/call` control route. */
export const mutationMethods = [
  'addUser',
  'addTopic',
  'editTopic',
  'deleteTopic',
  'moveTopic',
  'addPost',
  'editPost',
  'deletePost',
  'setPostHidden',
  'excludeUser',
  'includeUser',
  'setPlace',
  'setPlaceIndexable',
  'setPlaceVisibility',
  'setBoard',
  'moveBoard',
  'setListed',
  'expireBefore',
  'pruneHistory',
  'emit',
] as const;

export type MutationMethod = (typeof mutationMethods)[number];
type Mutations = { [K in MutationMethod]: FakeState[K] };

export interface FakeInstance extends Mutations {
  /** The listening URL, for example `http://127.0.0.1:53124`. */
  url: string;
  /** The advertised origin (equal to `url` unless `publicOrigin` is set). */
  origin: string;
  /** `${origin}/api/v1/index`. */
  indexUrl: string;
  wellKnownUrl: string;
  /** The advertised ping key (unpadded base64url). */
  publicKey: string;
  state: FakeState;
  faults: FaultTable;
  /** Every request received, in order. */
  requests: RequestRecord[];
  /** The most requests that were in flight at once. */
  readonly maxConcurrent: number;
  /** Sets (or with null, clears) a fault for a route: an exact path, a prefix ending in `*`, or `*`. */
  setFault(route: string, fault: Fault | null, options?: { times?: number }): void;
  clearFaults(): void;
  wellKnown(): WellKnown;
  /** Sends a signed ping for this instance to `${platformUrl}/api/index/v1/ping`. */
  ping(platformUrl: string, options?: Omit<PingOptions, 'seed' | 'origin'>): Promise<PingResult>;
  close(): Promise<void>;
}

interface Reply {
  status: number;
  body: string;
  contentType: string;
  headers?: Record<string, string>;
  /** Index and discovery documents get an ETag and answer If-None-Match. */
  cacheable?: boolean;
}

const json = (body: unknown, status = 200): Reply => ({
  status,
  body: JSON.stringify(body),
  contentType: 'application/json',
  cacheable: status === 200,
});

const problemTitles: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const problemCodes: Record<number, string> = {
  400: 'invalid_parameter',
  404: 'not_found',
  405: 'method_not_allowed',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'unavailable',
};

export function problem(status: number, code: string, detail?: string): Reply {
  return {
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: `https://gotalk.sh/problems/${code}`,
      title: problemTitles[status] ?? 'Error',
      status,
      ...(detail === undefined ? {} : { detail }),
      code,
    }),
  };
}

/** A strong ETag over the body bytes. */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === etag);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ReadError(413, 'too_large', 'Body too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Starts a fake Gotalk instance serving the instance side of the index protocol. */
export async function createFakeInstance(options: FakeInstanceOptions = {}): Promise<FakeInstance> {
  const state = new FakeState(options);
  const faults = new FaultTable();
  const requests: RequestRecord[] = [];
  const seed = options.seed ?? defaultSeed;
  const publicKey = publicKeyFromSeed(seed);
  const sockets = new Set<Socket>();
  const hanging = new Set<ServerResponse>();
  let inFlight = 0;
  let maxConcurrent = 0;
  let origin = '';

  const wellKnown = (): WellKnown => {
    const doc: WellKnown = {
      software: 'gotalk',
      version: options.version ?? '1.4.0',
      instance_url: origin,
      api_base_url: `${origin}/api/v1`,
      api_versions: ['v1'],
      instance_info_url: `${origin}/api/v1/instance`,
      gateway_url: options.gatewayUrl ?? `${origin.replace(/^http/, 'ws')}/api/v1/gateway`,
    };
    if (!state.directory.omit) {
      doc.directory = {
        listed: state.directory.listed,
        protocol: 1,
        index_url: `${origin}${indexPath}`,
        ...(options.contactEmail === undefined ? {} : { contact_email: options.contactEmail }),
        ...(options.noKeys ? {} : { keys: [{ alg: 'Ed25519' as const, public_key: publicKey }] }),
      };
    }
    return doc;
  };

  const route = (method: string, url: URL): Reply => {
    if (method !== 'GET' && method !== 'HEAD')
      return problem(405, 'method_not_allowed', 'Only GET is supported.');
    const path = url.pathname;
    const params = {
      cursor: url.searchParams.get('cursor'),
      limit: url.searchParams.get('limit'),
      updated_since: url.searchParams.get('updated_since'),
    };
    if (path === '/.well-known/gotalk-instance') return json(wellKnown());
    if (path === '/api/v1/instance') {
      const counts = state.counts();
      return json({
        name: options.name ?? 'Forum Example',
        description: options.description ?? 'A fake Gotalk instance for index protocol tests.',
        icon_url: options.iconUrl === undefined ? `${origin}/media/instance/icon.png` : options.iconUrl,
        url: origin,
        software: {
          name: 'gotalk',
          version: options.version ?? '1.4.0',
          repository: 'https://github.com/parkerbrown98/gotalk-server',
        },
        directory: { listed: state.directory.listed && !state.directory.omit, places_indexed: counts.places },
      });
    }
    if (path === `${indexPath}/places`) return json(state.readPlaces(params));
    if (path === `${indexPath}/changes`) return json(state.readChanges(params));
    const boardTopics = path.match(new RegExp(`^${indexPath}/boards/([^/]+)/topics$`));
    if (boardTopics?.[1]) return json(state.readBoardTopics(decodeURIComponent(boardTopics[1]), params));
    const topic = path.match(new RegExp(`^${indexPath}/topics/([^/]+)$`));
    if (topic?.[1]) return json(state.readTopic(decodeURIComponent(topic[1]), params));
    return problem(404, 'not_found', 'No such resource.');
  };

  const control = async (req: IncomingMessage, url: URL): Promise<Reply> => {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/__fake/state') {
      return json({
        origin,
        last_seq: state.lastSeq,
        history_start: state.historyStart,
        directory: state.directory,
        coalesce: state.coalesce,
        events: state.events,
        faults: faults.entries().map(([route, rule]) => ({ route, ...rule })),
        requests: requests.length,
        max_concurrent: maxConcurrent,
      });
    }
    if (req.method === 'POST' && path === '/__fake/call') {
      const { method, args } = JSON.parse(await readBody(req)) as { method: string; args?: unknown[] };
      if (!(mutationMethods as readonly string[]).includes(method)) {
        return problem(400, 'invalid_parameter', `Unknown method ${method}.`);
      }
      const fn = state[method as MutationMethod] as (...a: unknown[]) => unknown;
      return json({ result: fn.apply(state, args ?? []) ?? null });
    }
    if (req.method === 'POST' && path === '/__fake/faults') {
      const { route, fault, times } = JSON.parse(await readBody(req)) as {
        route: string;
        fault: Fault | null;
        times?: number;
      };
      faults.set(route, fault, times === undefined ? {} : { times });
      return json({ ok: true });
    }
    if (req.method === 'DELETE' && path === '/__fake/faults') {
      faults.clear();
      return json({ ok: true });
    }
    return problem(404, 'not_found', 'No such control route.');
  };

  const send = async (req: IncomingMessage, res: ServerResponse, reply: Reply, fault?: Fault) => {
    let body = reply.body;
    let contentType = reply.contentType;
    const headers: Record<string, string> = { 'Cache-Control': 'no-cache', ...reply.headers };
    let declareLength = true;

    if (fault && reply.status === 200) {
      switch (fault.kind) {
        case 'huge':
          body = hugeBody(body, fault.bytes ?? 6 * 1024 * 1024);
          declareLength = !fault.chunked;
          break;
        case 'wrong-content-type':
          contentType = fault.contentType ?? 'text/html; charset=utf-8';
          if (!fault.keepBody) body = htmlPage;
          break;
        case 'invalid-json':
          body = invalidJson(body);
          break;
        case 'schema-violation': {
          const doc = JSON.parse(body) as unknown;
          body = JSON.stringify(
            fault.mutate ? fault.mutate(doc) : violateSchema(doc, fault.variant ?? 'author-email'),
          );
          break;
        }
        default:
          break;
      }
    }

    if (reply.cacheable && (!fault || fault.kind === 'slow')) {
      const etag = etagOf(body);
      headers.ETag = etag;
      if (matchesEtag(req.headers['if-none-match'], etag)) {
        if (fault?.kind === 'slow' && fault.delayMs) await sleep(fault.delayMs);
        res.writeHead(304, headers).end();
        return;
      }
    }

    headers['Content-Type'] = contentType;
    const bytes = Buffer.from(body, 'utf8');
    if (declareLength) headers['Content-Length'] = String(bytes.length);
    const withBody = req.method !== 'HEAD';

    if (fault?.kind === 'slow') {
      if (fault.delayMs) await sleep(fault.delayMs);
      if (res.destroyed) return;
      res.writeHead(reply.status, headers);
      if (!withBody) return void res.end();
      if (fault.intervalMs === undefined) return void res.end(bytes);
      const size = Math.max(1, fault.chunkBytes ?? 64);
      for (let offset = 0; offset < bytes.length; offset += size) {
        if (res.destroyed) return;
        res.write(bytes.subarray(offset, offset + size));
        if (offset + size < bytes.length) await sleep(fault.intervalMs);
      }
      res.end();
      return;
    }

    res.writeHead(reply.status, headers);
    if (!withBody) return void res.end();
    if (bytes.length > 1024 * 1024) {
      // Write big bodies in pieces so a reader that stops early is not sent everything at once.
      for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
        if (res.destroyed) return;
        if (!res.write(bytes.subarray(offset, offset + 256 * 1024))) {
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.on('drain', done);
            res.on('close', done);
          });
        }
      }
      res.end();
      return;
    }
    res.end(bytes);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    requests.push({
      method: req.method ?? 'GET',
      url: url.pathname + url.search,
      headers: req.headers,
      at: new Date(),
    });

    if (url.pathname.startsWith('/__fake/')) {
      if (!options.control) return send(req, res, problem(404, 'not_found', 'No such resource.'));
      try {
        return await send(req, res, await control(req, url));
      } catch (error) {
        return send(req, res, problem(400, 'invalid_parameter', (error as Error).message));
      }
    }

    const fault = faults.take(url.pathname);
    if (fault?.kind === 'hang') {
      hanging.add(res);
      res.on('close', () => hanging.delete(res));
      if (fault.afterHeaders) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.write('{"items":[');
      }
      return;
    }
    if (fault?.kind === 'redirect') {
      const location = fault.location ?? `https://elsewhere.example${url.pathname}${url.search}`;
      res.writeHead(fault.status ?? 302, { Location: location, 'Cache-Control': 'no-cache' }).end();
      return;
    }
    if (fault?.kind === 'status') {
      const reply = problem(fault.status, problemCodes[fault.status] ?? 'error', 'Injected failure.');
      const retryAfter = fault.retryAfter ?? (fault.status === 429 || fault.status === 503 ? 30 : undefined);
      if (retryAfter !== undefined) reply.headers = { 'Retry-After': String(retryAfter) };
      return send(req, res, reply);
    }

    let reply: Reply;
    try {
      reply = route(req.method ?? 'GET', url);
    } catch (error) {
      if (!(error instanceof ReadError)) throw error;
      reply = problem(error.status, error.code, error.message);
    }
    await send(req, res, reply, fault);
  };

  const server: Server = createServer((req, res) => {
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    let counted = true;
    const done = () => {
      if (counted) inFlight--;
      counted = false;
    };
    res.on('close', done);
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent)
        send(req, res, problem(500, 'internal_error', String(error))).catch(() => res.destroy());
      else res.destroy();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const url = `http://${host}:${address.port}`;
  origin = (options.publicOrigin ?? url).replace(/\/+$/, '');

  const mutations = Object.fromEntries(
    mutationMethods.map((name) => [name, (state[name] as (...a: unknown[]) => unknown).bind(state)]),
  ) as unknown as Mutations;

  return {
    ...mutations,
    url,
    origin,
    indexUrl: `${origin}${indexPath}`,
    wellKnownUrl: `${origin}/.well-known/gotalk-instance`,
    publicKey,
    state,
    faults,
    requests,
    get maxConcurrent() {
      return maxConcurrent;
    },
    setFault: (route, fault, opts) => faults.set(route, fault, opts),
    clearFaults: () => faults.clear(),
    wellKnown,
    ping: (platformUrl, opts = {}) => ping(platformUrl, { ...opts, seed, origin }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const res of hanging) res.destroy();
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
