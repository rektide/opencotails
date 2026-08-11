import { validateDirectSearchRequest, type DirectSearchHit, type DirectSearchRequest } from "@opencoattails/query-domain";
import { sql, type Kysely, type SqlBool } from "kysely";
import { withV1Content } from "../layout/v1.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { patternSetExpression } from "./title.ts";

export async function searchV1Content(database: Kysely<OpencodeDatabase>, request: DirectSearchRequest): Promise<readonly DirectSearchHit[]> {
  validateDirectSearchRequest(request);
  if (request.requirements === undefined || request.title !== undefined) throw new Error("content search requires content requirements only");
  if (request.requirements.any !== undefined || request.requirements.none !== undefined) throw new Error("requirement any/none lowering not implemented");
  if (request.requirements.all?.some((requirement) => requirement.types.includes("shell"))) throw new Error("V1 shell content is unsupported");

  const normalized = withV1Content(database);
  let query = normalized.selectFrom("session").select([
    "session.id", "session.title", "session.directory", "session.slug",
    "session.project_id as projectId", "session.parent_id as parentId", "session.version",
    "session.time_created as timeCreated", "session.time_updated as timeUpdated",
  ]);
  const selector = request.selector;
  if (selector.ids !== undefined) query = query.where("session.id", "in", selector.ids);
  if (selector.projectIds !== undefined) query = query.where("session.project_id", "in", selector.projectIds);
  if (selector.directory !== undefined) query = selector.directory.mode === "exact"
    ? query.where("session.directory", "=", selector.directory.value)
    : query.where(sql<SqlBool>`instr(session.directory, ${selector.directory.value}) > 0`);
  if (selector.updated?.from !== undefined) query = query.where("session.time_updated", ">=", selector.updated.from);
  if (selector.updated?.to !== undefined) query = query.where("session.time_updated", "<", selector.updated.to);

  for (const requirement of request.requirements.all ?? []) {
    query = query.where(({ exists, selectFrom }) => {
      let witness = selectFrom("searchable_content as unit")
        .select("unit.content_id")
        .whereRef("unit.session_id", "=", "session.id")
        .where("unit.content_type", "in", requirement.types)
        .where(patternSetExpression("unit.text", requirement.text));
      if (requirement.roles !== undefined) witness = witness.where("unit.role", "in", requirement.roles);
      return exists(witness);
    });
  }
  if (request.evidence) {
    const first = request.requirements.all?.[0];
    if (first !== undefined) query = query.select((expression) => {
      let witness = expression.selectFrom("searchable_content as evidence")
        .select("evidence.evidence_text")
        .whereRef("evidence.session_id", "=", "session.id")
        .where("evidence.content_type", "in", first.types)
        .where(patternSetExpression("evidence.text", first.text));
      if (first.roles !== undefined) witness = witness.where("evidence.role", "in", first.roles);
      return witness.orderBy("evidence.ordinal_major").orderBy("evidence.ordinal_minor")
        .orderBy("evidence.content_id").limit(1).as("evidenceText");
    });
  }
  const rows = await query.orderBy("session.time_updated", "desc").limit(request.limit).execute();
  return rows.map((row) => {
    const { evidenceText, ...session } = row as typeof row & { evidenceText?: string | null };
    return { backend: "direct" as const, session, ...(evidenceText == null ? {} : { evidenceText }) };
  });
}
