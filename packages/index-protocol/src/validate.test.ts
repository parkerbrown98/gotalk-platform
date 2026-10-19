import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fixturesDir, loadManifest, readFixture } from './fixtures.ts';
import type { SchemaName } from './types.ts';
import {
  assertValid,
  formatErrors,
  loadSchemas,
  schemaId,
  SchemaValidationError,
  validate,
} from './validate.ts';

const clone = <T>(value: T): T => structuredClone(value);
const manifest = loadManifest();

function expectValid(schema: SchemaName, doc: unknown) {
  const result = validate(schema, doc);
  expect(result.valid, formatErrors(result.errors)).toBe(true);
}

function expectInvalid(schema: SchemaName, doc: unknown, path?: string) {
  const result = validate(schema, doc);
  expect(result.valid).toBe(false);
  if (path) expect(result.errors.map((e) => e.instancePath)).toContain(path);
}

describe('schemas', () => {
  it('have stable $ids that match their file names', () => {
    for (const [name, schema] of loadSchemas()) {
      expect(schema.$id).toBe(schemaId(name));
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });
});

describe('fixtures', () => {
  it('lists every file in fixtures/ in the manifest', () => {
    const listed = [
      ...manifest.fixtures.map((f) => f.file),
      ...manifest.vectors.map((v) => v.file),
      'manifest.json',
    ];
    expect(readdirSync(fixturesDir).sort()).toEqual([...new Set(listed)].sort());
  });

  it.each(manifest.fixtures.map((f) => [f.file, f] as const))('%s validates', (_file, entry) => {
    const doc = readFixture(entry.file);
    expectValid(entry.schema, doc);
    if (entry.schema === 'problem') {
      const problem = doc as { status: number; type: string; code: string };
      expect(problem.status).toBe(entry.status);
      expect(problem.type).toBe(`https://gotalk.sh/problems/${problem.code}`);
    }
  });

  it('cover the edge cases the protocol names', () => {
    const files = manifest.fixtures.map((f) => f.file);
    for (const file of [
      'places-page-nsfw-skipped.json',
      'topic-opening-post-excluded.json',
      'changes-board-moved.json',
      'changes-cursor-expired.json',
      'changes-page-coalesced.json',
    ]) {
      expect(files).toContain(file);
    }
    const coalesced = readFixture<{ events: { seq: number }[] }>('changes-page-coalesced.json').events;
    const seqs = coalesced.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.some((seq, i) => i > 0 && seq !== seqs[i - 1]! + 1)).toBe(true);
  });

  it('keep the summary on every page of a topic and leave gaps in post numbers', () => {
    const page1 = readFixture<Record<string, unknown> & { posts: { number: number }[] }>('topic-page-1.json');
    const page2 = readFixture<Record<string, unknown> & { posts: { number: number }[] }>('topic-page-2.json');
    const summary = (page: Record<string, unknown>) => {
      const rest = { ...page };
      delete rest.posts;
      delete rest.next_cursor;
      return rest;
    };
    expect(summary(page2)).toEqual(summary(page1));
    expect(page1.next_cursor).toEqual(expect.any(String));
    expect(page2.next_cursor).toBeNull();
    expect([...page1.posts, ...page2.posts].map((p) => p.number)).toEqual([1, 2, 3, 5, 6]);
  });
});

describe('validation', () => {
  const places = readFixture<{ items: Record<string, unknown>[] }>('places-page.json');
  const topics = readFixture<{ items: Record<string, unknown>[] }>('board-topics-page-1.json');
  const topic = readFixture<Record<string, unknown> & { posts: Record<string, unknown>[] }>(
    'topic-page-1.json',
  );
  const changes = readFixture<{ events: Record<string, unknown>[] }>('changes-page.json');
  const wellKnown = readFixture<{ directory: Record<string, unknown> }>('well-known-listed.json');

  it('rejects authors with anything beyond id, username and display_name', () => {
    const doc = clone(topics);
    (doc.items[0]!.author as Record<string, unknown>).email = 'ferris@example.com';
    expectInvalid('board-topics-page', doc, '/items/0/author');

    const withAvatar = clone(topic);
    (withAvatar.posts[1]!.author as Record<string, unknown>).avatar_url = 'https://forum.example/a.png';
    expectInvalid('topic', withAvatar, '/posts/1/author');
  });

  it('rejects a known event type without its IDs', () => {
    for (const [type, missing] of [
      ['place.delete', 'place_id'],
      ['board.upsert', 'board_id'],
      ['topic.delete', 'topic_id'],
      ['topic.upsert', 'board_id'],
      ['user.exclude', 'user_id'],
    ] as const) {
      const doc = clone(changes);
      const event = doc.events.find((e) => e.type === type) ?? { ...doc.events[2]!, type };
      delete event[missing];
      doc.events = [event];
      expectInvalid('changes-page', doc, '/events/0');
    }
  });

  it('accepts unknown event types and unknown fields', () => {
    const doc = clone(changes) as Record<string, unknown> & { events: Record<string, unknown>[] };
    doc.events.push({ seq: 99999, type: 'board.archive', at: '2026-10-18T10:00:00Z', extra: { a: 1 } });
    doc.events.push({ seq: 100000, type: 'something.new', at: '2026-10-18T10:00:00Z' });
    doc.future_field = true;
    expectValid('changes-page', doc);

    const placesDoc = clone(places);
    placesDoc.items[0]!.banner_url = 'https://forum.example/banner.png';
    (placesDoc.items[0]!.boards as Record<string, unknown>[])[0]!.emoji = '🦀';
    expectValid('places-page', placesDoc);
  });

  it('rejects null where a value is required, and accepts null where it is allowed', () => {
    for (const field of ['name', 'description', 'member_count', 'tags', 'updated_at', 'boards', 'slug']) {
      const doc = clone(places);
      doc.items[0]![field] = null;
      expectInvalid('places-page', doc, `/items/0/${field}`);
    }
    const nullable = clone(places);
    nullable.items[0]!.icon_url = null;
    expectValid('places-page', nullable);

    const missing = clone(places);
    delete missing.items[0]!.icon_url;
    expectInvalid('places-page', missing, '/items/0');
  });

  it('checks types and formats', () => {
    const negative = clone(places);
    negative.items[0]!.member_count = -1;
    expectInvalid('places-page', negative);

    const fractional = clone(topics);
    fractional.items[0]!.reply_count = 1.5;
    expectInvalid('board-topics-page', fractional);

    const offset = clone(topics);
    offset.items[0]!.updated_at = '2026-10-17T20:11:00+02:00';
    expectInvalid('board-topics-page', offset);

    const notADate = clone(topics);
    notADate.items[0]!.created_at = 'yesterday';
    expectInvalid('board-topics-page', notADate);

    const kind = clone(places);
    (kind.items[0]!.boards as Record<string, unknown>[])[0]!.kind = 'forum';
    expectInvalid('places-page', kind);

    const zero = clone(topic);
    zero.posts[0]!.number = 0;
    expectInvalid('topic', zero);
  });

  it('requires author on a topic summary but not on a topic page', () => {
    const summary = clone(topics);
    delete summary.items[0]!.author;
    expectInvalid('board-topics-page', summary, '/items/0');

    const page = clone(topic);
    delete page.author;
    expectValid('topic', page);
    delete page.board_id;
    expectInvalid('topic', page);
  });

  it('requires a non-null next_cursor in the change feed', () => {
    const doc = clone(changes) as Record<string, unknown>;
    doc.next_cursor = null;
    expectInvalid('changes-page', doc, '/next_cursor');
    delete doc.next_cursor;
    expectInvalid('changes-page', doc);
  });

  it('checks problems', () => {
    expectValid('problem', { type: 'https://gotalk.sh/problems/not_found', title: 'Not Found', status: 404 });
    expectInvalid('problem', { type: 'https://gotalk.sh/problems/not_found', title: 'Not Found' });
    expectInvalid('problem', { type: 'about:blank', title: 'Not Found', status: '404' });
  });

  it('checks the directory block', () => {
    expectValid('directory', wellKnown.directory);
    expectValid('directory', { listed: false, protocol: 1, index_url: 'https://forum.example/api/v1/index' });
    expectInvalid('directory', { protocol: 1, index_url: 'https://forum.example/api/v1/index' });
    expectInvalid('directory', { ...wellKnown.directory, protocol: 0 });
    expectInvalid('directory', { ...wellKnown.directory, index_url: 'not a url' });
    expectInvalid('directory', { ...wellKnown.directory, contact_email: 'nobody' });
    expectInvalid('directory', {
      ...wellKnown.directory,
      keys: [{ alg: 'RSA', public_key: 'x'.repeat(43) }],
    });
    expectInvalid('directory', {
      ...wellKnown.directory,
      keys: [{ alg: 'Ed25519', public_key: 'too-short' }],
    });
    expectInvalid('well-known', { ...wellKnown, directory: { listed: 'yes' } });
  });

  it('accepts only the origin in ping and registration requests', () => {
    expectValid('ping-request', { origin: 'https://forum.example' });
    expectValid('registration-request', { origin: 'http://localhost:8080' });
    expectInvalid('ping-request', { origin: 'https://forum.example', events: [] });
    expectInvalid('ping-request', { origin: 'https://forum.example/path' });
    expectInvalid('registration-request', {});
    expectInvalid('registration-response', { origin: 'https://forum.example', status: 'approved' });
  });

  it('assertValid throws a readable error', () => {
    const doc = clone(topics);
    (doc.items[0]!.author as Record<string, unknown>).email = 'ferris@example.com';
    expect(() => assertValid('board-topics-page', doc)).toThrow(SchemaValidationError);
    expect(() => assertValid('board-topics-page', doc)).toThrow(/\/items\/0\/author .*\(email\)/);
    expect(() => assertValid('board-topics-page', topics)).not.toThrow();
  });
});
