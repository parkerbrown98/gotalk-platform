import {
  readFixture,
  type BoardTopicsPage,
  type ChangesPage,
  type PlacesPage,
  type Topic,
  type WellKnown,
} from '@gotalk-platform/index-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fixtureIds as ids, hiddenIds } from './dataset.ts';
import { createFakeInstance, type FakeInstance } from './server.ts';
import { get, getDoc, getProblem } from './test-helpers.ts';

const withoutComment = (doc: unknown) => {
  const rest = { ...(doc as Record<string, unknown>) };
  delete rest.$comment;
  return rest;
};

let fake: FakeInstance;
beforeAll(async () => {
  fake = await createFakeInstance({
    publicOrigin: 'https://forum.example',
    contactEmail: 'ops@forum.example',
  });
});
afterAll(() => fake.close());

describe('discovery', () => {
  it('serves the listed well-known fixture for its origin', async () => {
    const doc = await getDoc<WellKnown>(fake, '/.well-known/gotalk-instance');
    expect(doc).toEqual(readFixture('well-known-listed.json'));
    expect(doc.directory?.index_url).toBe(fake.indexUrl);
    expect(doc.directory?.keys?.[0]?.public_key).toBe(fake.publicKey);
  });

  it('serves instance metadata', async () => {
    const res = await get<{ name: string; software: { name: string; version: string }; url: string }>(
      fake,
      '/api/v1/instance',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.json).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      icon_url: expect.any(String),
      url: 'https://forum.example',
      software: { name: 'gotalk', version: '1.4.0' },
      directory: { listed: true, places_indexed: 3 },
    });
  });

  it('advertises the listening URL by default', async () => {
    const local = await createFakeInstance({ noKeys: true });
    try {
      expect(local.origin).toBe(local.url);
      expect(local.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const doc = await getDoc<WellKnown>(local, '/.well-known/gotalk-instance');
      expect(doc.instance_url).toBe(local.url);
      expect(doc.directory).toEqual({ listed: true, protocol: 1, index_url: `${local.url}/api/v1/index` });
    } finally {
      await local.close();
    }
  });
});

describe('index reads match the fixtures', () => {
  it('GET /places', async () => {
    expect(await getDoc(fake, '/api/v1/index/places')).toEqual(
      withoutComment(readFixture('places-page.json')),
    );
  });

  it('GET /places?limit=2 skips the NSFW place', async () => {
    const page = await getDoc<PlacesPage>(fake, '/api/v1/index/places?limit=2');
    expect(page).toEqual(withoutComment(readFixture('places-page-nsfw-skipped.json')));
    expect(page.items.map((p) => p.id)).not.toContain(hiddenIds.afterDarkPlace);
  });

  it('GET /boards/{id}/topics, two pages', async () => {
    const path = `/api/v1/index/boards/${ids.beginners}/topics?limit=2`;
    const page1 = await getDoc<BoardTopicsPage>(fake, path);
    expect(page1).toEqual(withoutComment(readFixture('board-topics-page-1.json')));
    const page2 = await getDoc(fake, `${path}&cursor=${page1.next_cursor}`);
    expect(page2).toEqual(readFixture('board-topics-page-2.json'));
  });

  it('GET /topics/{id}, two pages with a gap in post numbers', async () => {
    const path = `/api/v1/index/topics/${ids.borrowTopic}?limit=3`;
    const page1 = await getDoc<Topic>(fake, path);
    expect(page1).toEqual(readFixture('topic-page-1.json'));
    expect(await getDoc(fake, `${path}&cursor=${page1.next_cursor}`)).toEqual(
      readFixture('topic-page-2.json'),
    );
  });

  it.each([
    ['topic-single-page.json', ids.linesTopic],
    ['topic-pinned-locked.json', ids.rulesTopic],
    ['topic-unsolved.json', ids.elisionTopic],
  ])('GET /topics/{id} for %s', async (file, id) => {
    expect(await getDoc(fake, `/api/v1/index/topics/${id}`)).toEqual(readFixture(file));
  });

  it('answers 404 for a topic whose opening post is excluded', async () => {
    const problem = await getProblem(fake, `/api/v1/index/topics/${hiddenIds.excludedTopic}`, 404);
    expect(problem).toEqual(withoutComment(readFixture('topic-opening-post-excluded.json')));
  });
});

describe('not indexable is not found', () => {
  it.each([
    ['NSFW place board', `/api/v1/index/boards/${hiddenIds.afterDarkBoard}/topics`],
    ['members-only board', `/api/v1/index/boards/${hiddenIds.moderatorsBoard}/topics`],
    ['opted-out board', `/api/v1/index/boards/${hiddenIds.offTopicBoard}/topics`],
    ['missing board', `/api/v1/index/boards/missing/topics`],
    ['deleted topic', `/api/v1/index/topics/${hiddenIds.deletedTopic}`],
    ['missing topic', `/api/v1/index/topics/01a00000-0000-7000-8000-000000000000`],
    ['unknown route', `/api/v1/index/users`],
  ])('%s', async (_name, path) => {
    const problem = await getProblem(fake, path, 404);
    expect(problem.code).toBe('not_found');
    expect(problem.type).toBe('https://gotalk.sh/problems/not_found');
  });

  it('never returns hidden objects anywhere', async () => {
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    const text = JSON.stringify(places);
    for (const id of [hiddenIds.afterDarkPlace, hiddenIds.moderatorsBoard, hiddenIds.offTopicBoard]) {
      expect(text).not.toContain(id);
    }
    for (const place of places.items) {
      for (const board of place.boards) {
        const topics = await getDoc<BoardTopicsPage>(fake, `/api/v1/index/boards/${board.id}/topics`);
        for (const summary of topics.items) {
          const topic = await getDoc<Topic>(fake, `/api/v1/index/topics/${summary.id}`);
          expect(topic.board_id).toBe(board.id);
          expect(topic.place_id).toBe(place.id);
          expect(JSON.stringify(topic)).not.toContain(hiddenIds.quietfox);
          expect(topic.reply_count).toBe(topic.posts.length - 1);
        }
      }
    }
  });
});

describe('pagination', () => {
  async function walk<T>(first: string, items: (page: T) => unknown[], next: (page: T) => string | null) {
    const out: unknown[] = [];
    let page = await getDoc<T>(fake, first);
    out.push(...items(page));
    for (let cursor = next(page); cursor; cursor = next(page)) {
      page = await getDoc<T>(fake, `${first}${first.includes('?') ? '&' : '?'}cursor=${cursor}`);
      out.push(...items(page));
    }
    return out;
  }

  it('round-trips places one at a time', async () => {
    const all = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    const walked = await walk<PlacesPage>(
      '/api/v1/index/places?limit=1',
      (p) => p.items,
      (p) => p.next_cursor,
    );
    expect(walked).toEqual(all.items);
  });

  it('round-trips topics and posts one at a time', async () => {
    const all = await getDoc<BoardTopicsPage>(fake, `/api/v1/index/boards/${ids.beginners}/topics`);
    expect(all.next_cursor).toBeNull();
    const walked = await walk<BoardTopicsPage>(
      `/api/v1/index/boards/${ids.beginners}/topics?limit=1`,
      (p) => p.items,
      (p) => p.next_cursor,
    );
    expect(walked).toEqual(all.items);

    const topic = await getDoc<Topic>(fake, `/api/v1/index/topics/${ids.borrowTopic}`);
    const posts = await walk<Topic>(
      `/api/v1/index/topics/${ids.borrowTopic}?limit=1`,
      (p) => p.posts,
      (p) => p.next_cursor,
    );
    expect(posts).toEqual(topic.posts);
  });

  it('round-trips the change feed', async () => {
    const all = await getDoc<ChangesPage>(fake, '/api/v1/index/changes');
    expect(all.has_more).toBe(false);
    expect(all.events.length).toBeGreaterThan(5);
    const walked = await walk<ChangesPage>(
      '/api/v1/index/changes?limit=2',
      (p) => p.events,
      (p) => (p.has_more ? p.next_cursor : null),
    );
    expect(walked).toEqual(all.events);
    const seqs = all.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('filters by updated_since and keeps the filter in the cursor', async () => {
    const path = `/api/v1/index/boards/${ids.beginners}/topics?updated_since=2026-10-15T07:58:00Z`;
    const page = await getDoc<BoardTopicsPage>(fake, path);
    expect(page.items.map((t) => t.id)).toEqual([ids.linesTopic, ids.elisionTopic, ids.borrowTopic]);
    const first = await getDoc<BoardTopicsPage>(fake, `${path}&limit=1`);
    const second = await getDoc<BoardTopicsPage>(
      fake,
      `/api/v1/index/boards/${ids.beginners}/topics?limit=5&cursor=${first.next_cursor}`,
    );
    expect(second.items.map((t) => t.id)).toEqual([ids.elisionTopic, ids.borrowTopic]);
  });

  it('caps limit at the maximum and rejects bad parameters', async () => {
    expect(
      (await getDoc<ChangesPage>(fake, '/api/v1/index/changes?limit=100000')).events.length,
    ).toBeGreaterThan(0);
    for (const path of [
      '/api/v1/index/places?limit=0',
      '/api/v1/index/places?limit=abc',
      '/api/v1/index/places?cursor=not-a-cursor',
      `/api/v1/index/boards/${ids.beginners}/topics?updated_since=yesterday`,
    ]) {
      expect((await getProblem(fake, path, 400)).status).toBe(400);
    }
  });

  it('rejects a cursor from another endpoint or object', async () => {
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places?limit=1');
    expect((await getProblem(fake, `/api/v1/index/changes?cursor=${places.next_cursor}`, 400)).code).toBe(
      'invalid_cursor',
    );
    const topics = await getDoc<BoardTopicsPage>(
      fake,
      `/api/v1/index/boards/${ids.beginners}/topics?limit=1`,
    );
    expect(
      (
        await getProblem(
          fake,
          `/api/v1/index/boards/${ids.advanced}/topics?cursor=${topics.next_cursor}`,
          400,
        )
      ).code,
    ).toBe('invalid_cursor');
  });
});

describe('caching', () => {
  it('answers If-None-Match with 304 until the document changes', async () => {
    const path = '/api/v1/index/places';
    const first = await get(fake, path);
    const etag = first.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect((await get(fake, path)).headers.get('etag')).toBe(etag);

    const notModified = await get(fake, path, { 'If-None-Match': etag });
    expect(notModified.status).toBe(304);
    expect(notModified.text).toBe('');
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(notModified.headers.get('cache-control')).toBe('no-cache');
    expect((await get(fake, path, { 'If-None-Match': `"other", W/${etag}` })).status).toBe(304);
    expect((await get(fake, path, { 'If-None-Match': '"other"' })).status).toBe(200);

    const local = await createFakeInstance();
    try {
      const before = (await get(local, path)).headers.get('etag') ?? '';
      expect((await get(local, path, { 'If-None-Match': before })).status).toBe(304);
      local.setPlace(ids.homelab, { member_count: 861 });
      const after = await get(local, path, { 'If-None-Match': before });
      expect(after.status).toBe(200);
      expect(after.headers.get('etag')).not.toBe(before);
    } finally {
      await local.close();
    }
  });

  it('serves 304 on the well-known document and the feed too', async () => {
    for (const path of ['/.well-known/gotalk-instance', '/api/v1/index/changes?cursor=latest']) {
      const etag = (await get(fake, path)).headers.get('etag') ?? '';
      expect((await get(fake, path, { 'If-None-Match': etag })).status).toBe(304);
    }
  });

  it('rejects other methods and supports HEAD', async () => {
    const res = await fetch(`${fake.url}/api/v1/index/places`, { method: 'POST' });
    expect(res.status).toBe(405);
    const head = await fetch(`${fake.url}/api/v1/index/places`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBe((await get(fake, '/api/v1/index/places')).headers.get('etag'));
  });
});

describe('control routes', () => {
  it('do not exist unless enabled', async () => {
    expect((await get(fake, '/__fake/state')).status).toBe(404);
  });

  it('drive mutations and faults from another process', async () => {
    const local = await createFakeInstance({ control: true });
    try {
      const post = (path: string, body: unknown) =>
        fetch(`${local.url}${path}`, { method: 'POST', body: JSON.stringify(body) });
      const state = (await get<{ last_seq: number }>(local, '/__fake/state')).json;
      expect((await post('/__fake/call', { method: 'excludeUser', args: [ids.gopher] })).status).toBe(200);
      const feed = await getDoc<ChangesPage>(local, `/api/v1/index/changes?limit=500`);
      expect(feed.events.filter((e) => e.seq > state.last_seq).map((e) => e.type)).toEqual([
        'user.exclude',
        'topic.delete',
      ]);
      expect((await post('/__fake/call', { method: 'close' })).status).toBe(400);

      await post('/__fake/faults', { route: '/api/v1/index/places', fault: { kind: 'status', status: 503 } });
      expect((await get(local, '/api/v1/index/places')).status).toBe(503);
      await fetch(`${local.url}/__fake/faults`, { method: 'DELETE' });
      expect((await get(local, '/api/v1/index/places')).status).toBe(200);
    } finally {
      await local.close();
    }
  });
});
