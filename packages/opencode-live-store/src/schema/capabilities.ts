import type { DatabaseSync } from "node:sqlite";

export interface LayoutCapabilities {
  v1: boolean;
  v2: boolean;
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
  if (!tables.has("session")) throw new Error("unsupported opencode database: missing session table");
  if (!hasColumns(database, "session", REQUIRED_SESSION_COLUMNS)) {
    throw new Error("unsupported opencode database: session table is missing required columns");
  }
  const v1 = tables.has("message") && tables.has("part")
    && hasColumns(database, "message", ["id", "session_id", "time_created", "data"])
    && hasColumns(database, "part", ["id", "message_id", "session_id", "time_created", "data"]);
  const v2 = tables.has("session_message")
    && hasColumns(database, "session_message", ["id", "session_id", "type", "seq", "time_created", "data"]);
  return Object.freeze({ v1, v2 });
}
