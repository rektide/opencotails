import { DatabaseSync } from "node:sqlite";
import { allMessageVariants, validMessageData } from "./messages.ts";

const REQUIRED_SESSION_COLUMNS = `
  id text primary key,
  project_id text not null,
  workspace_id text,
  parent_id text,
  fork_session_id text,
  fork_boundary text,
  slug text not null,
  directory text not null,
  path text,
  title text,
  version text not null,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  metadata text,
  cost real not null default 0,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  tokens_reasoning integer not null default 0,
  tokens_cache_read integer not null default 0,
  tokens_cache_write integer not null default 0,
  revert text,
  permission text,
  agent text,
  model text,
  time_created integer not null,
  time_updated integer not null,
  time_compacting integer,
  time_archived integer,
  time_suspended integer
`;

// Keep this aligned with the upstream generated schema. The smaller required
// shape above remains useful for malformed-source behavior tests.
const INDEXED_SESSION_COLUMNS = `
  id text primary key,
  project_id text not null,
  workspace_id text,
  parent_id text,
  fork_session_id text,
  fork_boundary text,
  slug text not null,
  directory text not null,
  path text,
  title text,
  version text not null,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  metadata text,
  cost real not null default 0,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  tokens_reasoning integer not null default 0,
  tokens_cache_read integer not null default 0,
  tokens_cache_write integer not null default 0,
  revert text,
  permission text,
  agent text,
  model text,
  time_created integer not null,
  time_updated integer not null,
  time_idle integer,
  time_viewed integer,
  idle_outcome text,
  time_compacting integer,
  time_archived integer,
  time_suspended integer,
  resume_attempts integer not null default 0
`;

export interface OpenCodeV2Fixture {
  readonly database: DatabaseSync;
  readonly addLegacySession: (id?: string) => void;
  readonly addMessage: (type: string, data?: unknown, id?: string) => void;
  readonly addAllMessageVariants: () => void;
  readonly completeMigration: () => void;
  readonly addEvent: (id?: string) => void;
}

export interface OpenCodeV2FixtureOptions {
  readonly events?: boolean;
  readonly pendingInput?: boolean;
  readonly path?: string;
}

function createFixture(
  sessionColumns: string,
  options: OpenCodeV2FixtureOptions,
  indexed: boolean,
): OpenCodeV2Fixture {
  const database = new DatabaseSync(options.path ?? ":memory:");
  database.exec(`
    create table session_v2 (${sessionColumns});
    create table session_message (
      id text primary key, session_id text not null, type text not null, seq integer not null,
      time_created integer not null, time_updated integer not null, data text not null
    );
    create table kv (
      key text primary key, value text not null, time_created integer not null, time_updated integer not null
    );
  `);
  if (options.pendingInput) database.exec(`
    create table session_pending (
      id text primary key, session_id text not null, type text not null, data text not null,
      delivery text, admitted_seq integer not null, time_created integer not null
    );
  `);
  if (options.events ?? true) database.exec(`
    create table event_sequence (aggregate_id text primary key, seq integer not null, owner_id text);
    create table event (
      id text primary key, aggregate_id text not null, seq integer not null, created integer not null default 0,
      type text not null, data text not null
    );
  `);
  if (indexed) {
    database.exec(`
      create unique index session_message_session_seq_idx on session_message(session_id, seq);
      create index session_message_session_type_seq_idx on session_message(session_id, type, seq);
      create index session_message_session_time_created_id_idx on session_message(session_id, time_created, id);
      create index session_message_time_created_idx on session_message(time_created);
      create index session_v2_project_idx on session_v2(project_id);
      create index session_v2_workspace_idx on session_v2(workspace_id);
      create index session_v2_parent_idx on session_v2(parent_id);
      create index session_v2_time_suspended_idx on session_v2(time_suspended) where time_suspended is not null;
    `);
    if (options.pendingInput) database.exec(`
      create index session_pending_session_delivery_seq_idx on session_pending(session_id, delivery, admitted_seq);
      create unique index session_pending_session_compaction_idx on session_pending(session_id) where type = 'compaction';
      create unique index session_pending_session_admitted_seq_idx on session_pending(session_id, admitted_seq);
    `);
    if (options.events ?? true) database.exec(`
      create unique index event_aggregate_seq_idx on event(aggregate_id, seq);
      create index event_aggregate_type_seq_idx on event(aggregate_id, type, seq);
    `);
  }

  let messageSequence = 0;
  const addLegacySession = (id = "ses_legacy") => {
    database.exec("create table if not exists session (id text)");
    database.prepare("insert into session values (?)").run(id);
  };
  const addMessage = (type: string, data: unknown = undefined, id = `msg_${messageSequence}`) => {
    database.prepare("insert into session_message values (?, 'ses_fixture', ?, ?, 1, 1, ?)")
      .run(id, type, messageSequence++, typeof data === "string" ? data : JSON.stringify(data ?? validMessageData(type, id)));
  };
  const addAllMessageVariants = () => {
    for (const type of allMessageVariants) addMessage(type);
  };
  const completeMigration = () => {
    database.prepare("insert or replace into kv values ('migration.v1-v2', ?, 1, 1)")
      .run(JSON.stringify({ phase: "completed" }));
  };
  const addEvent = (id = "evt_fixture") => {
    database.prepare("insert or ignore into event_sequence values ('ses_fixture', 1, null)").run();
    database.prepare("insert into event values (?, 'ses_fixture', 1, 1, 'session.created@1', '{}')").run(id);
  };
  return { database, addLegacySession, addMessage, addAllMessageVariants, completeMigration, addEvent };
}

export function behaviorOpenCodeV2Fixture(options: OpenCodeV2FixtureOptions = {}): OpenCodeV2Fixture {
  return createFixture(REQUIRED_SESSION_COLUMNS, options, false);
}

export function indexedOpenCodeV2Fixture(options: OpenCodeV2FixtureOptions = {}): OpenCodeV2Fixture {
  return createFixture(INDEXED_SESSION_COLUMNS, options, true);
}
