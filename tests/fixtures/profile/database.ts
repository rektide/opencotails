import { DatabaseSync } from "node:sqlite";
import { indexedOpenCodeV2Fixture } from "../../../packages/query-kysely/test/fixtures/opencode-v2/index.ts";

export async function createCliDatabase(path: string): Promise<void> {
  const fixture = indexedOpenCodeV2Fixture({ path, pendingInput: true });
  const db = fixture.database;
  try {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT,
        title TEXT, version TEXT, time_created INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data BLOB);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data BLOB);

      -- Characterization rows inserted through the legacy table remain projected
      -- into V2, while poisoned migration residue is deliberately excluded.
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

    fixture.completeMigration();

    // Completed migrations may preserve V1 rows. These values would visibly
    // corrupt characterization assertions if a normal command queried them.
    const legacy = db.prepare("INSERT INTO session VALUES (?, 'poison', NULL, 'poison', '/poison', 'POISON', '0', 999999, 999999)");
    legacy.run("ses_newest_abcdefghijkl");
    legacy.run("ses_v1_only_abcdefghijkl");
    db.prepare("INSERT INTO message VALUES ('poison-message', 'ses_newest_abcdefghijkl', 999999, x'00')").run();
    db.prepare("INSERT INTO part VALUES ('poison-part', 'poison-message', 'ses_newest_abcdefghijkl', 999999, x'ff')").run();
  } finally {
    db.close();
  }
}

export async function createV1OnlyCliDatabase(path: string): Promise<void> {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY);
      CREATE TABLE message (id TEXT PRIMARY KEY);
      CREATE TABLE part (id TEXT PRIMARY KEY);
      INSERT INTO session VALUES ('ses_v1_only');
    `);
  } finally {
    db.close();
  }
}
