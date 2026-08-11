import {
  validateDirectSearchRequest,
  type DirectSearchHit,
  type DirectSearchRequest,
  type PatternSet,
  type TextPattern,
} from "@opencoattails/query-domain";
import { sql, type Expression, type Kysely, type SqlBool } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { selectSessions } from "./selector.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function patternExpression(column: string, pattern: TextPattern): Expression<SqlBool> {
  const source = pattern.mode === "literal" ? escapeRegex(pattern.source) : pattern.source;
  return sql<SqlBool>`re(${source}, ${sql.ref(column)}, ${pattern.caseSensitive ? 1 : 0})`;
}

export function patternSetExpression(column: string, patterns: PatternSet): Expression<SqlBool> {
  const groups: Expression<SqlBool>[] = [];
  if (patterns.all !== undefined) groups.push(sql.join(patterns.all.map((pattern) => patternExpression(column, pattern)), sql` and `));
  if (patterns.any !== undefined) groups.push(sql`(${sql.join(patterns.any.map((pattern) => patternExpression(column, pattern)), sql` or `)})`);
  if (patterns.none !== undefined) groups.push(sql.join(patterns.none.map((pattern) => sql<SqlBool>`not ${patternExpression(column, pattern)}`), sql` and `));
  return sql`(${sql.join(groups, sql` and `)})`;
}

export async function searchTitles(database: Kysely<OpencodeDatabase>, request: DirectSearchRequest): Promise<readonly DirectSearchHit[]> {
  validateDirectSearchRequest(request);
  if (request.title === undefined || request.requirements !== undefined) throw new Error("title search requires title patterns only");
  const rows = await selectSessions(database, request.selector)
    .select([
      "session.id", "session.title", "session.directory", "session.slug",
      "session.project_id as projectId", "session.parent_id as parentId",
      "session.version", "session.time_created as timeCreated",
      "session.time_updated as timeUpdated",
    ])
    .where(patternSetExpression("session.title", request.title))
    .orderBy("session.time_updated", "desc")
    .limit(request.limit)
    .execute();
  return rows.map((session) => ({ backend: "direct" as const, session }));
}
