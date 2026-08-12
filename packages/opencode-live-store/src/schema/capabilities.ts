import type { DatabaseSync } from "node:sqlite";

export interface LayoutCapabilities {
  v1: boolean;
  v2: boolean;
  mixed: boolean;
}

const REQUIRED_SESSION_COLUMNS = [
  "id", "project_id", "parent_id", "slug", "directory", "title", "version",
  "time_created", "time_updated",
] as const;

function columns(database: DatabaseSync, table: string): Set<string> {
  return new Set(database.prepare(`pragma table_info(${table})`).all().map((row) => String(row.name)));
}

function hasColumns(database: DatabaseSync, table: string, required: readonly string[]): boolean {
  const actual = columns(database, table);
  return required.every((column) => actual.has(column));
}

export function detectCapabilities(database: DatabaseSync): Readonly<LayoutCapabilities> {
  const tables = new Set(database.prepare("select name from sqlite_master where type = 'table'").all().map((row) => String(row.name)));
  if (tables.has("session") && !hasColumns(database, "session", REQUIRED_SESSION_COLUMNS)) {
    throw new Error("unsupported opencode database: session table is missing required columns");
  }
  if (tables.has("session_v2") && !hasColumns(database, "session_v2", REQUIRED_SESSION_COLUMNS)) {
    throw new Error("unsupported opencode database: session_v2 table is missing required columns");
  }
  const v1Tables = ["session", "message", "part"] as const;
  const v2Tables = ["session_v2", "session_message"] as const;
  const v1 = v1Tables.every((table) => tables.has(table))
    && hasColumns(database, "message", ["id", "session_id", "time_created", "data"])
    && hasColumns(database, "part", ["id", "message_id", "session_id", "time_created", "data"]);
  const v2 = v2Tables.every((table) => tables.has(table))
    && hasColumns(database, "session_message", ["id", "session_id", "type", "seq", "time_created", "data"]);
  if (v1Tables.some((table) => tables.has(table)) && !v1) {
    throw new Error("unsupported opencode database: incomplete V1 layout");
  }
  // session_message predates session_v2 and can remain as an unused adjunct to
  // a complete V1 layout. session_v2 is the authoritative declaration of V2.
  if ((tables.has("session_v2") || (!v1 && tables.has("session_message"))) && !v2) {
    throw new Error("unsupported opencode database: incomplete V2 layout");
  }
  if (!v1 && !v2) throw new Error("unsupported opencode database: no complete V1 or V2 layout");

  const legacySessions = v1
    ? Number(database.prepare("select count(*) as count from session").get()!.count) > 0
    : false;
  const mixed = v1 && v2 && legacySessions;
  if (mixed) {
    const marker = tables.has("kv") && hasColumns(database, "kv", ["key", "value"])
      ? database.prepare("select value from kv where key = 'migration.v1-v2'").get()
      : undefined;
    let phase: unknown;
    try {
      phase = marker === undefined ? undefined : (JSON.parse(String(marker.value)) as { phase?: unknown }).phase;
    } catch {
      phase = undefined;
    }
    if (phase !== "completed") {
      throw new Error("unsupported opencode database: V1-V2 migration is incomplete");
    }
  }

  if (v2) {
    const duplicate = database.prepare(`
      select id from session_message group by id having count(*) > 1 limit 1
    `).get();
    if (duplicate) throw new Error(`invalid opencode database: duplicate session_message id ${String(duplicate.id)}`);
  }
  if (mixed) {
    const mismatch = database.prepare(`
      select sm.id
      from session_message sm join message m on m.id = sm.id
      where sm.session_id <> m.session_id limit 1
    `).get();
    if (mismatch) throw new Error(`invalid opencode database: message id belongs to different sessions (${String(mismatch.id)})`);
  }
  return Object.freeze({ v1, v2, mixed });
}
