import { validateDirectSearchRequest, type DirectSearchHit, type DirectSearchRequest } from "@opencoattails/query-domain";
import { sql, type Expression, type Kysely, type SqlBool } from "kysely";
import { v1Content } from "../layout/v1.ts";
import { v2Content } from "../layout/v2.ts";
import type { LayoutCapabilities } from "../schema/capabilities.ts";
import type { OpencodeDatabase } from "../schema/tables.ts";
import { patternSetExpression } from "./title.ts";
import { withCanonicalSessions } from "./session-root.ts";

export async function searchContent(database: Kysely<OpencodeDatabase>, capabilities: LayoutCapabilities, request: DirectSearchRequest): Promise<readonly DirectSearchHit[]> {
  validateDirectSearchRequest(request);
  if (request.requirements === undefined || request.title !== undefined) throw new Error("content search requires content requirements only");
  const allRequirements = request.requirements.all ?? [];
  const anyRequirements = request.requirements.any ?? [];
  const noneRequirements = request.requirements.none ?? [];
  const types = [...allRequirements, ...anyRequirements, ...noneRequirements].flatMap((requirement) => requirement.types);
  if (types.includes("shell")) throw new Error("shell content search is unsupported");
  if (capabilities.v2 && types.includes("tool")) throw new Error("V2 tool content search is unsupported");

  const sessions = withCanonicalSessions(database, capabilities);
  const normalized = sessions.with("searchable_content", () => {
    if (!capabilities.v2) return v1Content(database, false);
    const native = v2Content(database);
    return capabilities.v1 ? native.unionAll(v1Content(database, true)) : native;
  });
  let query = normalized.selectFrom("canonical_session").select([
    "canonical_session.id", "canonical_session.title", "canonical_session.directory", "canonical_session.slug",
    "canonical_session.project_id as projectId", "canonical_session.parent_id as parentId", "canonical_session.version",
    "canonical_session.time_created as timeCreated", "canonical_session.time_updated as timeUpdated",
  ]);
  const selector = request.selector;
  if (selector.ids !== undefined) query = query.where("canonical_session.id", "in", selector.ids);
  if (selector.projectIds !== undefined) query = query.where("canonical_session.project_id", "in", selector.projectIds);
  if (selector.directory !== undefined) query = selector.directory.mode === "exact"
      ? query.where("canonical_session.directory", "=", selector.directory.value)
      : query.where(sql<SqlBool>`instr(canonical_session.directory, ${selector.directory.value}) > 0`);
  if (selector.updated?.from !== undefined) query = query.where("canonical_session.time_updated", ">=", selector.updated.from);
  if (selector.updated?.to !== undefined) query = query.where("canonical_session.time_updated", "<", selector.updated.to);

  const witnessPredicate = (alias: "unit" | "evidence", requirement: typeof allRequirements[number]): Expression<SqlBool> => {
    const groups: Expression<SqlBool>[] = [
      sql`${sql.ref(`${alias}.session_id`)} = ${sql.ref("canonical_session.id")}`,
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
  const rows = await query.orderBy("canonical_session.time_updated", "desc").limit(request.limit).execute();
  return rows.map((row) => {
    const { evidenceText, ...session } = row as typeof row & { evidenceText?: string | null };
    return { backend: "direct" as const, session, ...(evidenceText == null ? {} : { evidenceText }) };
  });
}
