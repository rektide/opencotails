import { existsSync } from "node:fs";
import { emitJsonl, emitTsv, renderTable, truncate } from "../format.ts";
import { discoverDb, openReadOnly } from "../opencode/db.ts";
import { countActiveSessions } from "../opencode/session.ts";
import type { SessionCounts } from "../opencode/types.ts";

interface Args {
  since: string;
  limit: number;
  directory?: string;
  json: boolean;
  tsv: boolean;
  dbPath?: string;
}

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

function parseSince(since: string): number {
  const m = /^(\d+)([smhdw])$/.exec(since);
  if (m) return Date.now() - Number(m[1]) * UNITS[m[2]]!;
  const abs = Date.parse(since);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(`--since: unrecognized time "${since}" (use e.g. 24h, 7d, 30m, or an ISO date)`);
}

function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseArgs(argv: string[]): Args {
  let since = "24h";
  let limit = 0;
  let directory: string | undefined;
  let json = false;
  let tsv = false;
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") {
      since = argv[++i];
      if (since === undefined) throw new Error("--since requires a value");
      continue;
    }
    if (a === "--limit") {
      const v = argv[++i];
      limit = v === undefined ? NaN : parseInt(v, 10);
      if (!Number.isFinite(limit) || limit < 0) throw new Error("--limit requires a non-negative number");
      continue;
    }
    if (a === "--directory") {
      directory = argv[++i];
      if (directory === undefined) throw new Error("--directory requires a path");
      continue;
    }
    if (a === "--db") {
      dbPath = argv[++i];
      if (dbPath === undefined) throw new Error("--db requires a path");
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--tsv") { tsv = true; continue; }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown option: ${a}`);
  }
  return { since, limit, directory, json, tsv, dbPath };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotails history [options]

List opencode sessions active within a time window (default: last 24h).

Options:
  --since <dur>      Cutoff: 24h, 7d, 30m, or an ISO date (default: 24h)
  --limit <n>        Max sessions returned (default: unlimited)
  --directory <path> Only sessions whose directory contains <path>
  --json             Output JSONL (one object per line)
  --tsv              Output tab-separated rows with a header line
  --db <path>        Database path (default: auto-discover)

Examples:
  cotails history                      # last 24h
  cotails history --since 7d           # last week
  cotails history --json               # JSONL
  cotails history --directory ~/src/foo
`);
}

function renderTableOutput(rows: SessionCounts[], cutoff: number): void {
  const tableRows = rows.map((r) => [
    r.id.slice(0, 14),
    truncate(r.title || "(untitled)", 34),
    truncate(r.directory, 42),
    String(r.messages_recent),
    String(r.messages_total),
    fmtLocal(r.time_updated),
  ]);
  const since = `${fmtLocal(cutoff)} (cutoff)`;
  const footer = `${rows.length} session${rows.length === 1 ? "" : "s"} active since ${since}`;
  renderTable(["ID", "TITLE", "DIRECTORY", "RECENT", "TOTAL", "UPDATED"], tableRows, footer);
}

function renderJson(rows: SessionCounts[]): void {
  emitJsonl(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      directory: r.directory,
      slug: r.slug,
      messages_recent: r.messages_recent,
      messages_total: r.messages_total,
      time_created: new Date(r.time_created).toISOString(),
      time_updated: new Date(r.time_updated).toISOString(),
    })),
  );
}

function renderTsv(rows: SessionCounts[]): void {
  emitTsv(
    ["id", "title", "directory", "messages_recent", "messages_total", "time_updated"],
    rows.map((r) => [r.id, r.title, r.directory, r.messages_recent, r.messages_total, r.time_updated]),
  );
}

export function run(argv: string[]): void {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    printHelp();
    process.exit(2);
  }

  let cutoff: number;
  try {
    cutoff = parseSince(args.since);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }

  let dbPath: string;
  try {
    dbPath = discoverDb(args.dbPath);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (!existsSync(dbPath)) {
    console.error(`db not found: ${dbPath}`);
    process.exit(1);
  }

  const db = openReadOnly(dbPath);
  try {
    const rows = countActiveSessions(db, {
      cutoff,
      directory: args.directory ?? null,
      limit: args.limit,
    });
    if (args.json) renderJson(rows);
    else if (args.tsv) renderTsv(rows);
    else renderTableOutput(rows, cutoff);
  } finally {
    db.close();
  }
}
