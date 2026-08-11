import type { ResolveRequest, SessionSummary } from "@opencoattails/query-domain";
import type { Kysely } from "kysely";
import { validateResolveRequest } from "@opencoattails/query-domain";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { selectSessions } from "./selector.ts";

export async function resolveSession(database: Kysely<OpencodeDatabase>, request: ResolveRequest): Promise<SessionSummary | undefined> {
  validateResolveRequest(request);
  const rows = await selectSessions(database, request.selector)
    .select([
      "session.id as id",
      "session.title as title",
      "session.directory as directory",
      "session.slug as slug",
      "session.project_id as projectId",
      "session.parent_id as parentId",
      "session.version as version",
      "session.time_created as timeCreated",
      "session.time_updated as timeUpdated",
    ])
    .orderBy("session.time_updated", "desc")
    .orderBy("session.id", "asc")
    .limit(request.mode === "only" ? 2 : 1)
    .execute();
  if (request.mode === "only" && rows.length !== 1) return undefined;
  return rows[0];
}
