import {
  validateDirectSearchRequest,
  type DirectSearchHit,
  type DirectSearchRequest,
  type PatternSet,
  type TextPattern,
} from "@opencoattails/query-domain";
import { sql, type Expression, type Kysely, type SqlBool } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
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

export async function searchTitles(database: Kysely<OpencodeDatabase>, capabilities: LayoutCapabilities, request: DirectSearchRequest): Promise<readonly DirectSearchHit[]> {
  validateDirectSearchRequest(request);
  if (request.title === undefined || request.requirements !== undefined) throw new Error("title search requires title patterns only");
  const rows = await selectSessions(database, capabilities, request.selector)
    .select([
      "canonical_session.id", "canonical_session.title", "canonical_session.directory", "canonical_session.slug",
      "canonical_session.project_id as projectId", "canonical_session.parent_id as parentId",
      "canonical_session.version", "canonical_session.time_created as timeCreated",
      "canonical_session.time_updated as timeUpdated",
    ])
    .where(patternSetExpression("canonical_session.title", request.title))
    .orderBy("canonical_session.time_updated", "desc")
    .limit(request.limit)
    .execute();
  return rows.map((session) => ({ backend: "direct" as const, session }));
}
