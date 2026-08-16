import type { ReadonlyQueryCreator } from "kysely/readonly";
import type { Kysely } from "kysely";
import type { PhysicalOpenCodeV2 } from "../source/contracts.ts";
import type { CotailRelations } from "./schema.ts";

export function logicalWorld(
  physical: Kysely<PhysicalOpenCodeV2>,
): ReadonlyQueryCreator<CotailRelations> {
  const seeded = physical
    .with("cotail_session", (db) => db.selectFrom("session_v2").select([
      "id as sessionID",
      "project_id as projectID",
      "workspace_id as workspaceID",
      "parent_id as parentID",
      "fork_session_id as forkSessionID",
      "fork_boundary as forkBoundary",
      "slug",
      "directory",
      "path",
      "title",
      "version",
      "share_url as shareURL",
      "summary_additions as summaryAdditions",
      "summary_deletions as summaryDeletions",
      "summary_files as summaryFiles",
      "summary_diffs as summaryDiffsJSON",
      "metadata as metadataJSON",
      "cost",
      "tokens_input as tokensInput",
      "tokens_output as tokensOutput",
      "tokens_reasoning as tokensReasoning",
      "tokens_cache_read as tokensCacheRead",
      "tokens_cache_write as tokensCacheWrite",
      "revert as revertJSON",
      "permission as permissionJSON",
      "agent",
      "model",
      "time_created as createdAt",
      "time_updated as updatedAt",
      "time_compacting as compactingAt",
      "time_archived as archivedAt",
      "time_suspended as suspendedAt",
    ]))
    .with("cotail_message", (db) => db.selectFrom("session_message").select([
      "session_id as sessionID",
      "id as messageID",
      "type as messageType",
      "seq as messageSeq",
      "time_created as createdAt",
      "time_updated as updatedAt",
      "data as sourceJSON",
    ]));

  // Kysely retains physical members in a CTE database type. This is the sole
  // audited narrowing from the validated physical schema to the logical world.
  return seeded as unknown as ReadonlyQueryCreator<CotailRelations>;
}
