import { sql, type Kysely } from "kysely";
import type { OpencodeDatabase } from "../schema/tables.ts";

export function v2Content(query: Kysely<OpencodeDatabase>) {
  const users = query.selectFrom("session_message")
    .innerJoin("session_v2", "session_v2.id", "session_message.session_id")
    .select([
      "session_message.session_id as session_id",
      "session_message.id as content_id",
      sql<string>`'text'`.as("content_type"),
      sql<string>`'user'`.as("role"),
      sql<string>`json_extract(session_message.data, '$.text')`.as("text"),
      sql<string>`json_extract(session_message.data, '$.text')`.as("evidence_text"),
      "session_message.seq as ordinal_major",
      sql<number>`0`.as("ordinal_minor"),
      sql<string>`'v2-session-message'`.as("layout"),
    ])
    .where("session_message.type", "=", "user");

  const assistants = query.selectFrom("session_message")
    .innerJoin("session_v2", "session_v2.id", "session_message.session_id")
    .innerJoin(sql<{ key: string; value: string }>`json_each(session_message.data, '$.content')`.as("item"), (join) => join.onTrue())
    .select([
      "session_message.session_id as session_id",
      sql<string>`session_message.id || ':' || item.key`.as("content_id"),
      sql<string>`json_extract(item.value, '$.type')`.as("content_type"),
      sql<string>`'assistant'`.as("role"),
      sql<string>`json_extract(item.value, '$.text')`.as("text"),
      sql<string>`json_extract(item.value, '$.text')`.as("evidence_text"),
      "session_message.seq as ordinal_major",
      sql<number>`cast(item.key as integer)`.as("ordinal_minor"),
      sql<string>`'v2-session-message'`.as("layout"),
    ])
    .where("session_message.type", "=", "assistant")
    .where(sql`json_extract(item.value, '$.type')`, "in", ["text", "reasoning"]);

  return users.unionAll(assistants);
}
