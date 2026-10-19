/**
 * Types for every document in the index protocol (docs/index-protocol.md). The JSON Schemas in ../schemas are
 * the contract; these mirror them. Consumers must ignore unknown fields, so received documents may carry more.
 */

/** An opaque ID, stable for the life of the object. */
export type Id = string;
/** RFC 3339 in UTC, for example `2026-10-18T09:24:15Z`. */
export type Timestamp = string;
/** An opaque cursor. Pass it back unchanged. */
export type Cursor = string;

export interface Author {
  id: Id;
  username: string;
  display_name: string;
}

export interface DirectoryKey {
  alg: 'Ed25519';
  /** 32-byte public key, unpadded base64url (43 characters). */
  public_key: string;
}

export interface Directory {
  listed: boolean;
  protocol: number;
  index_url: string;
  contact_email?: string;
  keys?: DirectoryKey[];
}

export interface WellKnown {
  software: string;
  version: string;
  instance_url: string;
  api_base_url: string;
  api_versions: string[];
  instance_info_url: string;
  gateway_url?: string;
  directory?: Directory;
}

export interface Board {
  id: Id;
  /** A board ID, or null at the top level. */
  parent_id: Id | null;
  kind?: 'category' | 'board';
  slug: string;
  name: string;
  description: string;
  position: number;
  updated_at: Timestamp;
}

export interface Place {
  id: Id;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  member_count: number;
  tags: string[];
  locale?: string;
  updated_at: Timestamp;
  boards: Board[];
}

export interface PlacesPage {
  items: Place[];
  next_cursor: Cursor | null;
}

/** The fields a topic summary and a topic page share. */
export interface TopicFields {
  id: Id;
  slug: string;
  title: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Indexable replies, not all replies. */
  reply_count: number;
  pinned: boolean;
  locked: boolean;
  archived: boolean;
  solved: boolean;
  tags: string[];
}

export interface TopicSummary extends TopicFields {
  author: Author;
}

export interface BoardTopicsPage {
  items: TopicSummary[];
  next_cursor: Cursor | null;
}

export interface Post {
  id: Id;
  /** Stable and increasing. Removed posts leave gaps. */
  number: number;
  parent_id: Id | null;
  author: Author;
  /** Markdown source. */
  content: string;
  created_at: Timestamp;
  edited_at: Timestamp | null;
  is_solution: boolean;
}

export interface Topic extends TopicFields {
  author?: Author;
  place_id: Id;
  board_id: Id;
  posts: Post[];
  next_cursor: Cursor | null;
}

export type PlaceEventType = 'place.upsert' | 'place.delete';
export type BoardEventType = 'board.upsert' | 'board.delete';
export type TopicEventType = 'topic.upsert' | 'topic.delete';
export type UserEventType = 'user.exclude' | 'user.include';
export type KnownEventType = PlaceEventType | BoardEventType | TopicEventType | UserEventType;

interface EventBase {
  seq: number;
  at: Timestamp;
}

export interface PlaceEvent extends EventBase {
  type: PlaceEventType;
  place_id: Id;
}

export interface BoardEvent extends EventBase {
  type: BoardEventType;
  place_id: Id;
  board_id: Id;
}

export interface TopicEvent extends EventBase {
  type: TopicEventType;
  place_id: Id;
  board_id: Id;
  topic_id: Id;
}

export interface UserEvent extends EventBase {
  type: UserEventType;
  user_id: Id;
}

/** An event type this version does not know. Consumers skip it. */
export interface UnknownEvent extends EventBase {
  type: string;
  place_id?: Id;
  board_id?: Id;
  topic_id?: Id;
  user_id?: Id;
}

export type KnownChangeEvent = PlaceEvent | BoardEvent | TopicEvent | UserEvent;
export type ChangeEvent = KnownChangeEvent | UnknownEvent;

export const knownEventTypes: readonly KnownEventType[] = [
  'place.upsert',
  'place.delete',
  'board.upsert',
  'board.delete',
  'topic.upsert',
  'topic.delete',
  'user.exclude',
  'user.include',
];

export function isKnownEvent(event: ChangeEvent): event is KnownChangeEvent {
  return (knownEventTypes as readonly string[]).includes(event.type);
}

export interface ChangesPage {
  events: ChangeEvent[];
  next_cursor: Cursor;
  has_more: boolean;
}

/** Problem codes used by the instance and the platform. `type` is `https://gotalk.sh/problems/{code}`. */
export type ProblemCode =
  | 'not_found'
  | 'cursor_expired'
  | 'rate_limited'
  | 'origin_blocked'
  | 'verification_failed'
  | 'invalid_signature'
  | 'unknown_key'
  | 'stale_timestamp'
  | 'replayed_nonce';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: ProblemCode | (string & {});
}

export interface PingRequest {
  origin: string;
}

export interface RegistrationRequest {
  origin: string;
}

export type InstanceStatusValue = 'pending' | 'listed' | 'stale' | 'suspended' | 'blocked' | 'removed';

export interface RegistrationResponse {
  origin: string;
  status: InstanceStatusValue;
}

export interface InstanceStatus {
  origin: string;
  status: InstanceStatusValue;
  listed_since: Timestamp | null;
  places_indexed: number;
  topics_indexed: number;
  last_crawl_at: Timestamp | null;
}

/** Maps each schema name (the file name without `.schema.json`) to the document it describes. */
export interface SchemaDocuments {
  common: unknown;
  directory: Directory;
  'well-known': WellKnown;
  'places-page': PlacesPage;
  'board-topics-page': BoardTopicsPage;
  topic: Topic;
  event: ChangeEvent;
  'changes-page': ChangesPage;
  problem: Problem;
  'ping-request': PingRequest;
  'registration-request': RegistrationRequest;
  'registration-response': RegistrationResponse;
  'instance-status': InstanceStatus;
}

export type SchemaName = keyof SchemaDocuments;
