import { sql, type Kysely } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";

export function v1Content(database: Kysely<OpencodeDatabase>, excludeV2Owners: boolean) {
  let query = database
    .selectFrom("part")
    .innerJoin("message", "message.id", "part.message_id")
    .select([
      "part.session_id as session_id",
      "part.id as content_id",
      sql<string>`json_extract(part.data, '$.type')`.as("content_type"),
      sql<string>`json_extract(message.data, '$.role')`.as("role"),
      sql<string>`case when json_extract(part.data, '$.type') = 'tool' then part.data else json_extract(part.data, '$.text') end`.as("text"),
      sql<string>`case when json_extract(part.data, '$.type') = 'tool' then json_extract(part.data, '$.state.input') else json_extract(part.data, '$.text') end`.as("evidence_text"),
      "part.time_created as ordinal_major",
      sql<number>`0`.as("ordinal_minor"),
      sql<string>`'v1-part'`.as("layout"),
    ]);
  if (excludeV2Owners) query = query.where(({ not, exists, selectFrom }) => not(exists(
    selectFrom("session_v2").select(sql<number>`1`.as("one")).whereRef("session_v2.id", "=", "part.session_id"),
  )));
  return query;
}
