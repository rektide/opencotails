import type { SessionSelector } from "@opencoattails/query-domain";
import { sql, type Kysely, type SqlBool } from "kysely";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { withCanonicalSessions } from "./session-root.ts";

export function selectSessions(database: Kysely<OpencodeDatabase>, capabilities: LayoutCapabilities, selector: SessionSelector) {
  let query = withCanonicalSessions(database, capabilities).selectFrom("canonical_session");
  if (selector.ids !== undefined) query = query.where("canonical_session.id", "in", selector.ids);
  if (selector.projectIds !== undefined) query = query.where("canonical_session.project_id", "in", selector.projectIds);
  if (selector.directory !== undefined) {
    query = selector.directory.mode === "exact"
      ? query.where("canonical_session.directory", "=", selector.directory.value)
      : query.where(sql<SqlBool>`instr(canonical_session.directory, ${selector.directory.value}) > 0`);
  }
  if (selector.updated?.from !== undefined) query = query.where("canonical_session.time_updated", ">=", selector.updated.from);
  if (selector.updated?.to !== undefined) query = query.where("canonical_session.time_updated", "<", selector.updated.to);
  return query;
}
