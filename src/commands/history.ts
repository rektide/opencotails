import { existsSync } from "node:fs";
import { parseDirectoryArg, parseSince } from "../args.ts";
import { emitJsonl, emitTsv, renderTable, truncate } from "../format.ts";
import { discoverDb } from "../opencode/db.ts";
import { openOpencodeLiveStore } from "@opencoattails/opencode-live-store";
import type { SessionCounts } from "../opencode/types.ts";

interface Args {
  since: string;
  limit: number;
  directory?: string;
  json: boolean;
  tsv: boolean;
  dbPath?: string;
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
      directory = parseDirectoryArg(argv[++i]);
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
  process.stdout.write(`Usage: cotail history [options]

List opencode sessions active within a time window (default: last 24h).

Options:
  --since <dur>      Cutoff: 24h, 7d, 30m, or an ISO date (default: 24h)
  --limit <n>        Max sessions returned (default: unlimited)
  --directory <path> Only sessions whose directory contains <path>
  --json             Output JSONL (one object per line)
  --tsv              Output tab-separated rows with a header line
  --db <path>        Database path (default: auto-discover)

Examples:
  cotail history                      # last 24h
  cotail history --since 7d           # last week
  cotail history --json               # JSONL
  cotail history --directory ~/src/foo
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

export async function run(argv: string[]): Promise<void> {
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

  const store = openOpencodeLiveStore(dbPath);
  try {
    const entries = await store.history({
      selector: {
        directory: args.directory === undefined ? undefined : { value: args.directory, mode: "contains" },
        updated: { from: cutoff },
      },
      countSince: cutoff,
      limit: args.limit,
    });
    const rows: SessionCounts[] = entries.map((entry) => ({
      id: entry.id, title: entry.title, directory: entry.directory, slug: entry.slug,
      time_created: entry.timeCreated, time_updated: entry.timeUpdated,
      messages_total: entry.messagesTotal, messages_recent: entry.messagesRecent,
    }));
    if (args.json) renderJson(rows);
    else if (args.tsv) renderTsv(rows);
    else renderTableOutput(rows, cutoff);
  } finally {
    await store.close();
  }
}
