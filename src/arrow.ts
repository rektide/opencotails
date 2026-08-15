import {
  Field,
  Int64,
  Schema,
  Table,
  TimestampMillisecond,
  Utf8,
  tableToIPC,
  vectorFromArray,
  type Vector,
} from "apache-arrow";
import type { SessionSummary } from "@opencoattails/query-domain";
import type { SearchHit, SessionCounts } from "./opencode/types.ts";

const utf8 = new Utf8();
const int64 = new Int64();
const timestampMs = new TimestampMillisecond();

const searchSchema = new Schema([
  new Field("id", utf8, false),
  new Field("slug", utf8, false),
  new Field("title", utf8, false),
  new Field("directory", utf8, false),
  new Field("time_created", timestampMs, false),
  new Field("time_updated", timestampMs, false),
  new Field("evidence_text", utf8, true),
]);

const historySchema = new Schema([
  new Field("id", utf8, false),
  new Field("title", utf8, false),
  new Field("directory", utf8, false),
  new Field("slug", utf8, false),
  new Field("messages_recent", int64, false),
  new Field("messages_total", int64, false),
  new Field("time_created", timestampMs, false),
  new Field("time_updated", timestampMs, false),
]);

const sessionSchema = new Schema([
  new Field("id", utf8, false),
  new Field("title", utf8, false),
  new Field("directory", utf8, false),
  new Field("slug", utf8, false),
  new Field("project_id", utf8, false),
  new Field("parent_id", utf8, true),
  new Field("version", utf8, false),
  new Field("time_created", timestampMs, false),
  new Field("time_updated", timestampMs, false),
]);

function searchDate(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

async function emit(schema: Schema, rowCount: number, columns: Record<string, Vector>): Promise<void> {
  const table = rowCount === 0 ? new Table(schema) : new Table(schema, columns);
  const bytes = tableToIPC(table, "stream");
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, (error) => error ? reject(error) : resolve());
  });
}

export async function emitSearchArrow(rows: readonly SearchHit[]): Promise<void> {
  await emit(searchSchema, rows.length, {
    id: vectorFromArray(rows.map((row) => row.id), utf8),
    slug: vectorFromArray(rows.map((row) => row.slug), utf8),
    title: vectorFromArray(rows.map((row) => row.title), utf8),
    directory: vectorFromArray(rows.map((row) => row.directory), utf8),
    time_created: vectorFromArray(rows.map((row) => searchDate(row.created)), timestampMs),
    time_updated: vectorFromArray(rows.map((row) => searchDate(row.updated)), timestampMs),
    evidence_text: vectorFromArray(rows.map((row) => row.snippet ?? null), utf8),
  });
}

export async function emitHistoryArrow(rows: readonly SessionCounts[]): Promise<void> {
  await emit(historySchema, rows.length, {
    id: vectorFromArray(rows.map((row) => row.id), utf8),
    title: vectorFromArray(rows.map((row) => row.title), utf8),
    directory: vectorFromArray(rows.map((row) => row.directory), utf8),
    slug: vectorFromArray(rows.map((row) => row.slug), utf8),
    messages_recent: vectorFromArray(rows.map((row) => BigInt(row.messages_recent)), int64),
    messages_total: vectorFromArray(rows.map((row) => BigInt(row.messages_total)), int64),
    time_created: vectorFromArray(rows.map((row) => new Date(row.time_created)), timestampMs),
    time_updated: vectorFromArray(rows.map((row) => new Date(row.time_updated)), timestampMs),
  });
}

export async function emitSessionArrow(rows: readonly SessionSummary[]): Promise<void> {
  await emit(sessionSchema, rows.length, {
    id: vectorFromArray(rows.map((row) => row.id), utf8),
    title: vectorFromArray(rows.map((row) => row.title), utf8),
    directory: vectorFromArray(rows.map((row) => row.directory), utf8),
    slug: vectorFromArray(rows.map((row) => row.slug), utf8),
    project_id: vectorFromArray(rows.map((row) => row.projectId), utf8),
    parent_id: vectorFromArray(rows.map((row) => row.parentId), utf8),
    version: vectorFromArray(rows.map((row) => row.version), utf8),
    time_created: vectorFromArray(rows.map((row) => new Date(row.timeCreated)), timestampMs),
    time_updated: vectorFromArray(rows.map((row) => new Date(row.timeUpdated)), timestampMs),
  });
}
