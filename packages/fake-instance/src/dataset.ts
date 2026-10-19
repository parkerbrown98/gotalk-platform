import { createHash } from 'node:crypto';

import {
  loadManifest,
  readFixture,
  type Author,
  type Board,
  type Place,
  type Topic,
} from '@gotalk-platform/index-protocol';

/**
 * The fake's private model of an instance: the flags the protocol's indexability rules read, which the index
 * endpoints never expose.
 */
export type Visibility = 'public' | 'invite_only' | 'private';

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  /** `exclude_from_index`, or a deleted account. */
  excluded: boolean;
}

export interface PlaceRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  member_count: number;
  tags: string[];
  locale?: string;
  updated_at: string;
  visibility: Visibility;
  indexable: boolean;
  nsfw: boolean;
  deleted: boolean;
}

export interface BoardRecord {
  id: string;
  place_id: string;
  parent_id: string | null;
  kind: 'category' | 'board';
  slug: string;
  name: string;
  description: string;
  position: number;
  updated_at: string;
  /** Readable by `@everyone`. */
  is_public: boolean;
  indexable: boolean;
  nsfw: boolean;
  deleted: boolean;
}

export interface TopicRecord {
  id: string;
  board_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  locked: boolean;
  archived: boolean;
  solved: boolean;
  tags: string[];
  deleted: boolean;
  draft: boolean;
}

export interface PostRecord {
  id: string;
  topic_id: string;
  number: number;
  parent_id: string | null;
  author_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  is_solution: boolean;
  deleted: boolean;
  /** Hidden by moderation. */
  hidden: boolean;
}

export interface Dataset {
  users: Map<string, UserRecord>;
  places: Map<string, PlaceRecord>;
  boards: Map<string, BoardRecord>;
  topics: Map<string, TopicRecord>;
  posts: Map<string, PostRecord>;
}

export function emptyDataset(): Dataset {
  return { users: new Map(), places: new Map(), boards: new Map(), topics: new Map(), posts: new Map() };
}

/** A deterministic UUIDv7-shaped ID: the timestamp of `iso`, with "random" bits hashed from `label`. */
export function uuid7(iso: string | Date, label: string): string {
  const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  if (Number.isNaN(ms)) throw new RangeError(`invalid time: ${String(iso)}`);
  const t = ms.toString(16).padStart(12, '0');
  const r = createHash('sha256').update(label).digest('hex');
  const variant = (8 | (parseInt(r.charAt(3), 16) & 3)).toString(16);
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-${variant}${r.slice(4, 7)}-${r.slice(7, 19)}`;
}

function addUser(data: Dataset, author: Author, excluded = false) {
  if (!data.users.has(author.id)) data.users.set(author.id, { ...author, excluded });
}

function addPlace(data: Dataset, place: Place, flags: Partial<PlaceRecord> = {}) {
  const { boards, ...rest } = place;
  data.places.set(place.id, {
    ...rest,
    visibility: 'public',
    indexable: true,
    nsfw: false,
    deleted: false,
    ...flags,
  });
  for (const board of boards) addBoard(data, place.id, board);
}

function addBoard(data: Dataset, placeId: string, board: Board, flags: Partial<BoardRecord> = {}) {
  data.boards.set(board.id, {
    ...board,
    kind: board.kind ?? 'board',
    place_id: placeId,
    is_public: true,
    indexable: true,
    nsfw: false,
    deleted: false,
    ...flags,
  });
}

interface TopicSeed {
  id: string;
  board_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at?: string;
  tags?: string[];
  flags?: Partial<TopicRecord>;
  posts: { id?: string; author: string; content: string; at: string; parent?: number; number?: number }[];
}

function addTopic(data: Dataset, seed: TopicSeed) {
  const last = seed.posts[seed.posts.length - 1];
  data.topics.set(seed.id, {
    id: seed.id,
    board_id: seed.board_id,
    slug: seed.slug,
    title: seed.title,
    created_at: seed.created_at,
    updated_at: seed.updated_at ?? last?.at ?? seed.created_at,
    pinned: false,
    locked: false,
    archived: false,
    solved: false,
    tags: seed.tags ?? [],
    deleted: false,
    draft: false,
    ...seed.flags,
  });
  const byNumber = new Map<number, string>();
  seed.posts.forEach((p, i) => {
    const number = p.number ?? i + 1;
    const id = p.id ?? uuid7(p.at, `post:${seed.id}:${number}`);
    byNumber.set(number, id);
    data.posts.set(id, {
      id,
      topic_id: seed.id,
      number,
      parent_id: p.parent === undefined ? null : (byNumber.get(p.parent) ?? null),
      author_id: p.author,
      content: p.content,
      created_at: p.at,
      edited_at: null,
      is_solution: false,
      deleted: false,
      hidden: false,
    });
  });
}

/** IDs of objects the fixtures mention but do not contain, because they are not indexable. */
export const hiddenIds = {
  /** NSFW place with indexing on. */
  afterDarkPlace: '0196bbff-6880-7b47-8577-5cb6a811ef02',
  afterDarkBoard: '0196bc00-52e0-7c27-9f8e-f7f0ff05aaf9',
  /** Members-only board in Rust Help. */
  moderatorsBoard: '0195561d-abe0-7df8-86bd-0ca609919283',
  /** Board in Homelab with `indexable: false`. */
  offTopicBoard: '01972faa-4f20-7161-ab3d-ed84e1922c95',
  /** A user with `exclude_from_index` on. */
  quietfox: '0197f13e-e380-7a56-a98a-332db31a83c7',
  /** Topic in Beginners whose opening post is by quietfox. */
  excludedTopic: '01a13a11-af80-70f3-8b74-965237c09c30',
  /** Deleted topic in Beginners. */
  deletedTopic: '01a13f01-1d00-7a74-ba89-f3f050bd9792',
  /** quietfox's reply, post 4 of the borrow checker topic. */
  borrowPost4: '01a12cfd-9a20-7a7b-8127-e7affc8c47c7',
} as const;

/** IDs of fixture objects that tests and mutations refer to by name. */
export const fixtureIds = {
  rustHelp: '01955615-6e80-74e8-a3b2-8e848714ac07',
  homelab: '01972fa7-9000-715f-98e5-b21870721770',
  selfHosting: '019bb301-d380-7001-bc60-506a89e87a65',
  learning: '0195561a-0260-7cf4-beb7-55eacc9b87c1',
  beginners: '0195561a-ecc0-7155-ab48-3f36ad46fef4',
  advanced: '0195561b-d720-731c-813a-56a9637e04b5',
  unsafeRust: '0198c2d8-1d80-7e78-a4a6-a61d05c1d16e',
  announcements: '0195561c-c180-7fda-b022-070dddd356f0',
  general: '01972fa8-7a60-718c-ae26-b2d4f2b468c6',
  networking: '01972fa9-64c0-71a4-a901-dda2550b3d28',
  reverseProxies: '01999bfe-ef80-71f5-9311-64647fae373e',
  apps: '019bb302-bde0-7605-abf3-2e7b4314531d',
  borrowTopic: '01a1261e-dfc0-7644-b81a-34024ef98d26',
  linesTopic: '01a12f3c-8da0-7e05-b1b7-a7602d7cc6f2',
  elisionTopic: '01a145d1-3160-708f-8be5-d832d1544745',
  rulesTopic: '01955630-e5c0-7467-83f9-2538ad525a7f',
  ferris: '0194f481-44a0-7f90-ab3d-189d8506bb3a',
  corro: '019505c2-b000-7fa1-8db2-667fbae6e2ce',
  gopher: '0195faae-93e0-79c7-bfbc-ce60b9bd3c01',
  ana: '019792ae-83c0-793e-a9d2-510cbd597653',
  sam: '01972f99-d460-74c3-94b8-e86c89b95935',
} as const;

/**
 * Builds the dataset from the index-protocol fixtures (places-page.json and every topic page), then adds the
 * objects the fixtures leave out because they are not indexable, plus a few topics on the other boards.
 */
export function seedFromFixtures(): Dataset {
  const data = emptyDataset();
  const places = readFixture<{ items: Place[] }>('places-page.json');
  for (const place of places.items) addPlace(data, place);

  for (const entry of loadManifest().fixtures) {
    if (entry.schema !== 'topic' || entry.status !== 200) continue;
    const page = readFixture<Topic>(entry.file);
    if (!data.topics.has(page.id)) {
      data.topics.set(page.id, {
        id: page.id,
        board_id: page.board_id,
        slug: page.slug,
        title: page.title,
        created_at: page.created_at,
        updated_at: page.updated_at,
        pinned: page.pinned,
        locked: page.locked,
        archived: page.archived,
        solved: page.solved,
        tags: [...page.tags],
        deleted: false,
        draft: false,
      });
    }
    for (const post of page.posts) {
      addUser(data, post.author);
      data.posts.set(post.id, {
        id: post.id,
        topic_id: page.id,
        number: post.number,
        parent_id: post.parent_id,
        author_id: post.author.id,
        content: post.content,
        created_at: post.created_at,
        edited_at: post.edited_at,
        is_solution: post.is_solution,
        deleted: false,
        hidden: false,
      });
    }
  }

  addHidden(data);
  addExtraTopics(data);
  return data;
}

function addHidden(data: Dataset) {
  const ids = fixtureIds;
  addUser(data, { id: hiddenIds.quietfox, username: 'quietfox', display_name: 'Quiet Fox' }, true);
  addUser(data, { id: ids.sam, username: 'sam', display_name: 'Sam Okafor' });

  data.posts.set(hiddenIds.borrowPost4, {
    id: hiddenIds.borrowPost4,
    topic_id: ids.borrowTopic,
    number: 4,
    parent_id: null,
    author_id: hiddenIds.quietfox,
    content: 'You could also clone the vector before pushing.',
    created_at: '2026-10-11T22:03:00Z',
    edited_at: null,
    is_solution: false,
    deleted: false,
    hidden: false,
  });

  addTopic(data, {
    id: hiddenIds.excludedTopic,
    board_id: ids.beginners,
    slug: 'is-rust-worth-learning-in-2026',
    title: 'Is Rust worth learning in 2026?',
    created_at: '2026-10-14T11:00:00Z',
    posts: [
      {
        author: hiddenIds.quietfox,
        content: 'Thinking about learning Rust. Is it worth it?',
        at: '2026-10-14T11:00:00Z',
      },
      { author: ids.ferris, content: 'Yes! Start with the book.', at: '2026-10-14T11:20:00Z', parent: 1 },
    ],
  });
  addTopic(data, {
    id: hiddenIds.deletedTopic,
    board_id: ids.beginners,
    slug: 'test-please-ignore',
    title: 'test please ignore',
    created_at: '2026-10-15T10:00:00Z',
    flags: { deleted: true },
    posts: [{ author: ids.corro, content: 'test', at: '2026-10-15T10:00:00Z' }],
  });
  addTopic(data, {
    id: uuid7('2026-10-17T22:00:00Z', 'topic:draft'),
    board_id: ids.beginners,
    slug: 'draft-iterator-adapters',
    title: 'Draft: iterator adapters cheat sheet',
    created_at: '2026-10-17T22:00:00Z',
    flags: { draft: true },
    posts: [{ author: ids.ana, content: 'Work in progress.', at: '2026-10-17T22:00:00Z' }],
  });

  addBoard(
    data,
    ids.rustHelp,
    {
      id: hiddenIds.moderatorsBoard,
      parent_id: null,
      kind: 'board',
      slug: 'moderators',
      name: 'Moderators',
      description: 'Staff only.',
      position: 3,
      updated_at: '2025-03-02T09:09:00Z',
    },
    { is_public: false },
  );
  addTopic(data, {
    id: uuid7('2026-10-01T09:00:00Z', 'topic:mod-rota'),
    board_id: hiddenIds.moderatorsBoard,
    slug: 'october-rota',
    title: 'October moderation rota',
    created_at: '2026-10-01T09:00:00Z',
    posts: [{ author: ids.ferris, content: 'Who can cover the weekend?', at: '2026-10-01T09:00:00Z' }],
  });

  addBoard(
    data,
    ids.homelab,
    {
      id: hiddenIds.offTopicBoard,
      parent_id: null,
      kind: 'board',
      slug: 'off-topic',
      name: 'Off-topic',
      description: 'Anything goes.',
      position: 4,
      updated_at: '2025-06-02T08:03:00Z',
    },
    { indexable: false },
  );
  addTopic(data, {
    id: uuid7('2026-10-05T19:00:00Z', 'topic:off-topic'),
    board_id: hiddenIds.offTopicBoard,
    slug: 'what-are-you-reading',
    title: 'What are you reading?',
    created_at: '2026-10-05T19:00:00Z',
    posts: [{ author: ids.sam, content: 'Currently: a book about TCP/IP.', at: '2026-10-05T19:00:00Z' }],
  });

  addPlace(
    data,
    {
      id: hiddenIds.afterDarkPlace,
      slug: 'after-dark',
      name: 'After Dark',
      description: 'Adults only.',
      icon_url: null,
      member_count: 312,
      tags: [],
      updated_at: '2025-05-10T21:01:00Z',
      boards: [
        {
          id: hiddenIds.afterDarkBoard,
          parent_id: null,
          kind: 'board',
          slug: 'general',
          name: 'General',
          description: '',
          position: 1,
          updated_at: '2025-05-10T21:01:00Z',
        },
      ],
    },
    { nsfw: true },
  );
  addTopic(data, {
    id: uuid7('2026-09-12T23:00:00Z', 'topic:after-dark'),
    board_id: hiddenIds.afterDarkBoard,
    slug: 'introductions',
    title: 'Introductions',
    created_at: '2026-09-12T23:00:00Z',
    posts: [{ author: ids.sam, content: 'Hello.', at: '2026-09-12T23:00:00Z' }],
  });

  const staffRoom = uuid7('2025-07-01T10:00:00Z', 'place:staff-room');
  addPlace(
    data,
    {
      id: staffRoom,
      slug: 'staff-room',
      name: 'Staff Room',
      description: 'Private place for instance staff.',
      icon_url: null,
      member_count: 4,
      tags: [],
      updated_at: '2025-07-01T10:00:00Z',
      boards: [
        {
          id: uuid7('2025-07-01T10:01:00Z', 'board:staff-room-general'),
          parent_id: null,
          kind: 'board',
          slug: 'general',
          name: 'General',
          description: '',
          position: 1,
          updated_at: '2025-07-01T10:01:00Z',
        },
      ],
    },
    { visibility: 'private' },
  );
}

function addExtraTopics(data: Dataset) {
  const ids = fixtureIds;
  addTopic(data, {
    id: uuid7('2026-08-20T12:00:00Z', 'topic:pin-projection'),
    board_id: ids.advanced,
    slug: 'pin-projection-without-macros',
    title: 'Pin projection without macros',
    created_at: '2026-08-20T12:00:00Z',
    tags: ['async', 'pin'],
    flags: { archived: true },
    posts: [
      {
        author: ids.ana,
        content: 'Can I project a `Pin<&mut Struct>` to a field safely by hand?',
        at: '2026-08-20T12:00:00Z',
      },
      {
        author: ids.corro,
        content: 'Only for structurally pinned fields, and `Drop` must not move them.',
        at: '2026-08-21T08:30:00Z',
        parent: 1,
      },
    ],
  });
  addTopic(data, {
    id: uuid7('2026-09-02T16:00:00Z', 'topic:ffi-strings'),
    board_id: ids.unsafeRust,
    slug: 'passing-strings-across-ffi',
    title: 'Passing strings across FFI',
    created_at: '2026-09-02T16:00:00Z',
    tags: ['ffi'],
    posts: [
      {
        author: ids.corro,
        content: 'Use `CString` going out and `CStr` coming back.',
        at: '2026-09-02T16:00:00Z',
      },
    ],
  });
  addTopic(data, {
    id: uuid7('2026-06-30T10:00:00Z', 'topic:announce-1-80'),
    board_id: ids.announcements,
    slug: 'rust-help-turns-one',
    title: 'Rust Help turns one',
    created_at: '2026-06-30T10:00:00Z',
    flags: { pinned: true, locked: true },
    posts: [
      { author: ids.ferris, content: 'Thank you all for a great first year.', at: '2026-06-30T10:00:00Z' },
    ],
  });
  addTopic(data, {
    id: uuid7('2026-09-14T18:00:00Z', 'topic:rack'),
    board_id: ids.general,
    slug: 'my-12u-rack',
    title: 'My 12U rack',
    created_at: '2026-09-14T18:00:00Z',
    tags: ['hardware'],
    posts: [
      { author: ids.sam, content: 'Finally cable-managed. Photos below.', at: '2026-09-14T18:00:00Z' },
      { author: ids.ana, content: 'Very tidy! What switch is that?', at: '2026-09-14T19:12:00Z', parent: 1 },
      { author: ids.sam, content: 'A used 24-port managed one.', at: '2026-09-14T20:40:00Z', parent: 2 },
    ],
  });
  addTopic(data, {
    id: uuid7('2026-09-21T07:30:00Z', 'topic:vlans'),
    board_id: ids.networking,
    slug: 'vlans-for-iot',
    title: 'VLANs for IoT devices',
    created_at: '2026-09-21T07:30:00Z',
    tags: ['vlan'],
    posts: [{ author: ids.sam, content: 'How do you isolate smart plugs?', at: '2026-09-21T07:30:00Z' }],
  });
  addTopic(data, {
    id: uuid7('2026-09-30T19:10:00Z', 'topic:caddy'),
    board_id: ids.reverseProxies,
    slug: 'caddy-wildcard-certificates',
    title: 'Caddy and wildcard certificates',
    created_at: '2026-09-30T19:10:00Z',
    tags: ['tls', 'caddy'],
    posts: [
      {
        author: ids.sam,
        content: 'You need a DNS provider module for wildcards.',
        at: '2026-09-30T19:10:00Z',
      },
    ],
  });
  addTopic(data, {
    id: uuid7('2026-02-02T09:00:00Z', 'topic:forum-software'),
    board_id: ids.apps,
    slug: 'which-forum-software',
    title: 'Which forum software do you run?',
    created_at: '2026-02-02T09:00:00Z',
    posts: [
      { author: ids.sam, content: 'Looking for something light.', at: '2026-02-02T09:00:00Z' },
      { author: ids.ana, content: 'Gotalk, obviously.', at: '2026-02-02T10:15:00Z' },
    ],
  });
}
