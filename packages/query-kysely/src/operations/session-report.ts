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

export class SessionReportDecodeError extends Error {
  public readonly sessionID: string | null;
  public readonly field: keyof SessionRelation;

  public constructor(row: SessionRelation, field: keyof SessionRelation, expected: string) {
    super(`invalid Session report ${String(field)}: expected ${expected}`);
    this.name = "SessionReportDecodeError";
    this.sessionID = typeof row.sessionID === "string" && row.sessionID.trim().length > 0
      ? row.sessionID
      : null;
    this.field = field;
  }
}

const fail = (row: SessionRelation, field: keyof SessionRelation, expected: string): never => {
  throw new SessionReportDecodeError(row, field, expected);
};

function text(row: SessionRelation, field: keyof SessionRelation, nonEmpty = false): string {
  const value = row[field];
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    return fail(row, field, nonEmpty ? "non-empty text" : "text");
  }
  return value;
}

function optionalText(row: SessionRelation, field: keyof SessionRelation): string | null {
  const value = row[field];
  return value === null ? null : text(row, field);
}

function finite(row: SessionRelation, field: keyof SessionRelation): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(row, field, "non-negative finite number");
  }
  return value;
}

function integer(row: SessionRelation, field: keyof SessionRelation): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(row, field, "non-negative safe integer");
  }
  return value;
}

function optionalInteger(row: SessionRelation, field: keyof SessionRelation): number | null {
  return row[field] === null ? null : integer(row, field);
}

/** The sole base projection for canonical Session reports. */
export function sessionReportQuery(db: ReadonlyQueryCreator<CotailRelations>) {
  return db.selectFrom("cotail_session").selectAll("cotail_session");
}

export function decodeSessionReport(
  row: SessionRelation,
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
        workspaceID: optionalText(row, "workspaceID"),
        directory: text(row, "directory", true),
        path: optionalText(row, "path"),
      },
      lineage: {
        parentSessionID: optionalText(row, "parentID"),
        forkSessionID: optionalText(row, "forkSessionID"),
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
