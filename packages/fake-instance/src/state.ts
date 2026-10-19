import type {
  Author,
  Board,
  BoardTopicsPage,
  ChangeEvent,
  ChangesPage,
  KnownEventType,
  Place,
  PlacesPage,
  Post,
  Topic,
  TopicSummary,
} from '@gotalk-platform/index-protocol';

import {
  seedFromFixtures,
  uuid7,
  type BoardRecord,
  type Dataset,
  type PlaceRecord,
  type PostRecord,
  type TopicRecord,
  type UserRecord,
  type Visibility,
} from './dataset.ts';

export interface StateOptions {
  /** Starting data. Defaults to the index-protocol fixtures plus the hidden objects in dataset.ts. */
  dataset?: Dataset;
  /** The clock for `updated_at`, `edited_at` and event times. */
  now?: () => Date;
  /** Replace earlier events for the same object with the new one (a new seq), as the protocol allows. */
  coalesce?: boolean;
  /** Emit place.upsert and topic.upsert for everything indexable at start, as an initial history. Default true. */
  seedEvents?: boolean;
  /** The seq of the first event. Default 1. */
  firstSeq?: number;
}

/** Thrown by reads for anything missing or not indexable, and by bad parameters. */
export class ReadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ReadError';
    this.status = status;
    this.code = code;
  }
}

const notFound = (what: string) => new ReadError(404, 'not_found', `No such ${what}.`);
const badParameter = (message: string) => new ReadError(400, 'invalid_parameter', message);

type CursorBody =
  | { k: 'places'; after: string }
  | { k: 'topics'; b: string; u: string; id: string; s?: string }
  | { k: 'posts'; t: string; after: number }
  | { k: 'changes'; after: number };

export function encodeCursor(body: CursorBody): string {
  return Buffer.from(JSON.stringify(body)).toString('base64url');
}

function decodeCursor<K extends CursorBody['k']>(raw: string, kind: K): Extract<CursorBody, { k: K }> {
  try {
    const body = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorBody;
    if (body && typeof body === 'object' && body.k === kind) return body as Extract<CursorBody, { k: K }>;
  } catch {
    // fall through
  }
  throw new ReadError(400, 'invalid_cursor', 'The cursor is not valid for this endpoint.');
}

export const limits = {
  places: { default: 100, max: 500 },
  topics: { default: 100, max: 500 },
  posts: { default: 50, max: 100 },
  changes: { default: 100, max: 500 },
} as const;

function parseLimit(raw: string | null | undefined, kind: keyof typeof limits): number {
  if (raw === null || raw === undefined || raw === '') return limits[kind].default;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw badParameter('limit must be a positive integer.');
  return Math.min(Number(raw), limits[kind].max);
}

function rfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'topic'
  );
}

function byTime(a: { updated_at: string; id: string }, b: { updated_at: string; id: string }): number {
  return Date.parse(a.updated_at) - Date.parse(b.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface ReadParams {
  cursor?: string | null;
  limit?: string | null;
  updated_since?: string | null;
}

export interface NewTopic {
  boardId: string;
  title: string;
  authorId: string;
  content: string;
  id?: string;
  slug?: string;
  tags?: string[];
}

export interface TopicPatch {
  title?: string;
  slug?: string;
  pinned?: boolean;
  locked?: boolean;
  archived?: boolean;
  solved?: boolean;
  tags?: string[];
}

export interface NewPost {
  authorId: string;
  content: string;
  parentId?: string | null;
  id?: string;
}

export type PlacePatch = Partial<
  Pick<
    PlaceRecord,
    | 'name'
    | 'slug'
    | 'description'
    | 'icon_url'
    | 'member_count'
    | 'tags'
    | 'locale'
    | 'visibility'
    | 'indexable'
    | 'nsfw'
    | 'deleted'
  >
>;

export type BoardPatch = Partial<
  Pick<
    BoardRecord,
    'name' | 'slug' | 'description' | 'position' | 'kind' | 'is_public' | 'indexable' | 'nsfw' | 'deleted'
  >
>;

export interface DirectoryState {
  listed: boolean;
  /** Leave the directory block out of the well-known document entirely. */
  omit: boolean;
}

/**
 * The fake instance's data, its change feed and the protocol's indexability rules. Reads build the documents
 * the index endpoints serve; mutations change the data and append the events a real instance would.
 */
export class FakeState {
  readonly data: Dataset;
  readonly events: ChangeEvent[] = [];
  readonly directory: DirectoryState = { listed: true, omit: false };
  coalesce: boolean;
  /** Events with a seq below this are gone; a cursor before it is expired. */
  historyStart: number;
  private nextSeq: number;
  private readonly clock: () => Date;
  private idCounter = 0;

  constructor(options: StateOptions = {}) {
    this.data = options.dataset ?? seedFromFixtures();
    this.clock = options.now ?? (() => new Date());
    this.coalesce = options.coalesce ?? false;
    this.nextSeq = options.firstSeq ?? 1;
    this.historyStart = this.nextSeq;
    if (options.seedEvents ?? true) {
      for (const place of this.sortedPlaces()) {
        if (this.placeIndexable(place)) this.emit('place.upsert', { place_id: place.id });
      }
      for (const topic of [...this.data.topics.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (this.topicIndexable(topic)) this.emit('topic.upsert', this.topicRefs(topic));
      }
    }
  }

  now(): string {
    return rfc3339(this.clock());
  }

  /** The seq of the last event ever appended (0 before the first). */
  get lastSeq(): number {
    return this.nextSeq - 1;
  }

  // Indexability, as in "What is indexable" in docs/index-protocol.md.

  placeIndexable(place: PlaceRecord | undefined): boolean {
    return !!place && !place.deleted && place.visibility === 'public' && place.indexable && !place.nsfw;
  }

  boardIndexable(board: BoardRecord | undefined): boolean {
    const seen = new Set<string>();
    let current = board;
    if (!current || !this.placeIndexable(this.data.places.get(current.place_id))) return false;
    while (current) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      if (current.deleted || !current.is_public || !current.indexable || current.nsfw) return false;
      if (current.parent_id === null) return true;
      current = this.data.boards.get(current.parent_id);
      if (!current) return false;
    }
    return false;
  }

  userVisible(userId: string): boolean {
    const user = this.data.users.get(userId);
    return !!user && !user.excluded;
  }

  postVisible(post: PostRecord): boolean {
    return !post.deleted && !post.hidden && this.userVisible(post.author_id);
  }

  postsOf(topicId: string): PostRecord[] {
    return [...this.data.posts.values()]
      .filter((p) => p.topic_id === topicId)
      .sort((a, b) => a.number - b.number);
  }

  openingPost(topicId: string): PostRecord | undefined {
    return this.postsOf(topicId)[0];
  }

  topicIndexable(topic: TopicRecord | undefined): boolean {
    if (!topic || topic.deleted || topic.draft) return false;
    if (!this.boardIndexable(this.data.boards.get(topic.board_id))) return false;
    const opening = this.openingPost(topic.id);
    return !!opening && this.postVisible(opening);
  }

  // Reads

  private author(userId: string): Author {
    const user = this.data.users.get(userId);
    if (!user) throw new Error(`unknown user ${userId}`);
    return { id: user.id, username: user.username, display_name: user.display_name };
  }

  private sortedPlaces(): PlaceRecord[] {
    return [...this.data.places.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Indexable boards of a place, depth first, siblings by position then id. */
  indexableBoards(placeId: string): BoardRecord[] {
    const boards = [...this.data.boards.values()].filter(
      (b) => b.place_id === placeId && this.boardIndexable(b),
    );
    const children = (parent: string | null) =>
      boards
        .filter((b) => b.parent_id === parent)
        .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
    const out: BoardRecord[] = [];
    const walk = (parent: string | null) => {
      for (const board of children(parent)) {
        out.push(board);
        walk(board.id);
      }
    };
    walk(null);
    return out;
  }

  placeDocument(place: PlaceRecord): Place {
    const boards: Board[] = this.indexableBoards(place.id).map((b) => ({
      id: b.id,
      parent_id: b.parent_id,
      kind: b.kind,
      slug: b.slug,
      name: b.name,
      description: b.description,
      position: b.position,
      updated_at: b.updated_at,
    }));
    return {
      id: place.id,
      slug: place.slug,
      name: place.name,
      description: place.description,
      icon_url: place.icon_url,
      member_count: place.member_count,
      tags: [...place.tags],
      ...(place.locale === undefined ? {} : { locale: place.locale }),
      updated_at: place.updated_at,
      boards,
    };
  }

  /** `GET /places`: indexable places ordered by id. */
  readPlaces(params: ReadParams = {}): PlacesPage {
    const limit = parseLimit(params.limit, 'places');
    const after = params.cursor ? decodeCursor(params.cursor, 'places').after : undefined;
    const places = this.sortedPlaces().filter(
      (p) => this.placeIndexable(p) && (after === undefined || p.id > after),
    );
    const page = places.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((p) => this.placeDocument(p)),
      next_cursor: places.length > limit && last ? encodeCursor({ k: 'places', after: last.id }) : null,
    };
  }

  topicSummary(topic: TopicRecord): TopicSummary {
    const posts = this.postsOf(topic.id).filter((p) => this.postVisible(p));
    const opening = posts[0];
    if (!opening) throw new Error(`topic ${topic.id} has no visible posts`);
    return {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      author: this.author(opening.author_id),
      created_at: topic.created_at,
      updated_at: topic.updated_at,
      reply_count: posts.length - 1,
      pinned: topic.pinned,
      locked: topic.locked,
      archived: topic.archived,
      solved: topic.solved,
      tags: [...topic.tags],
    };
  }

  /** `GET /boards/{id}/topics`: ordered by updated_at then id. */
  readBoardTopics(boardId: string, params: ReadParams = {}): BoardTopicsPage {
    const board = this.data.boards.get(boardId);
    if (!this.boardIndexable(board)) throw notFound('board');
    const limit = parseLimit(params.limit, 'topics');
    const cursor = params.cursor ? decodeCursor(params.cursor, 'topics') : undefined;
    if (cursor && cursor.b !== boardId)
      throw new ReadError(400, 'invalid_cursor', 'The cursor is for another board.');
    const since = cursor ? cursor.s : (params.updated_since ?? undefined);
    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw badParameter('updated_since must be an RFC 3339 timestamp.');
    }
    const topics = [...this.data.topics.values()]
      .filter((t) => t.board_id === boardId && this.topicIndexable(t))
      .filter((t) => since === undefined || Date.parse(t.updated_at) >= Date.parse(since))
      .sort(byTime)
      .filter((t) => !cursor || byTime(t, { updated_at: cursor.u, id: cursor.id }) > 0);
    const page = topics.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((t) => this.topicSummary(t)),
      next_cursor:
        topics.length > limit && last
          ? encodeCursor({
              k: 'topics',
              b: boardId,
              u: last.updated_at,
              id: last.id,
              ...(since === undefined ? {} : { s: since }),
            })
          : null,
    };
  }

  private postDocument(post: PostRecord): Post {
    return {
      id: post.id,
      number: post.number,
      parent_id: post.parent_id,
      author: this.author(post.author_id),
      content: post.content,
      created_at: post.created_at,
      edited_at: post.edited_at,
      is_solution: post.is_solution,
    };
  }

  /** `GET /topics/{id}`: the summary plus a page of posts in number order. */
  readTopic(topicId: string, params: ReadParams = {}): Topic {
    const topic = this.data.topics.get(topicId);
    if (!topic || !this.topicIndexable(topic)) throw notFound('topic');
    const board = this.data.boards.get(topic.board_id);
    if (!board) throw notFound('topic');
    const limit = parseLimit(params.limit, 'posts');
    const cursor = params.cursor ? decodeCursor(params.cursor, 'posts') : undefined;
    if (cursor && cursor.t !== topicId)
      throw new ReadError(400, 'invalid_cursor', 'The cursor is for another topic.');
    const posts = this.postsOf(topicId).filter(
      (p) => this.postVisible(p) && (!cursor || p.number > cursor.after),
    );
    const page = posts.slice(0, limit);
    const last = page[page.length - 1];
    const { author, ...summary } = this.topicSummary(topic);
    return {
      id: summary.id,
      place_id: board.place_id,
      board_id: board.id,
      slug: summary.slug,
      title: summary.title,
      author,
      created_at: summary.created_at,
      updated_at: summary.updated_at,
      reply_count: summary.reply_count,
      pinned: summary.pinned,
      locked: summary.locked,
      archived: summary.archived,
      solved: summary.solved,
      tags: summary.tags,
      posts: page.map((p) => this.postDocument(p)),
      next_cursor:
        posts.length > limit && last ? encodeCursor({ k: 'posts', t: topicId, after: last.number }) : null,
    };
  }

  /** `GET /changes`. Omit the cursor to start at the oldest retained event; `latest` jumps to the end. */
  readChanges(params: ReadParams = {}): ChangesPage {
    const limit = parseLimit(params.limit, 'changes');
    if (params.cursor === 'latest') {
      return {
        events: [],
        next_cursor: encodeCursor({ k: 'changes', after: this.lastSeq }),
        has_more: false,
      };
    }
    const after = params.cursor ? decodeCursor(params.cursor, 'changes').after : this.historyStart - 1;
    if (!Number.isInteger(after) || after > this.lastSeq) {
      throw new ReadError(400, 'invalid_cursor', 'The cursor is not valid for this feed.');
    }
    if (after < this.historyStart - 1) {
      throw new ReadError(
        410,
        'cursor_expired',
        'The cursor is older than the retained history. Run a reconcile.',
      );
    }
    const pending = this.events.filter((e) => e.seq > after);
    const page = pending.slice(0, limit);
    const last = page[page.length - 1];
    return {
      events: page.map((e) => ({ ...e })),
      next_cursor: encodeCursor({ k: 'changes', after: last ? last.seq : after }),
      has_more: pending.length > page.length,
    };
  }

  // Feed

  private coalesceKey(event: ChangeEvent): string | undefined {
    const refs = event as { place_id?: string; board_id?: string; topic_id?: string; user_id?: string };
    const [kind] = event.type.split('.');
    const id =
      kind === 'place'
        ? refs.place_id
        : kind === 'board'
          ? refs.board_id
          : kind === 'topic'
            ? refs.topic_id
            : kind === 'user'
              ? refs.user_id
              : undefined;
    return id === undefined ? undefined : `${kind}:${id}`;
  }

  /** Appends an event. Use it directly to inject unusual events (unknown types, for example). */
  emit(
    type: KnownEventType | (string & {}),
    refs: { place_id?: string; board_id?: string; topic_id?: string; user_id?: string } = {},
  ): ChangeEvent {
    const event = { seq: this.nextSeq++, type, at: this.now(), ...refs } as ChangeEvent;
    if (this.coalesce) {
      const key = this.coalesceKey(event);
      if (key !== undefined) {
        for (let i = this.events.length - 1; i >= 0; i--) {
          const existing = this.events[i];
          if (existing && this.coalesceKey(existing) === key) this.events.splice(i, 1);
        }
      }
    }
    this.events.push(event);
    return event;
  }

  /** Drops events with a seq below `seq`. A cursor from before it gets `410 cursor_expired`. */
  expireBefore(seq: number): void {
    if (seq <= this.historyStart) return;
    this.historyStart = Math.min(seq, this.lastSeq + 1);
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event && event.seq < this.historyStart) this.events.splice(i, 1);
    }
  }

  /** Drops all history. Every earlier cursor except the current end expires. */
  pruneHistory(): void {
    this.expireBefore(this.lastSeq + 1);
  }

  private topicRefs(topic: TopicRecord, boardId = topic.board_id) {
    const board = this.data.boards.get(boardId);
    if (!board) throw new Error(`unknown board ${boardId}`);
    return { place_id: board.place_id, board_id: board.id, topic_id: topic.id };
  }

  /** Emits topic.upsert or topic.delete according to the topic's indexability before and after a change. */
  private topicChanged(topic: TopicRecord, before: { indexable: boolean; boardId: string }): void {
    if (this.topicIndexable(topic)) this.emit('topic.upsert', this.topicRefs(topic));
    else if (before.indexable) this.emit('topic.delete', this.topicRefs(topic, before.boardId));
  }

  private snapshot(topic: TopicRecord) {
    return { indexable: this.topicIndexable(topic), boardId: topic.board_id };
  }

  private newId(kind: string): string {
    return uuid7(this.clock(), `${kind}:${++this.idCounter}`);
  }

  private get<T>(map: Map<string, T>, id: string, what: string): T {
    const value = map.get(id);
    if (!value) throw new Error(`unknown ${what}: ${id}`);
    return value;
  }

  // Mutations: each changes the data and appends the events a real instance would.

  addUser(user: { id?: string; username: string; display_name?: string; excluded?: boolean }): UserRecord {
    const record: UserRecord = {
      id: user.id ?? this.newId('user'),
      username: user.username,
      display_name: user.display_name ?? user.username,
      excluded: user.excluded ?? false,
    };
    this.data.users.set(record.id, record);
    return record;
  }

  addTopic(input: NewTopic): TopicRecord {
    this.get(this.data.boards, input.boardId, 'board');
    this.get(this.data.users, input.authorId, 'user');
    const at = this.now();
    const topic: TopicRecord = {
      id: input.id ?? this.newId('topic'),
      board_id: input.boardId,
      slug: input.slug ?? slugify(input.title),
      title: input.title,
      created_at: at,
      updated_at: at,
      pinned: false,
      locked: false,
      archived: false,
      solved: false,
      tags: input.tags ?? [],
      deleted: false,
      draft: false,
    };
    this.data.topics.set(topic.id, topic);
    const postId = this.newId('post');
    this.data.posts.set(postId, {
      id: postId,
      topic_id: topic.id,
      number: 1,
      parent_id: null,
      author_id: input.authorId,
      content: input.content,
      created_at: at,
      edited_at: null,
      is_solution: false,
      deleted: false,
      hidden: false,
    });
    this.topicChanged(topic, { indexable: false, boardId: topic.board_id });
    return topic;
  }

  editTopic(topicId: string, patch: TopicPatch): TopicRecord {
    const topic = this.get(this.data.topics, topicId, 'topic');
    const before = this.snapshot(topic);
    Object.assign(topic, patch, { updated_at: this.now() });
    this.topicChanged(topic, before);
    return topic;
  }

  deleteTopic(topicId: string): void {
    const topic = this.get(this.data.topics, topicId, 'topic');
    const before = this.snapshot(topic);
    topic.deleted = true;
    this.topicChanged(topic, before);
  }

  /** Moves a topic: topic.upsert with the new board, or topic.delete with the old one if it is no longer indexable. */
  moveTopic(topicId: string, boardId: string): TopicRecord {
    const topic = this.get(this.data.topics, topicId, 'topic');
    this.get(this.data.boards, boardId, 'board');
    const before = this.snapshot(topic);
    topic.board_id = boardId;
    topic.updated_at = this.now();
    this.topicChanged(topic, before);
    return topic;
  }

  addPost(topicId: string, input: NewPost): PostRecord {
    const topic = this.get(this.data.topics, topicId, 'topic');
    this.get(this.data.users, input.authorId, 'user');
    const before = this.snapshot(topic);
    const number = Math.max(0, ...this.postsOf(topicId).map((p) => p.number)) + 1;
    const at = this.now();
    const post: PostRecord = {
      id: input.id ?? this.newId('post'),
      topic_id: topicId,
      number,
      parent_id: input.parentId ?? null,
      author_id: input.authorId,
      content: input.content,
      created_at: at,
      edited_at: null,
      is_solution: false,
      deleted: false,
      hidden: false,
    };
    this.data.posts.set(post.id, post);
    topic.updated_at = at;
    this.topicChanged(topic, before);
    return post;
  }

  editPost(postId: string, patch: { content?: string; is_solution?: boolean }): PostRecord {
    const post = this.get(this.data.posts, postId, 'post');
    const topic = this.get(this.data.topics, post.topic_id, 'topic');
    const before = this.snapshot(topic);
    const at = this.now();
    if (patch.content !== undefined) {
      post.content = patch.content;
      post.edited_at = at;
    }
    if (patch.is_solution !== undefined) post.is_solution = patch.is_solution;
    topic.updated_at = at;
    this.topicChanged(topic, before);
    return post;
  }

  /** Deletes a post: topic.upsert, or topic.delete when it was the opening post. */
  deletePost(postId: string): void {
    this.changePost(postId, (post) => (post.deleted = true));
  }

  /** Hides (or restores) a post by moderation. */
  setPostHidden(postId: string, hidden: boolean): void {
    this.changePost(postId, (post) => (post.hidden = hidden));
  }

  private changePost(postId: string, change: (post: PostRecord) => void): void {
    const post = this.get(this.data.posts, postId, 'post');
    const topic = this.get(this.data.topics, post.topic_id, 'topic');
    const before = this.snapshot(topic);
    change(post);
    topic.updated_at = this.now();
    this.topicChanged(topic, before);
  }

  /** user.exclude, then topic.delete for every indexable topic whose opening post is theirs. */
  excludeUser(userId: string): void {
    const user = this.get(this.data.users, userId, 'user');
    const opened = this.topicsWhere(
      (t) => this.topicIndexable(t) && this.openingPost(t.id)?.author_id === userId,
    );
    user.excluded = true;
    this.emit('user.exclude', { user_id: userId });
    for (const topic of opened) this.emit('topic.delete', this.topicRefs(topic));
  }

  /** user.include, then topic.upsert for every indexable topic with a post of theirs. */
  includeUser(userId: string): void {
    const user = this.get(this.data.users, userId, 'user');
    user.excluded = false;
    this.emit('user.include', { user_id: userId });
    const affected = this.topicsWhere(
      (t) =>
        this.topicIndexable(t) &&
        this.postsOf(t.id).some((p) => p.author_id === userId && this.postVisible(p)),
    );
    for (const topic of affected) this.emit('topic.upsert', this.topicRefs(topic));
  }

  private topicsWhere(predicate: (topic: TopicRecord) => boolean): TopicRecord[] {
    return [...this.data.topics.values()].filter(predicate).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Changes a place: place.upsert while it is indexable, place.delete when it stops being indexable. */
  setPlace(placeId: string, patch: PlacePatch): PlaceRecord {
    const place = this.get(this.data.places, placeId, 'place');
    const before = this.placeIndexable(place);
    Object.assign(place, patch, { updated_at: this.now() });
    if (this.placeIndexable(place)) this.emit('place.upsert', { place_id: placeId });
    else if (before) this.emit('place.delete', { place_id: placeId });
    return place;
  }

  setPlaceIndexable(placeId: string, indexable: boolean): PlaceRecord {
    return this.setPlace(placeId, { indexable });
  }

  setPlaceVisibility(placeId: string, visibility: Visibility): PlaceRecord {
    return this.setPlace(placeId, { visibility });
  }

  private subtree(boardId: string): BoardRecord[] {
    const out: BoardRecord[] = [];
    const walk = (id: string) => {
      const board = this.data.boards.get(id);
      if (!board || out.includes(board)) return;
      out.push(board);
      for (const child of this.data.boards.values()) if (child.parent_id === id) walk(child.id);
    };
    walk(boardId);
    return out;
  }

  /** Changes a board. Emits board.upsert or board.delete for it and for any sub-board whose indexability changed. */
  setBoard(boardId: string, patch: BoardPatch): BoardRecord {
    const board = this.get(this.data.boards, boardId, 'board');
    const boards = this.subtree(boardId);
    const before = new Map(boards.map((b) => [b.id, this.boardIndexable(b)]));
    Object.assign(board, patch, { updated_at: this.now() });
    for (const b of boards) {
      const now = this.boardIndexable(b);
      if (now && (b === board || !before.get(b.id)))
        this.emit('board.upsert', { place_id: b.place_id, board_id: b.id });
      else if (!now && before.get(b.id)) this.emit('board.delete', { place_id: b.place_id, board_id: b.id });
    }
    return board;
  }

  /**
   * Moves a board (and its sub-boards) to another place or parent: board.delete for the old place, then
   * board.upsert for the new one, for each board that was or is indexable.
   */
  moveBoard(
    boardId: string,
    target: { placeId?: string; parentId?: string | null; position?: number },
  ): BoardRecord {
    const board = this.get(this.data.boards, boardId, 'board');
    const placeId = target.placeId ?? board.place_id;
    this.get(this.data.places, placeId, 'place');
    const boards = this.subtree(boardId);
    const before = boards.map((b) => ({ board: b, placeId: b.place_id, indexable: this.boardIndexable(b) }));
    const at = this.now();
    for (const b of boards) {
      b.place_id = placeId;
      b.updated_at = at;
    }
    // Moving to another place without naming a parent makes the board top level there.
    if (target.parentId !== undefined) board.parent_id = target.parentId;
    else if (placeId !== before[0]?.placeId) board.parent_id = null;
    if (target.position !== undefined) board.position = target.position;
    for (const b of before) {
      if (b.indexable && (b.placeId !== placeId || !this.boardIndexable(b.board))) {
        this.emit('board.delete', { place_id: b.placeId, board_id: b.board.id });
      }
    }
    for (const b of boards) {
      if (this.boardIndexable(b)) this.emit('board.upsert', { place_id: b.place_id, board_id: b.id });
    }
    return board;
  }

  /**
   * Turns directory listing on or off. Off only changes the well-known document (the indexer notices it on
   * its 15-minute check); on emits place.upsert for each indexable place. `omit` drops the block entirely.
   */
  setListed(listed: boolean, options: { omit?: boolean } = {}): void {
    const wasListed = this.directory.listed;
    this.directory.listed = listed;
    this.directory.omit = options.omit ?? false;
    if (listed && !wasListed) {
      for (const place of this.sortedPlaces()) {
        if (this.placeIndexable(place)) this.emit('place.upsert', { place_id: place.id });
      }
    }
  }

  /** Counts for `GET /api/v1/instance`. */
  counts(): { places: number; topics: number } {
    return {
      places: this.sortedPlaces().filter((p) => this.placeIndexable(p)).length,
      topics: [...this.data.topics.values()].filter((t) => this.topicIndexable(t)).length,
    };
  }
}
