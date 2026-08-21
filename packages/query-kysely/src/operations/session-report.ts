import type { ReadonlyQueryCreator } from "kysely/readonly";
import {
  observation,
  type ReadProvenance,
} from "../domain/observation.ts";
import {
  sessionAddress,
  target,
  type SourceKey,
} from "../domain/address.ts";
import { sessionID } from "../domain/identifier.ts";
import type { SessionReportObservation } from "../domain/session-report.ts";
import type { CotailRelations, SessionRelation } from "../relations/schema.ts";

const sessionReportColumns = [
  "cotail_session.sessionID", "cotail_session.projectID", "cotail_session.workspaceID",
  "cotail_session.parentID", "cotail_session.forkSessionID", "cotail_session.forkBoundary",
  "cotail_session.slug", "cotail_session.directory", "cotail_session.path", "cotail_session.title",
  "cotail_session.version", "cotail_session.shareURL", "cotail_session.summaryAdditions",
  "cotail_session.summaryDeletions", "cotail_session.summaryFiles", "cotail_session.cost",
  "cotail_session.tokensInput", "cotail_session.tokensOutput", "cotail_session.tokensReasoning",
  "cotail_session.tokensCacheRead", "cotail_session.tokensCacheWrite", "cotail_session.agent",
  "cotail_session.model", "cotail_session.createdAt", "cotail_session.updatedAt",
  "cotail_session.compactingAt", "cotail_session.archivedAt", "cotail_session.suspendedAt",
] as const satisfies readonly `cotail_session.${Extract<keyof SessionRelation, string>}`[];

type Unqualified<T> = T extends `cotail_session.${infer Field}` ? Field : never;
export type SessionReportRow = Pick<SessionRelation, Unqualified<typeof sessionReportColumns[number]>>;

export class SessionReportDecodeError extends Error {
  public readonly sessionID: string | null;
  public readonly field: keyof SessionReportRow;

  public constructor(row: SessionReportRow, field: keyof SessionReportRow, expected: string) {
    super(`invalid Session report ${String(field)}: expected ${expected}`);
    this.name = "SessionReportDecodeError";
    this.sessionID = typeof row.sessionID === "string" && row.sessionID.trim().length > 0
      ? row.sessionID
      : null;
    this.field = field;
  }
}

const fail = (row: SessionReportRow, field: keyof SessionReportRow, expected: string): never => {
  throw new SessionReportDecodeError(row, field, expected);
};

function text(row: SessionReportRow, field: keyof SessionReportRow, nonEmpty = false): string {
  const value = row[field];
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    return fail(row, field, nonEmpty ? "non-empty text" : "text");
  }
  return value;
}

function optionalText(row: SessionReportRow, field: keyof SessionReportRow): string | null {
  const value = row[field];
  return value === null ? null : text(row, field);
}

function optionalID(row: SessionReportRow, field: keyof SessionReportRow): string | null {
  return row[field] === null ? null : text(row, field, true);
}

function finite(row: SessionReportRow, field: keyof SessionReportRow): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(row, field, "non-negative finite number");
  }
  return value;
}

function integer(row: SessionReportRow, field: keyof SessionReportRow): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(row, field, "non-negative safe integer");
  }
  return value;
}

function optionalInteger(row: SessionReportRow, field: keyof SessionReportRow): number | null {
  return row[field] === null ? null : integer(row, field);
}

/** The sole base projection for canonical Session reports. */
export function sessionReportQuery(db: ReadonlyQueryCreator<CotailRelations>) {
  return db.selectFrom("cotail_session").select(sessionReportColumns);
}

export function decodeSessionReport(
  row: SessionReportRow,
  source: SourceKey,
  read: ReadProvenance,
): SessionReportObservation {
  const sid = sessionID(text(row, "sessionID", true));
  return observation({
    target: target(source, sessionAddress(sid)),
    value: {
      title: optionalText(row, "title"),
      slug: text(row, "slug", true),
      location: {
        projectID: text(row, "projectID", true),
        workspaceID: optionalID(row, "workspaceID"),
        directory: text(row, "directory", true),
        path: optionalText(row, "path"),
      },
      lineage: {
        parentSessionID: optionalID(row, "parentID"),
        forkSessionID: optionalID(row, "forkSessionID"),
        forkBoundary: optionalText(row, "forkBoundary"),
      },
      run: {
        version: text(row, "version", true),
        agent: optionalText(row, "agent"),
        model: optionalText(row, "model"),
      },
      usage: {
        cost: finite(row, "cost"),
        tokens: {
          input: integer(row, "tokensInput"),
          output: integer(row, "tokensOutput"),
          reasoning: integer(row, "tokensReasoning"),
          cache: {
            read: integer(row, "tokensCacheRead"),
            write: integer(row, "tokensCacheWrite"),
          },
        },
      },
      summary: {
        additions: optionalInteger(row, "summaryAdditions"),
        deletions: optionalInteger(row, "summaryDeletions"),
        files: optionalInteger(row, "summaryFiles"),
      },
      shareURL: optionalText(row, "shareURL"),
      lifecycle: {
        createdAt: integer(row, "createdAt"),
        updatedAt: integer(row, "updatedAt"),
        compactingAt: optionalInteger(row, "compactingAt"),
        archivedAt: optionalInteger(row, "archivedAt"),
        suspendedAt: optionalInteger(row, "suspendedAt"),
      },
    },
    read,
  });
}
