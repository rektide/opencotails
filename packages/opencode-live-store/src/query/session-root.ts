import { sql, type Kysely } from "kysely";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";

const columns = [
  "id", "project_id", "parent_id", "slug", "directory", "title", "version",
  "time_created", "time_updated",
] as const;

export function withCanonicalSessions(database: Kysely<OpencodeDatabase>, capabilities: LayoutCapabilities) {
  return database.with("canonical_session", (query) => {
    if (!capabilities.v2) return query.selectFrom("session").select(columns);
    const native = query.selectFrom("session_v2").select(columns);
    if (!capabilities.v1) return native;
    return native.unionAll(
      query.selectFrom("session").select(columns).where(({ not, exists, selectFrom }) => not(exists(
        selectFrom("session_v2").select(sql<number>`1`.as("one")).whereRef("session_v2.id", "=", "session.id"),
      )))
    );
  });
}
