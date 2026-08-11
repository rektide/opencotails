import { DatabaseSync } from "node:sqlite";

export function createCliDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
      slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL,
      version TEXT NOT NULL, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);

  const session = db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  session.run("ses_newest_abcdefghijkl", "project-a", null, "newest", "/work/alpha", "Alpha Beta", "1", 1000, 5000);
  session.run("ses_split_abcdefghijkl", "project-a", null, "split", "/work/alpha", "Split witnesses", "1", 2000, 4000);
  session.run("ses_other_abcdefghijkl", "project-b", "ses_newest_abcdefghijkl", "other", "/work/beta", "Other", "1", 3000, 3000);

  const message = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  message.run("m-new", "ses_newest_abcdefghijkl", 4500, "{}");
  message.run("m-split-a", "ses_split_abcdefghijkl", 2500, "{}");
  message.run("m-split-b", "ses_split_abcdefghijkl", 3500, "{}");
  message.run("m-other", "ses_other_abcdefghijkl", 3000, "{}");

  const part = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
  part.run("p-new", "m-new", "ses_newest_abcdefghijkl", 4500, JSON.stringify({ type: "text", text: "alpha beta first snippet" }));
  part.run("p-tool", "m-new", "ses_newest_abcdefghijkl", 4600, JSON.stringify({ type: "tool", state: { input: "alpha tool", output: "beta result" } }));
  part.run("p-split-a", "m-split-a", "ses_split_abcdefghijkl", 2500, JSON.stringify({ type: "text", text: "alpha only" }));
  part.run("p-split-b", "m-split-b", "ses_split_abcdefghijkl", 3500, JSON.stringify({ type: "text", text: "beta only" }));
  part.run("p-other", "m-other", "ses_other_abcdefghijkl", 3000, JSON.stringify({ type: "text", text: "alpha beta other" }));

  db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)")
    .run("sm-new", "ses_newest_abcdefghijkl", "user", 1, 4500, JSON.stringify({ text: "alpha beta first snippet" }));
  db.close();
}
