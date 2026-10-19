import {
  readFixture,
  validate,
  type BoardTopicsPage,
  type ChangeEvent,
  type ChangesPage,
  type PlacesPage,
  type Topic,
  type WellKnown,
} from '@gotalk-platform/index-protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixtureIds as ids, hiddenIds } from './dataset.ts';
import { createFakeInstance, type FakeInstance } from './server.ts';
import { get, getDoc, getProblem } from './test-helpers.ts';

/** A clock that starts at 2026-10-18T09:00:00Z and ticks a minute per read. */
function tickingClock() {
  let t = Date.parse('2026-10-18T09:00:00Z');
  return () => new Date((t += 60_000));
}

let fake: FakeInstance;
let mark: number;

beforeEach(async () => {
  fake = await createFakeInstance({ now: tickingClock() });
  mark = fake.state.lastSeq;
});
afterEach(() => fake.close());

/** Events appended since the test started, read through GET /changes from a cursor. */
async function newEvents(): Promise<ChangeEvent[]> {
  const page = await getDoc<ChangesPage>(fake, `/api/v1/index/changes?limit=500`);
  return page.events.filter((e) => e.seq > mark);
}

/** Events without seq and at, to compare with fixtures. */
const shape = (events: ChangeEvent[]) =>
  events.map((event) => {
    const rest: Record<string, unknown> = { ...event };
    delete rest.seq;
    delete rest.at;
    return rest;
  });

const fixtureShape = (file: string) => shape(readFixture<ChangesPage>(file).events);

const topicPath = (id: string) => `/api/v1/index/topics/${id}`;
const boardPath = (id: string) => `/api/v1/index/boards/${id}/topics`;

describe('initial history', () => {
  it('starts with place.upsert and topic.upsert for everything indexable', async () => {
    const feed = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?limit=500');
    expect(feed.events[0]?.seq).toBe(1);
    expect(feed.events.filter((e) => e.type === 'place.upsert')).toHaveLength(3);
    expect(feed.events.every((e) => e.type === 'place.upsert' || e.type === 'topic.upsert')).toBe(true);
    expect(JSON.stringify(feed)).not.toContain(hiddenIds.excludedTopic);
  });

  it('can start empty at a given seq', async () => {
    const empty = await createFakeInstance({ seedEvents: false, firstSeq: 10231 });
    try {
      const feed = await getDoc<ChangesPage>(empty, '/api/v1/index/changes');
      expect(feed).toMatchObject({ events: [], has_more: false });
      empty.addPost(ids.linesTopic, { authorId: ids.ana, content: 'More.' });
      expect((await getDoc<ChangesPage>(empty, '/api/v1/index/changes')).events[0]?.seq).toBe(10231);
    } finally {
      await empty.close();
    }
  });
});

describe('topics and posts', () => {
  it('addTopic emits topic.upsert and serves the topic', async () => {
    const topic = fake.addTopic({
      boardId: ids.advanced,
      title: 'Async closures are stable!',
      authorId: ids.ana,
      content: 'Finally.',
      tags: ['async'],
    });
    expect(shape(await newEvents())).toEqual([
      { type: 'topic.upsert', place_id: ids.rustHelp, board_id: ids.advanced, topic_id: topic.id },
    ]);
    const doc = await getDoc<Topic>(fake, topicPath(topic.id));
    expect(doc).toMatchObject({ slug: 'async-closures-are-stable', reply_count: 0, posts: [{ number: 1 }] });
    const board = await getDoc<BoardTopicsPage>(fake, boardPath(ids.advanced));
    expect(board.items.at(-1)?.id).toBe(topic.id);
  });

  it('addTopic in a board that is not indexable emits nothing', async () => {
    const topic = fake.addTopic({
      boardId: hiddenIds.moderatorsBoard,
      title: 'Secret',
      authorId: ids.ferris,
      content: '…',
    });
    expect(await newEvents()).toEqual([]);
    await getProblem(fake, topicPath(topic.id), 404);
  });

  it('addPost, editPost and editTopic emit topic.upsert and bump updated_at', async () => {
    const before = await getDoc<Topic>(fake, topicPath(ids.linesTopic));
    const post = fake.addPost(ids.linesTopic, { authorId: ids.gopher, content: 'Also `lines()` allocates.' });
    fake.editPost(post.id, { content: 'Also, `lines()` allocates a `String` per line.' });
    fake.editTopic(ids.linesTopic, { solved: false, tags: ['io', 'files'] });
    const refs = { place_id: ids.rustHelp, board_id: ids.beginners, topic_id: ids.linesTopic };
    expect(shape(await newEvents())).toEqual([
      { type: 'topic.upsert', ...refs },
      { type: 'topic.upsert', ...refs },
      { type: 'topic.upsert', ...refs },
    ]);
    const after = await getDoc<Topic>(fake, topicPath(ids.linesTopic));
    expect(after.reply_count).toBe(before.reply_count + 1);
    expect(after.solved).toBe(false);
    expect(after.tags).toEqual(['io', 'files']);
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
    const added = after.posts.at(-1);
    expect(added).toMatchObject({ number: 4, content: 'Also, `lines()` allocates a `String` per line.' });
    expect(added?.edited_at).toEqual(expect.any(String));
  });

  it('deleting a reply leaves a gap; deleting the opening post deletes the topic', async () => {
    const topic = await getDoc<Topic>(fake, topicPath(ids.linesTopic));
    fake.deletePost(topic.posts[1]!.id);
    const after = await getDoc<Topic>(fake, topicPath(ids.linesTopic));
    expect(after.posts.map((p) => p.number)).toEqual([1, 3]);
    expect(after.reply_count).toBe(1);

    fake.deletePost(topic.posts[0]!.id);
    await getProblem(fake, topicPath(ids.linesTopic), 404);
    const board = await getDoc<BoardTopicsPage>(fake, boardPath(ids.beginners));
    expect(board.items.map((t) => t.id)).not.toContain(ids.linesTopic);
    const refs = { place_id: ids.rustHelp, board_id: ids.beginners, topic_id: ids.linesTopic };
    expect(shape(await newEvents())).toEqual([
      { type: 'topic.upsert', ...refs },
      { type: 'topic.delete', ...refs },
    ]);
  });

  it('hiding a post by moderation removes it', async () => {
    const topic = await getDoc<Topic>(fake, topicPath(ids.borrowTopic));
    fake.setPostHidden(topic.posts[1]!.id, true);
    expect((await getDoc<Topic>(fake, topicPath(ids.borrowTopic))).posts.map((p) => p.number)).toEqual([
      1, 3, 5, 6,
    ]);
    fake.setPostHidden(topic.posts[1]!.id, false);
    expect((await getDoc<Topic>(fake, topicPath(ids.borrowTopic))).posts).toHaveLength(5);
  });

  it('deleteTopic emits topic.delete and 404s', async () => {
    fake.deleteTopic(ids.rulesTopic);
    expect(shape(await newEvents())).toEqual([
      { type: 'topic.delete', place_id: ids.rustHelp, board_id: ids.beginners, topic_id: ids.rulesTopic },
    ]);
    await getProblem(fake, topicPath(ids.rulesTopic), 404);
  });

  it('moveTopic emits topic.upsert with the new board (fixture changes-topic-moved.json)', async () => {
    fake.moveTopic(ids.linesTopic, ids.advanced);
    expect(shape(await newEvents())).toEqual(fixtureShape('changes-topic-moved.json'));
    expect((await getDoc<Topic>(fake, topicPath(ids.linesTopic))).board_id).toBe(ids.advanced);
    const beginners = await getDoc<BoardTopicsPage>(fake, boardPath(ids.beginners));
    expect(beginners.items.map((t) => t.id)).not.toContain(ids.linesTopic);
  });

  it('moving a topic to a board that is not indexable emits topic.delete with the old board', async () => {
    fake.moveTopic(ids.linesTopic, hiddenIds.moderatorsBoard);
    expect(shape(await newEvents())).toEqual([
      { type: 'topic.delete', place_id: ids.rustHelp, board_id: ids.beginners, topic_id: ids.linesTopic },
    ]);
    await getProblem(fake, topicPath(ids.linesTopic), 404);
  });
});

describe('users', () => {
  it('excludeUser matches changes-user-exclude.json and removes their posts', async () => {
    fake.excludeUser(ids.gopher);
    expect(shape(await newEvents())).toEqual(fixtureShape('changes-user-exclude.json'));
    await getProblem(fake, topicPath(ids.elisionTopic), 404);
    const borrow = await getDoc<Topic>(fake, topicPath(ids.borrowTopic));
    expect(borrow.posts.map((p) => p.number)).toEqual([1, 2, 5, 6]);
    expect(borrow.reply_count).toBe(3);
    expect(JSON.stringify(borrow)).not.toContain(ids.gopher);
  });

  it('includeUser matches changes-user-include.json and restores their posts', async () => {
    fake.excludeUser(ids.gopher);
    mark = fake.state.lastSeq;
    fake.includeUser(ids.gopher);
    expect(shape(await newEvents())).toEqual(fixtureShape('changes-user-include.json'));
    expect(await getDoc(fake, topicPath(ids.elisionTopic))).toEqual(readFixture('topic-unsolved.json'));
  });

  it('a user excluded from the start keeps their topic out', async () => {
    fake.includeUser(hiddenIds.quietfox);
    expect(shape(await newEvents())).toEqual([
      { type: 'user.include', user_id: hiddenIds.quietfox },
      { type: 'topic.upsert', place_id: ids.rustHelp, board_id: ids.beginners, topic_id: ids.borrowTopic },
      {
        type: 'topic.upsert',
        place_id: ids.rustHelp,
        board_id: ids.beginners,
        topic_id: hiddenIds.excludedTopic,
      },
    ]);
    const borrow = await getDoc<Topic>(fake, topicPath(ids.borrowTopic));
    expect(borrow.posts.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
    await getDoc(fake, topicPath(hiddenIds.excludedTopic));
  });
});

describe('places and boards', () => {
  it.each([
    ['made private', () => fake.setPlaceVisibility(ids.homelab, 'private')],
    ['made invite-only', () => fake.setPlaceVisibility(ids.homelab, 'invite_only')],
    ['opted out', () => fake.setPlaceIndexable(ids.homelab, false)],
    ['marked NSFW', () => fake.setPlace(ids.homelab, { nsfw: true })],
    ['deleted', () => fake.setPlace(ids.homelab, { deleted: true })],
  ])('a place %s emits place.delete and disappears', async (_name, change) => {
    const topics = await getDoc<BoardTopicsPage>(fake, boardPath(ids.general));
    change();
    expect(shape(await newEvents())).toEqual([{ type: 'place.delete', place_id: ids.homelab }]);
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    expect(places.items.map((p) => p.id)).toEqual([ids.rustHelp, ids.selfHosting]);
    await getProblem(fake, boardPath(ids.general), 404);
    await getProblem(fake, topicPath(topics.items[0]!.id), 404);
  });

  it('a place made indexable emits place.upsert', async () => {
    fake.setPlace(hiddenIds.afterDarkPlace, { nsfw: false, name: 'After Dark (now SFW)' });
    expect(shape(await newEvents())).toEqual([{ type: 'place.upsert', place_id: hiddenIds.afterDarkPlace }]);
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    expect(places.items.map((p) => p.id)).toContain(hiddenIds.afterDarkPlace);
  });

  it('a category made members-only takes its sub-boards with it', async () => {
    fake.setBoard(ids.learning, { is_public: false });
    expect(shape(await newEvents())).toEqual(
      [ids.learning, ids.beginners, ids.advanced, ids.unsafeRust].map((board_id) => ({
        type: 'board.delete',
        place_id: ids.rustHelp,
        board_id,
      })),
    );
    const rust = (await getDoc<PlacesPage>(fake, '/api/v1/index/places')).items[0];
    expect(rust?.boards.map((b) => b.id)).toEqual([ids.announcements]);
    await getProblem(fake, boardPath(ids.unsafeRust), 404);
    await getProblem(fake, topicPath(ids.borrowTopic), 404);
  });

  it('renaming a board emits board.upsert', async () => {
    fake.setBoard(ids.beginners, { name: 'New to Rust' });
    expect(shape(await newEvents())).toEqual([
      { type: 'board.upsert', place_id: ids.rustHelp, board_id: ids.beginners },
    ]);
  });

  it('moveBoard matches changes-board-moved.json', async () => {
    const topics = await getDoc<BoardTopicsPage>(fake, boardPath(ids.reverseProxies));
    fake.moveBoard(ids.reverseProxies, { placeId: ids.selfHosting });
    expect(shape(await newEvents())).toEqual(fixtureShape('changes-board-moved.json'));
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    const byId = new Map(places.items.map((p) => [p.id, p.boards.map((b) => b.id)]));
    expect(byId.get(ids.homelab)).not.toContain(ids.reverseProxies);
    expect(byId.get(ids.selfHosting)).toContain(ids.reverseProxies);
    const topic = await getDoc<Topic>(fake, topicPath(topics.items[0]!.id));
    expect(topic.place_id).toBe(ids.selfHosting);
  });

  it('moving a board with sub-boards moves them all', async () => {
    fake.moveBoard(ids.advanced, { placeId: ids.selfHosting });
    expect(shape(await newEvents())).toEqual([
      { type: 'board.delete', place_id: ids.rustHelp, board_id: ids.advanced },
      { type: 'board.delete', place_id: ids.rustHelp, board_id: ids.unsafeRust },
      { type: 'board.upsert', place_id: ids.selfHosting, board_id: ids.advanced },
      { type: 'board.upsert', place_id: ids.selfHosting, board_id: ids.unsafeRust },
    ]);
    const selfHosting = (await getDoc<PlacesPage>(fake, '/api/v1/index/places')).items.find(
      (p) => p.id === ids.selfHosting,
    );
    expect(selfHosting?.boards.map((b) => [b.id, b.parent_id])).toEqual([
      [ids.apps, null],
      [ids.advanced, null],
      [ids.unsafeRust, ids.advanced],
    ]);
  });
});

describe('listing', () => {
  it('turning listing off changes only the well-known document', async () => {
    fake.setListed(false);
    expect(await newEvents()).toEqual([]);
    const doc = await getDoc<WellKnown>(fake, '/.well-known/gotalk-instance');
    expect(doc.directory?.listed).toBe(false);
    expect(validate('well-known', doc).valid).toBe(true);

    fake.setListed(false, { omit: true });
    expect((await getDoc<WellKnown>(fake, '/.well-known/gotalk-instance')).directory).toBeUndefined();

    fake.setListed(true);
    expect(shape(await newEvents())).toEqual(
      [ids.rustHelp, ids.homelab, ids.selfHosting].map((place_id) => ({ type: 'place.upsert', place_id })),
    );
    expect((await getDoc<WellKnown>(fake, '/.well-known/gotalk-instance')).directory?.listed).toBe(true);
  });
});

describe('feed cursors and retention', () => {
  it('cursor=latest returns no events and resumes from the end', async () => {
    const latest = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?cursor=latest');
    expect(latest).toMatchObject({ events: [], has_more: false });
    fake.addPost(ids.linesTopic, { authorId: ids.ana, content: 'One more thing.' });
    const next = await getDoc<ChangesPage>(fake, `/api/v1/index/changes?cursor=${latest.next_cursor}`);
    expect(next.events.map((e) => e.seq)).toEqual([mark + 1]);
    const again = await getDoc<ChangesPage>(fake, `/api/v1/index/changes?cursor=${next.next_cursor}`);
    expect(again).toMatchObject({ events: [], next_cursor: next.next_cursor, has_more: false });
  });

  it('expireBefore makes older cursors answer 410 cursor_expired', async () => {
    const start = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?limit=1');
    fake.addPost(ids.linesTopic, { authorId: ids.ana, content: 'One more thing.' });
    fake.expireBefore(mark);
    const problem = await getProblem(fake, `/api/v1/index/changes?cursor=${start.next_cursor}`, 410);
    expect(problem).toEqual(readFixture('changes-cursor-expired.json'));

    const oldest = await getDoc<ChangesPage>(fake, '/api/v1/index/changes');
    expect(oldest.events.map((e) => e.seq)).toEqual([mark, mark + 1]);
    const resumed = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?cursor=latest');
    expect(resumed.events).toEqual([]);
  });

  it('pruneHistory expires every cursor but the current end', async () => {
    const latest = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?cursor=latest');
    const older = await getDoc<ChangesPage>(fake, '/api/v1/index/changes?limit=1');
    fake.pruneHistory();
    await getProblem(fake, `/api/v1/index/changes?cursor=${older.next_cursor}`, 410);
    expect(await getDoc(fake, `/api/v1/index/changes?cursor=${latest.next_cursor}`)).toMatchObject({
      events: [],
    });
    expect(await getDoc(fake, '/api/v1/index/changes')).toMatchObject({ events: [], has_more: false });
  });

  it('a cursor from the future is invalid', async () => {
    const future = Buffer.from(JSON.stringify({ k: 'changes', after: 1e9 })).toString('base64url');
    expect((await getProblem(fake, `/api/v1/index/changes?cursor=${future}`, 400)).code).toBe(
      'invalid_cursor',
    );
  });

  it('serves unknown event types injected with emit', async () => {
    fake.emit('place.pin', { place_id: ids.rustHelp });
    const events = await newEvents();
    expect(events).toEqual([expect.objectContaining({ type: 'place.pin', place_id: ids.rustHelp })]);
  });
});

describe('coalescing', () => {
  it('keeps only the latest event per object, leaving gaps in seq', async () => {
    const coalescing = await createFakeInstance({ coalesce: true, now: tickingClock() });
    try {
      const start = coalescing.state.lastSeq;
      for (let i = 0; i < 3; i++)
        coalescing.addPost(ids.linesTopic, { authorId: ids.ana, content: `Reply ${i}` });
      coalescing.setBoard(ids.advanced, { description: 'Updated.' });
      coalescing.addPost(ids.borrowTopic, { authorId: ids.ana, content: 'Bump.' });
      coalescing.addPost(ids.linesTopic, { authorId: ids.ana, content: 'Last.' });
      const feed = await getDoc<ChangesPage>(coalescing, '/api/v1/index/changes?limit=500');
      const lines = feed.events.filter((e) => 'topic_id' in e && e.topic_id === ids.linesTopic);
      expect(lines.map((e) => e.seq)).toEqual([start + 6]);
      const recent = feed.events.filter((e) => e.seq > start);
      expect(recent.map((e) => [e.seq - start, e.type])).toEqual([
        [4, 'board.upsert'],
        [5, 'topic.upsert'],
        [6, 'topic.upsert'],
      ]);
      expect(feed.events.filter((e) => 'topic_id' in e && e.topic_id === ids.borrowTopic)).toHaveLength(1);
    } finally {
      await coalescing.close();
    }
  });
});

describe('HTTP after mutations', () => {
  it('every response still validates', async () => {
    fake.excludeUser(ids.gopher);
    fake.moveBoard(ids.reverseProxies, { placeId: ids.selfHosting });
    fake.addTopic({ boardId: ids.apps, title: 'Mail servers', authorId: ids.sam, content: 'Which one?' });
    const places = await getDoc<PlacesPage>(fake, '/api/v1/index/places');
    for (const place of places.items) {
      for (const board of place.boards) {
        const topics = await getDoc<BoardTopicsPage>(fake, boardPath(board.id));
        for (const t of topics.items) await getDoc(fake, topicPath(t.id));
      }
    }
    expect((await get(fake, '/api/v1/index/changes')).status).toBe(200);
  });
});
