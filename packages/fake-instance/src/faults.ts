/**
 * Failure modes for the fake instance, selected per route or globally. All are deterministic: the same fault
 * on the same request gives the same bytes.
 */
export type Fault =
  | {
      kind: 'slow';
      /** Wait before sending headers. Default 0. */
      delayMs?: number;
      /** When set, send the body in chunks of `chunkBytes` (default 64) every `intervalMs`. */
      intervalMs?: number;
      chunkBytes?: number;
    }
  | {
      kind: 'huge';
      /** Body size in bytes; default 6 MiB, over the indexer's 5 MiB cap. The document stays valid JSON. */
      bytes?: number;
      /** Leave out Content-Length so the size is only discovered while reading. Default false. */
      chunked?: boolean;
    }
  | {
      kind: 'wrong-content-type';
      /** Default `text/html; charset=utf-8`. */
      contentType?: string;
      /** Send the real JSON body under the wrong type instead of an HTML page. Default false. */
      keepBody?: boolean;
    }
  | { kind: 'invalid-json' }
  | {
      kind: 'schema-violation';
      /**
       * `author-email` (default) adds an email to the first author, falling back to `missing-field` when the
       * document has no author. `missing-field` removes a required field. `wrong-type` changes a field's type.
       */
      variant?: 'author-email' | 'missing-field' | 'wrong-type';
      /** In-process only: a custom change to the parsed document. */
      mutate?: (doc: unknown) => unknown;
    }
  | {
      kind: 'redirect';
      /** Default `https://elsewhere.example` plus the request path and query. */
      location?: string;
      status?: 301 | 302 | 303 | 307 | 308;
    }
  | {
      kind: 'status';
      status: number;
      /** Sets `Retry-After` (seconds or an HTTP date). For 429 and 503 it defaults to 30. */
      retryAfter?: number | string;
    }
  | {
      kind: 'hang';
      /** Send the headers (and the first bytes of the body) before hanging. Default false: nothing is sent. */
      afterHeaders?: boolean;
    };

export type FaultKind = Fault['kind'];

/** A fault plus how many more requests it applies to (undefined: until cleared). */
export interface FaultRule {
  fault: Fault;
  times?: number;
}

/**
 * Faults by route. A route is an exact path (`/api/v1/index/places`), a prefix ending in `*`
 * (`/api/v1/index/topics/*`), or `*` for every route. The most specific match wins.
 */
export class FaultTable {
  private readonly rules = new Map<string, FaultRule>();

  set(route: string, fault: Fault | null, options: { times?: number } = {}): void {
    if (fault === null) this.rules.delete(route);
    else this.rules.set(route, { fault, ...(options.times === undefined ? {} : { times: options.times }) });
  }

  clear(): void {
    this.rules.clear();
  }

  entries(): [string, FaultRule][] {
    return [...this.rules.entries()];
  }

  /** The fault for a request path, counting down `times`. */
  take(path: string): Fault | undefined {
    let best: [string, FaultRule] | undefined;
    let bestScore = -1;
    for (const entry of this.rules) {
      const [route] = entry;
      let score = -1;
      if (route === path) score = Number.MAX_SAFE_INTEGER;
      else if (route === '*') score = 0;
      else if (route.endsWith('*') && path.startsWith(route.slice(0, -1))) score = route.length;
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    if (!best) return undefined;
    const [route, rule] = best;
    if (rule.times !== undefined) {
      rule.times -= 1;
      if (rule.times <= 0) this.rules.delete(route);
    }
    return rule.fault;
  }
}

function findAuthor(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAuthor(item);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.author && typeof record.author === 'object') return record.author as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const found = findAuthor(record[key]);
      if (found) return found;
    }
  }
  return undefined;
}

function firstListItem(doc: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['items', 'events', 'posts']) {
    const list = doc[key];
    if (Array.isArray(list) && list[0] && typeof list[0] === 'object')
      return list[0] as Record<string, unknown>;
  }
  return undefined;
}

/** Breaks a parsed document so it no longer matches its schema. */
export function violateSchema(
  doc: unknown,
  variant: 'author-email' | 'missing-field' | 'wrong-type',
): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { unexpected: doc };
  const record = doc as Record<string, unknown>;
  if (variant === 'author-email') {
    const author = findAuthor(record);
    if (author) {
      author.email = `${String(author.username)}@example.com`;
      return record;
    }
    return violateSchema(record, 'missing-field');
  }
  const directory = record.directory as Record<string, unknown> | undefined;
  const item = firstListItem(record);
  if (variant === 'missing-field') {
    if (directory) delete directory.listed;
    else if (item) delete item['seq' in item ? 'seq' : 'id'];
    else if ('next_cursor' in record && 'events' in record) delete record.next_cursor;
    else if ('items' in record) delete record.items;
    else if ('events' in record) delete record.events;
    else delete record[Object.keys(record)[0] ?? 'id'];
    return record;
  }
  if (directory) directory.listed = 'yes';
  else if (item) item['seq' in item ? 'seq' : 'id'] = 'seq' in item ? String(item.seq) : 12345;
  else if ('items' in record) record.items = {};
  else if ('events' in record) record.events = 'none';
  else if ('has_more' in record) record.has_more = 'no';
  else record.id = 12345;
  return record;
}

export function hugeBody(body: string, bytes: number): string {
  const doc = JSON.parse(body) as Record<string, unknown>;
  const base = JSON.stringify({ ...doc, padding: '' });
  return JSON.stringify({ ...doc, padding: 'x'.repeat(Math.max(0, bytes - Buffer.byteLength(base) + 1)) });
}

export function invalidJson(body: string): string {
  return body.slice(0, Math.max(1, Math.floor(body.length / 2)));
}

export const htmlPage =
  '<!doctype html>\n<html><head><title>Maintenance</title></head><body><h1>Back soon</h1></body></html>\n';
