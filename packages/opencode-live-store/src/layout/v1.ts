import { sql, type Kysely } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";

export function withV1Content(database: Kysely<OpencodeDatabase>) {
  return database.with("searchable_content", (query) => query
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
      sql<"v1-part">`'v1-part'`.as("layout"),
    ]));
}
