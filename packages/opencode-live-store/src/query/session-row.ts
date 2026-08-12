import type { ResolveRequest, SessionSummary } from "@opencoattails/query-domain";
import type { Kysely } from "kysely";
import { validateResolveRequest } from "@opencoattails/query-domain";
import type { OpencodeDatabase } from "../schema/tables.ts";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
import { selectSessions } from "./selector.ts";

export async function resolveSession(database: Kysely<OpencodeDatabase>, capabilities: LayoutCapabilities, request: ResolveRequest): Promise<SessionSummary | undefined> {
  validateResolveRequest(request);
  const rows = await selectSessions(database, capabilities, request.selector)
    .select([
      "canonical_session.id as id",
      "canonical_session.title as title",
      "canonical_session.directory as directory",
      "canonical_session.slug as slug",
      "canonical_session.project_id as projectId",
      "canonical_session.parent_id as parentId",
      "canonical_session.version as version",
      "canonical_session.time_created as timeCreated",
      "canonical_session.time_updated as timeUpdated",
    ])
    .orderBy("canonical_session.time_updated", "desc")
    .orderBy("canonical_session.id", "asc")
    .limit(request.mode === "only" ? 2 : 1)
    .execute();
  if (request.mode === "only" && rows.length !== 1) return undefined;
  return rows[0];
}
