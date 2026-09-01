import { createHash } from "node:crypto";
import { Effect } from "effect";
import { sql } from "kysely";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import type { DocumentWitness, WitnessName } from "../direct/witness.ts";
import type { SessionPredicate } from "../direct/session.ts";
import { sessionContext } from "./session-context.ts";
import {
  mapDocumentTarget,
  RowDecodeError,
} from "../domain/map-address.ts";
import {
  sessionAddress,
  sourceKey,
  target,
  type SourceKey,
} from "../domain/address.ts";
import { observation, projectionRevision } from "../domain/observation.ts";
import type {
  DirectEvidence,
  GroupedSession,
  GroupWindow,
  SessionSummary,
} from "../domain/results.ts";
import { sessionID } from "../domain/identifier.ts";
import type { ReadProvenance } from "../domain/observation.ts";
import type { LogicalQueryShape, QueryError } from "../query/logical-query.ts";
import type { CotailRelations, DocumentRelation } from "../relations/schema.ts";

export interface DirectSessionSearch {
  readonly witnesses: readonly DocumentWitness[];
  readonly window: GroupWindow;
  readonly evidence?: boolean;
  readonly excerptLength?: number;
  readonly sessionPredicate?: SessionPredicate;
}

export type DirectSearchError = QueryError | RowDecodeError;

interface SearchRow extends DocumentRelation {
  readonly sourceID: string;
  readonly sessionProjectID: string;
  readonly sessionSlug: string;
  readonly sessionTitle: string | null;
  readonly sessionDirectory: string;
  readonly sessionCreatedAt: number;
  readonly sessionUpdatedAt: number;
  readonly witnessName: string | null;
  readonly witnessOrder: number | null;
  readonly sessionRank: number | null;
  readonly sessionTotal: number | null;
  readonly sourceJSON?: string | null;
  readonly messageType?: string | null;
}

const documentColumns = [
  "documentKey", "ownerKind", "sessionID", "projectID", "workspaceID", "messageID",
  "contentIndex", "nestedIndex", "nativeID", "field", "text", "messageSeq",
  "messageUpdatedAt", "fieldOrder", "exposure",
] as const;

function positive(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validate(request: DirectSessionSearch): void {
  if (request.witnesses.length === 0) throw new TypeError("direct search requires at least one witness");
  const names = new Set<string>();
  for (const witness of request.witnesses) {
    if (names.has(witness.name)) throw new TypeError(`duplicate witness name: ${witness.name}`);
    names.add(witness.name);
  }
  positive("session page size", request.window.sessions.first);
  positive("childrenPerSession", request.window.childrenPerSession);
  if (request.window.globalHitLimit !== undefined) positive("globalHitLimit", request.window.globalHitLimit);
  if (request.excerptLength !== undefined) positive("excerptLength", request.excerptLength);
  const cursor = request.window.sessions.after;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor.updatedAt) || cursor.updatedAt < 0
    || cursor.sessionID.trim().length === 0)) {
    throw new TypeError("invalid Session cursor");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(sourceJSON: string, messageID: string, messageType: string): string {
  const data = JSON.parse(sourceJSON) as Record<string, unknown>;
  return createHash("sha256").update(canonical({ ...data, id: messageID, type: messageType })).digest("hex");
}

function decodeRows(
  rows: readonly SearchRow[],
  request: DirectSessionSearch,
  read: ReadProvenance,
): readonly GroupedSession<DirectEvidence>[] {
  const groups = new Map<string, {
    session: GroupedSession<DirectEvidence>["session"];
    children: DirectEvidence[];
    total: number;
    returned: number;
  }>();
  const excerptLength = request.excerptLength ?? 240;

  for (const row of rows) {
    if (row.sessionID === null) throw new RowDecodeError("qualified Session has no sessionID", row.documentKey);
    let group = groups.get(row.sessionID);
    if (group === undefined) {
      const sid = sessionID(row.sessionID);
      const summary: SessionSummary = Object.freeze({
        sessionID: row.sessionID,
        projectID: row.sessionProjectID,
        slug: row.sessionSlug,
        title: row.sessionTitle,
        directory: row.sessionDirectory,
        createdAt: row.sessionCreatedAt,
        updatedAt: row.sessionUpdatedAt,
      });
      group = {
        session: Object.freeze({ target: target(sourceKey(row.sourceID), sessionAddress(sid)), value: summary }),
        children: [],
        total: row.sessionTotal ?? 0,
        returned: 0,
      };
      groups.set(row.sessionID, group);
    }
    if (row.witnessName === null || row.sessionRank === null) continue;
    group.returned++;
    if (!request.evidence) continue;
    const documentTarget = mapDocumentTarget(sourceKey(row.sourceID), row);
    if (row.messageID !== null && (row.messageUpdatedAt === null || row.sourceJSON == null || row.messageType == null)) {
      throw new RowDecodeError("Message-owned evidence has no source revision", row.documentKey);
    }
    const revision = row.messageID === null
      ? undefined
      : projectionRevision(row.messageUpdatedAt!, payloadHash(row.sourceJSON!, row.messageID, row.messageType!));
    group.children.push(Object.freeze({
      kind: "direct",
      witness: row.witnessName as WitnessName,
      document: observation({
        target: documentTarget,
        value: Object.freeze({
          field: row.field,
          excerpt: row.text.slice(0, excerptLength),
        }),
        read,
        ...(revision === undefined ? {} : { revision }),
      }),
    }));
  }

  return Object.freeze([...groups.values()].map((group) => Object.freeze({
    session: group.session,
    children: Object.freeze(group.children),
    truncated: group.total > group.returned,
  })));
}

/**
 * Session roots are restricted by root-local facts, qualified by every
 * witness, and only then windowed. Matching-document rank and totals follow
 * selected Sessions; revision payload hydration follows selected hits and is
 * absent outside evidence mode. Witness qualification over the document world
 * remains the intentionally unbounded-by-page residual.
 */
export function directSessionSearchQuery(
  db: ReadonlyQueryCreator<CotailRelations>,
  source: SourceKey,
  request: DirectSessionSearch,
) {
  validate(request);
  const staged = db
    .with("candidate_sessions", (qb) => {
      let candidates = qb.selectFrom("cotail_session")
        .select([
          "cotail_session.sessionID",
          "cotail_session.projectID as sessionProjectID",
          "cotail_session.slug as sessionSlug",
          "cotail_session.title as sessionTitle",
          "cotail_session.directory as sessionDirectory",
          "cotail_session.createdAt as sessionCreatedAt",
          "cotail_session.updatedAt as sessionUpdatedAt",
          sql<string>`${source.sourceID}`.as("sourceID"),
        ]);
      if (request.sessionPredicate !== undefined) {
        candidates = candidates.where((eb) => request.sessionPredicate!(sessionContext(eb)));
      }
      const cursor = request.window.sessions.after;
      if (cursor !== undefined) {
        candidates = candidates.where((eb) => eb.or([
          eb("cotail_session.updatedAt", "<", cursor.updatedAt),
          eb.and([
            eb("cotail_session.updatedAt", "=", cursor.updatedAt),
            eb("cotail_session.sessionID", "<", cursor.sessionID),
          ]),
        ]));
      }
      return candidates;
    })
    .with("witness_qualified_sessions", (qb) => {
      let qualified = qb.selectFrom("candidate_sessions").selectAll();
      for (const witness of request.witnesses) {
        qualified = qualified.where((eb) => witness.forSession({
          eb,
          sessionID: eb.ref("candidate_sessions.sessionID"),
        }));
      }
      return qualified;
    })
    .with("selected_sessions", (qb) => qb
      .selectFrom("witness_qualified_sessions")
      .selectAll()
      .orderBy("sessionUpdatedAt", "desc")
      .orderBy("sessionID", "desc")
      .limit(request.window.sessions.first))
    .with("matching_documents", (qb) => {
      const branch = (witness: DocumentWitness, witnessOrder: number) => qb
        .selectFrom("selected_sessions")
        .crossJoin("cotail_document")
        .whereRef("cotail_document.sessionID", "=", "selected_sessions.sessionID")
        .where(witness.matches)
        .select([
          ...documentColumns.map((column) => `cotail_document.${column}` as const),
          "selected_sessions.sessionProjectID",
          "selected_sessions.sessionSlug",
          "selected_sessions.sessionTitle",
          "selected_sessions.sessionDirectory",
          "selected_sessions.sessionCreatedAt",
          "selected_sessions.sessionUpdatedAt",
          "selected_sessions.sourceID",
          sql<string>`${witness.name}`.as("witnessName"),
          sql<number>`${witnessOrder}`.as("witnessOrder"),
        ]);
      let matches = branch(request.witnesses[0]!, 0);
      for (const [index, witness] of request.witnesses.slice(1).entries()) {
        matches = matches.unionAll(branch(witness, index + 1));
      }
      return matches;
    })
    .with("ranked_documents", (qb) => qb
      .selectFrom("matching_documents")
      .selectAll()
      .select([
        sql<number>`row_number() over (
          partition by ${sql.ref("sessionID")}
           order by ${sql.ref("witnessOrder")}, coalesce(${sql.ref("messageSeq")}, -1), ${sql.ref("fieldOrder")},
                   ${sql.ref("documentKey")}, ${sql.ref("witnessName")}
        )`.as("sessionRank"),
        sql<number>`count(*) over (partition by ${sql.ref("sessionID")})`.as("sessionTotal"),
      ]))
    .with("session_totals", (qb) => qb.selectFrom("ranked_documents")
      .select("sessionID")
      .select((eb) => eb.fn.max("sessionTotal").as("sessionTotal"))
      .groupBy("sessionID"))
    .with("selected_hits", (qb) => {
      let hits = qb.selectFrom("ranked_documents")
        .where("sessionRank", "<=", request.window.childrenPerSession)
        .selectAll()
        .orderBy("sessionUpdatedAt", "desc")
        .orderBy("sessionID", "desc")
        .orderBy("sessionRank")
        .orderBy("documentKey")
        .orderBy("witnessName");
      if (request.window.globalHitLimit !== undefined) hits = hits.limit(request.window.globalHitLimit);
      return hits;
    });

  const sessionColumns = [
    "selected_sessions.sourceID",
    "selected_sessions.sessionID",
    "selected_sessions.sessionProjectID",
    "selected_sessions.sessionSlug",
    "selected_sessions.sessionTitle",
    "selected_sessions.sessionDirectory",
    "selected_sessions.sessionCreatedAt",
    "selected_sessions.sessionUpdatedAt",
  ] as const;
  const hitColumns = documentColumns.filter((column) => column !== "sessionID")
    .map((column) => `selected_hits.${column}` as const);

  if (!request.evidence) {
    return staged
      .selectFrom("selected_sessions")
      .leftJoin("selected_hits", "selected_hits.sessionID", "selected_sessions.sessionID")
      .leftJoin("session_totals", "session_totals.sessionID", "selected_sessions.sessionID")
      .select([
        ...sessionColumns,
        ...hitColumns,
        "selected_hits.witnessName",
        "selected_hits.witnessOrder",
        "selected_hits.sessionRank",
        "session_totals.sessionTotal",
      ])
      .orderBy("selected_sessions.sessionUpdatedAt", "desc")
      .orderBy("selected_sessions.sessionID", "desc")
      .orderBy("selected_hits.sessionRank")
      .orderBy("selected_hits.documentKey");
  }

  return staged
    .with("hydrated_hits", (qb) => qb
      .selectFrom("selected_hits")
      .leftJoin("cotail_message as evidence_message", (join) => join
        .onRef("evidence_message.sessionID", "=", "selected_hits.sessionID")
        .onRef("evidence_message.messageID", "=", "selected_hits.messageID"))
      .selectAll("selected_hits")
      .select([
        (eb) => sql<string | null>`case when ${eb.ref("evidence_message.messageID")} is null then null
          else cotail_validate_message(${eb.ref("evidence_message.messageID")},
            ${eb.ref("evidence_message.messageType")}, ${eb.ref("evidence_message.sourceJSON")}) end`.as("sourceJSON"),
        "evidence_message.messageType",
      ]))
    .selectFrom("selected_sessions")
    .leftJoin("hydrated_hits as selected_hits", "selected_hits.sessionID", "selected_sessions.sessionID")
    .leftJoin("session_totals", "session_totals.sessionID", "selected_sessions.sessionID")
    .select([
      ...sessionColumns,
      ...hitColumns,
      "selected_hits.witnessName",
      "selected_hits.witnessOrder",
      "selected_hits.sessionRank",
      "session_totals.sessionTotal",
      "selected_hits.sourceJSON",
      "selected_hits.messageType",
    ])
    .orderBy("selected_sessions.sessionUpdatedAt", "desc")
    .orderBy("selected_sessions.sessionID", "desc")
    .orderBy("selected_hits.sessionRank")
    .orderBy("selected_hits.documentKey");
}

export function searchDirectSessions(
  query: LogicalQueryShape,
  request: DirectSessionSearch,
): Effect.Effect<readonly GroupedSession<DirectEvidence>[], DirectSearchError> {
  validate(request);
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.all(({ db, source }) =>
    directSessionSearchQuery(db, source, request)).pipe(
    Effect.flatMap((rows) => Effect.try({
      try: () => decodeRows(rows as unknown as readonly SearchRow[], request, read.provenance),
      catch: (cause) => cause instanceof RowDecodeError
        ? cause
        : new RowDecodeError(cause instanceof Error ? cause.message : String(cause), null),
    })),
  ))));
}
