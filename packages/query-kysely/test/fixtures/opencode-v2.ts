import { DatabaseSync } from "node:sqlite";

const SESSION_COLUMNS = `
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

export interface OpenCodeV2Fixture {
  readonly database: DatabaseSync;
  readonly addLegacySession: (id?: string) => void;
  readonly addMessage: (type: string, data?: unknown, id?: string) => void;
  readonly completeMigration: () => void;
  readonly addEvent: (id?: string) => void;
}

export function openCodeV2Fixture(options: {
  readonly events?: boolean;
  readonly pendingInput?: boolean;
} = {}): OpenCodeV2Fixture {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    create table session_v2 (${SESSION_COLUMNS});
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

  let messageSequence = 0;
  const addLegacySession = (id = "ses_legacy") => {
    database.exec("create table if not exists session (id text)");
    database.prepare("insert into session values (?)").run(id);
  };
  const addMessage = (type: string, data: unknown = {}, id = `msg_${messageSequence}`) => {
    database.prepare("insert into session_message values (?, 'ses_fixture', ?, ?, 1, 1, ?)")
      .run(id, type, messageSequence++, typeof data === "string" ? data : JSON.stringify(data));
  };
  const completeMigration = () => {
    database.prepare("insert or replace into kv values ('migration.v1-v2', ?, 1, 1)")
      .run(JSON.stringify({ phase: "completed" }));
  };
  const addEvent = (id = "evt_fixture") => {
    database.prepare("insert or ignore into event_sequence values ('ses_fixture', 1, null)").run();
    database.prepare("insert into event values (?, 'ses_fixture', 1, 1, 'session.created@1', '{}')").run(id);
  };
  return { database, addLegacySession, addMessage, completeMigration, addEvent };
}
