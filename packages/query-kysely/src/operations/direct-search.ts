import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { sql } from "kysely";
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
} from "../domain/address.ts";
import { observation, projectionRevision } from "../domain/observation.ts";
import type {
  DirectEvidence,
  GroupedSession,
  GroupWindow,
  SessionSummary,
} from "../domain/results.ts";
import { sessionID } from "../domain/identifier.ts";
import type { LogicalQueryShape, QueryError } from "../query/logical-query.ts";
import type { DocumentRelation } from "../relations/schema.ts";

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
  readonly sourceJSON: string | null;
  readonly messageType: string | null;
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
  observedAt: number,
  sourceSnapshot: string,
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
    if (row.messageID !== null && (row.messageUpdatedAt === null || row.sourceJSON === null || row.messageType === null)) {
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
        observedAt,
        sourceSnapshot,
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

export function searchDirectSessions(
  query: LogicalQueryShape,
  request: DirectSessionSearch,
): Effect.Effect<readonly GroupedSession<DirectEvidence>[], DirectSearchError> {
  validate(request);
  const observedAt = Date.now();
  const sourceSnapshot = `direct:${randomUUID()}`;

  return query.run(({ db, source }) => db
    .with("qualified_sessions", (qb) => {
      let sessions = qb.selectFrom("cotail_session")
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
        sessions = sessions.where((eb) => request.sessionPredicate!(sessionContext(eb)));
      }
      for (const witness of request.witnesses) {
        sessions = sessions.where((eb) => witness.forSession({
          eb,
          sessionID: eb.ref("cotail_session.sessionID"),
        }));
      }
      const cursor = request.window.sessions.after;
      if (cursor !== undefined) {
        sessions = sessions.where((eb) => eb.or([
          eb("cotail_session.updatedAt", "<", cursor.updatedAt),
          eb.and([
            eb("cotail_session.updatedAt", "=", cursor.updatedAt),
            eb("cotail_session.sessionID", "<", cursor.sessionID),
          ]),
        ]));
      }
      return sessions
        .orderBy("cotail_session.updatedAt", "desc")
        .orderBy("cotail_session.sessionID", "desc")
        .limit(request.window.sessions.first);
    })
    .with("matching_documents", (qb) => {
      const branch = (witness: DocumentWitness, witnessOrder: number) => qb
        .selectFrom("cotail_document")
        .innerJoin("qualified_sessions", "qualified_sessions.sessionID", "cotail_document.sessionID")
        .leftJoin("cotail_message as evidence_message", (join) => join
          .onRef("evidence_message.sessionID", "=", "cotail_document.sessionID")
          .onRef("evidence_message.messageID", "=", "cotail_document.messageID"))
        .where(witness.matches)
        .select([
          ...documentColumns.map((column) => `cotail_document.${column}` as const),
          "qualified_sessions.sessionProjectID",
          "qualified_sessions.sessionSlug",
          "qualified_sessions.sessionTitle",
          "qualified_sessions.sessionDirectory",
          "qualified_sessions.sessionCreatedAt",
          "qualified_sessions.sessionUpdatedAt",
          "qualified_sessions.sourceID",
          "evidence_message.sourceJSON",
          "evidence_message.messageType",
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
    .with("session_hits", (qb) => {
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
    })
    .selectFrom("qualified_sessions")
    .leftJoin("session_hits", "session_hits.sessionID", "qualified_sessions.sessionID")
    .leftJoin("session_totals", "session_totals.sessionID", "qualified_sessions.sessionID")
    .select([
      "qualified_sessions.sourceID",
      "qualified_sessions.sessionID",
      "qualified_sessions.sessionProjectID",
      "qualified_sessions.sessionSlug",
      "qualified_sessions.sessionTitle",
      "qualified_sessions.sessionDirectory",
      "qualified_sessions.sessionCreatedAt",
      "qualified_sessions.sessionUpdatedAt",
      ...documentColumns.filter((column) => column !== "sessionID")
        .map((column) => `session_hits.${column}` as const),
      "session_hits.witnessName",
      "session_hits.witnessOrder",
      "session_hits.sessionRank",
      "session_totals.sessionTotal",
      "session_hits.sourceJSON",
      "session_hits.messageType",
    ])
    .orderBy("qualified_sessions.sessionUpdatedAt", "desc")
    .orderBy("qualified_sessions.sessionID", "desc")
    .orderBy("session_hits.sessionRank")
    .orderBy("session_hits.documentKey"),
  ).pipe(
    Effect.flatMap((rows) => Effect.try({
      try: () => decodeRows(rows as unknown as readonly SearchRow[], request, observedAt, sourceSnapshot),
      catch: (cause) => cause instanceof RowDecodeError
        ? cause
        : new RowDecodeError(cause instanceof Error ? cause.message : String(cause), null),
    })),
  );
}
