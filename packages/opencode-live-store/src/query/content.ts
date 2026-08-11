import { validateDirectSearchRequest, type DirectSearchHit, type DirectSearchRequest } from "@opencoattails/query-domain";
import { sql, type Expression, type Kysely, type SqlBool } from "kysely";
import { withV1Content } from "../layout/v1.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { patternSetExpression } from "./title.ts";

export async function searchV1Content(database: Kysely<OpencodeDatabase>, request: DirectSearchRequest): Promise<readonly DirectSearchHit[]> {
  validateDirectSearchRequest(request);
  if (request.requirements === undefined || request.title !== undefined) throw new Error("content search requires content requirements only");
  const allRequirements = request.requirements.all ?? [];
  const anyRequirements = request.requirements.any ?? [];
  const noneRequirements = request.requirements.none ?? [];
  if ([...allRequirements, ...anyRequirements, ...noneRequirements].some((requirement) => requirement.types.includes("shell"))) throw new Error("V1 shell content is unsupported");

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

  const witnessPredicate = (alias: "unit" | "evidence", requirement: typeof allRequirements[number]): Expression<SqlBool> => {
    const groups: Expression<SqlBool>[] = [
      sql`${sql.ref(`${alias}.session_id`)} = ${sql.ref("session.id")}`,
      sql`(${sql.join(requirement.types.map((type) => sql`${sql.ref(`${alias}.content_type`)} = ${type}`), sql` or `)})`,
      patternSetExpression(`${alias}.text`, requirement.text),
    ];
    if (requirement.roles !== undefined) groups.push(sql`(${sql.join(requirement.roles.map((role) => sql`${sql.ref(`${alias}.role`)} = ${role}`), sql` or `)})`);
    return sql`(${sql.join(groups, sql` and `)})`;
  };
  for (const requirement of allRequirements) {
    query = query.where(({ exists, selectFrom }) => exists(
      selectFrom("searchable_content as unit").select("unit.content_id").where(witnessPredicate("unit", requirement)),
    ));
  }
  if (anyRequirements.length > 0) query = query.where(({ exists, or, selectFrom }) => or(
    anyRequirements.map((requirement) => exists(
      selectFrom("searchable_content as unit").select("unit.content_id").where(witnessPredicate("unit", requirement)),
    )),
  ));
  for (const requirement of noneRequirements) query = query.where(({ exists, not, selectFrom }) => not(exists(
    selectFrom("searchable_content as unit").select("unit.content_id").where(witnessPredicate("unit", requirement)),
  )));
  if (request.evidence) {
    const positive = [...allRequirements, ...anyRequirements];
    if (positive.length > 0) query = query.select((expression) => {
      const candidates = positive.map((requirement) => {
        return expression.selectFrom("searchable_content as evidence")
          .select("evidence.evidence_text")
          .where(witnessPredicate("evidence", requirement))
          .orderBy("evidence.ordinal_major").orderBy("evidence.ordinal_minor")
          .orderBy("evidence.content_id").limit(1);
      });
      return candidates.length === 1
        ? candidates[0]!.as("evidenceText")
        : sql<string | null>`coalesce(${sql.join(candidates, sql`, `)})`.as("evidenceText");
    });
  }
  const rows = await query.orderBy("session.time_updated", "desc").limit(request.limit).execute();
  return rows.map((row) => {
    const { evidenceText, ...session } = row as typeof row & { evidenceText?: string | null };
    return { backend: "direct" as const, session, ...(evidenceText == null ? {} : { evidenceText }) };
  });
}
