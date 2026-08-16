import { DatabaseSync } from "node:sqlite";

const SESSION_V2_COLUMNS = `
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT,
  fork_session_id TEXT, fork_boundary TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
  path TEXT, title TEXT, version TEXT NOT NULL, share_url TEXT, summary_additions INTEGER,
  summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT, metadata TEXT,
  cost REAL NOT NULL DEFAULT 0, tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0, tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0, tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  revert TEXT, permission TEXT, agent TEXT, model TEXT, time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL, time_compacting INTEGER, time_archived INTEGER,
  time_suspended INTEGER
`;

export function createCliDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session_v2 (${SESSION_V2_COLUMNS});
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE kv (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
    );
    CREATE TABLE session_pending (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
      delivery TEXT, admitted_seq INTEGER NOT NULL, time_created INTEGER NOT NULL
    );
    CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);
    CREATE TABLE event (
      id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL,
      created INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
    );

    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT,
      title TEXT, version TEXT, time_created INTEGER, time_updated INTEGER
    );
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data BLOB);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data BLOB);

    -- Keep older output-characterization setup authoritative: rows it adds through
    -- the former Session table are projected into V2, while poisoned residue is not.
    CREATE TRIGGER characterize_session_v2 AFTER INSERT ON session
    WHEN new.project_id <> 'poison'
    BEGIN
      INSERT INTO session_v2
        (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
      VALUES
        (new.id, new.project_id, new.parent_id, new.slug, new.directory, new.title,
         new.version, new.time_created, new.time_updated);
    END;
  `);

  const session = db.prepare(`
    INSERT INTO session_v2
      (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  session.run("ses_newest_abcdefghijkl", "project-a", null, "newest", "/work/alpha", "Alpha Beta", "1", 1000, 5000);
  session.run("ses_split_abcdefghijkl", "project-a", null, "split", "/work/alpha", "Split witnesses", "1", 2000, 4000);
  session.run("ses_other_abcdefghijkl", "project-b", "ses_newest_abcdefghijkl", "other", "/work/beta", "Other", "1", 3000, 3000);

  const message = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
  message.run("msg_new", "ses_newest_abcdefghijkl", "assistant", 0, 4500, 4600, JSON.stringify({
    agent: "build",
    model: { id: "fixture", providerID: "fixture" },
    content: [
      { type: "text", text: "alpha beta first snippet" },
      {
        type: "tool",
        id: "call-new",
        name: "fixture-tool",
        state: {
          status: "completed",
          input: { query: "alpha tool" },
          content: [{ type: "text", text: "beta result" }],
        },
        time: { created: 4500, completed: 4600 },
      },
    ],
    time: { created: 4500, completed: 4600 },
  }));
  message.run("msg_split_a", "ses_split_abcdefghijkl", "user", 0, 2500, 2500,
    JSON.stringify({ text: "alpha only", time: { created: 2500 } }));
  message.run("msg_split_b", "ses_split_abcdefghijkl", "user", 1, 3500, 3500,
    JSON.stringify({ text: "beta only", time: { created: 3500 } }));
  message.run("msg_other", "ses_other_abcdefghijkl", "user", 0, 3000, 3000,
    JSON.stringify({ text: "alpha beta other", time: { created: 3000 } }));

  db.prepare("INSERT INTO kv VALUES ('migration.v1-v2', ?, 1, 1)")
    .run(JSON.stringify({ phase: "completed" }));

  // Completed migrations may preserve V1 rows. These values would visibly corrupt every
  // characterization assertion if a production command accidentally queried them.
  const legacy = db.prepare("INSERT INTO session VALUES (?, 'poison', NULL, 'poison', '/poison', 'POISON', '0', 999999, 999999)");
  legacy.run("ses_newest_abcdefghijkl");
  legacy.run("ses_v1_only_abcdefghijkl");
  db.prepare("INSERT INTO message VALUES ('poison-message', 'ses_newest_abcdefghijkl', 999999, x'00')").run();
  db.prepare("INSERT INTO part VALUES ('poison-part', 'poison-message', 'ses_newest_abcdefghijkl', 999999, x'ff')").run();
  db.close();
}

export function createV1OnlyCliDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY);
    CREATE TABLE message (id TEXT PRIMARY KEY);
    CREATE TABLE part (id TEXT PRIMARY KEY);
    INSERT INTO session VALUES ('ses_v1_only');
  `);
  db.close();
}
