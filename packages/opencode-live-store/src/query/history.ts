import { validateHistoryRequest, type HistoryEntry, type HistoryRequest } from "@opencoattails/query-domain";
import { sql, type Kysely } from "kysely";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { selectSessions } from "./selector.ts";

export async function readHistory(
  database: Kysely<OpencodeDatabase>,
  capabilities: LayoutCapabilities,
  request: HistoryRequest,
): Promise<readonly HistoryEntry[]> {
  validateHistoryRequest(request);
  const v1Total = sql<number>`(select count(*) from message m where m.session_id = canonical_session.id)`;
  const v1Recent = sql<number>`(select count(*) from message m where m.session_id = canonical_session.id and m.time_created >= ${request.countSince})`;
  const v2Total = sql<number>`(select count(*) from session_message sm where sm.session_id = canonical_session.id)`;
  const v2Recent = sql<number>`(select count(*) from session_message sm where sm.session_id = canonical_session.id and sm.time_created >= ${request.countSince})`;
  const total = !capabilities.v2
    ? v1Total
    : !capabilities.v1
      ? v2Total
      : sql<number>`case when exists (select 1 from session_v2 v where v.id = canonical_session.id) then ${v2Total} else ${v1Total} end`;
  const recent = !capabilities.v2
    ? v1Recent
    : !capabilities.v1
      ? v2Recent
      : sql<number>`case when exists (select 1 from session_v2 v where v.id = canonical_session.id) then ${v2Recent} else ${v1Recent} end`;

  const rows = await selectSessions(database, capabilities, request.selector)
    .select([
      "canonical_session.id", "canonical_session.title", "canonical_session.directory", "canonical_session.slug",
      "canonical_session.project_id as projectId", "canonical_session.parent_id as parentId",
      "canonical_session.version", "canonical_session.time_created as timeCreated",
      "canonical_session.time_updated as timeUpdated",
      total.as("messagesTotal"), recent.as("messagesRecent"),
    ])
    .orderBy("canonical_session.time_updated", "desc")
    .limit(request.limit === 0 ? -1 : request.limit)
    .execute();
  return rows.map((row) => ({ ...row }));
}
