import type { DatabaseSync } from "node:sqlite";
import type { ContentQuery, SearchHit } from "./types.ts";
import { existingTables } from "./db.ts";
import { V1Source } from "./v1/source.ts";
import { V2Source } from "./v2/source.ts";

export interface Source {
  readonly version: "v1" | "v2";
  searchContent(q: ContentQuery): SearchHit[];
}

export interface VersionSchema {
  table: string;
  sessionRef: string;
  typeExpr: string;
  textExpr: string;
  snippetExpr: string;
  orderCol: string;
}

export function buildContentQuery(schema: VersionSchema, q: ContentQuery): { sql: string; params: unknown[] } {
  const { table, sessionRef, typeExpr, textExpr, snippetExpr, orderCol } = schema;
  const exists = q.patterns.map(
    () => `EXISTS (SELECT 1 FROM ${table} WHERE ${sessionRef} AND ${typeExpr} AND re(?, ${textExpr}))`,
  );
  const snippetSelect = q.showSnippet
    ? `, substr((SELECT ${snippetExpr} FROM ${table} WHERE ${sessionRef} AND ${typeExpr} AND re(?, ${textExpr}) ORDER BY ${orderCol} LIMIT 1), 1, 200) AS snippet`
    : "";
  const sql = `SELECT s.id, s.slug, s.title, s.directory AS directory,
                      datetime(s.time_created/1000, 'unixepoch') AS created,
                      datetime(s.time_updated/1000, 'unixepoch') AS updated${snippetSelect}
               FROM session s
               WHERE ${exists.join(" AND ")}
               ORDER BY s.time_updated DESC LIMIT ?`;
  const params: unknown[] = [];
  if (q.showSnippet) params.push(q.patterns[0]);
  for (const p of q.patterns) params.push(p);
  params.push(q.limit);
  return { sql, params };
}

export function detectSources(db: DatabaseSync): Source[] {
  const tables = existingTables(db);
  const sources: Source[] = [];
  if (tables.has("part")) sources.push(new V1Source(db));
  if (!tables.has("part") && tables.has("event")) sources.push(new V2Source(db));
  return sources;
}
