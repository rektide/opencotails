import type { SessionSelector } from "@opencoattails/query-domain";
import { sql, type Kysely, type SelectQueryBuilder, type SqlBool } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";

export function selectSessions(database: Kysely<OpencodeDatabase>, selector: SessionSelector): SelectQueryBuilder<OpencodeDatabase, "session", {}> {
  let query = database.selectFrom("session");
  if (selector.ids !== undefined) query = query.where("session.id", "in", selector.ids);
  if (selector.projectIds !== undefined) query = query.where("session.project_id", "in", selector.projectIds);
  if (selector.directory !== undefined) {
    query = selector.directory.mode === "exact"
      ? query.where("session.directory", "=", selector.directory.value)
      : query.where(sql<SqlBool>`instr(session.directory, ${selector.directory.value}) > 0`);
  }
  if (selector.updated?.from !== undefined) query = query.where("session.time_updated", ">=", selector.updated.from);
  if (selector.updated?.to !== undefined) query = query.where("session.time_updated", "<", selector.updated.to);
  return query;
}
