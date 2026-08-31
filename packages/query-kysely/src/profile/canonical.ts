import { createHash } from "node:crypto";
import type { SqliteProfileSchema, SqliteTableFact } from "./types.ts";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function hashSqliteProfileTables(tables: Readonly<Record<string, SqliteTableFact>>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(tables)).digest("hex")}`;
}

export function withSqliteProfileHash(
  tables: Readonly<Record<string, SqliteTableFact>>,
): SqliteProfileSchema {
  return { normalized_hash: hashSqliteProfileTables(tables), tables };
}
