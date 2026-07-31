import { existsSync } from "node:fs";
import { C, emitJsonl } from "../format.ts";
import { discoverDb, openReadOnly, registerRegex } from "../opencode/db.ts";
import { detectSources } from "../opencode/source.ts";
import type { ContentQuery, PartType, SearchHit } from "../opencode/types.ts";

interface Args {
  terms: string[];
  dbPath?: string;
  limit: number;
  json: boolean;
  titleOnly: boolean;
  showSnippet: boolean;
  typeFilter: PartType;
  caseSensitive: boolean;
  fixedStrings: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternFor(term: string, fixedStrings: boolean): string {
  return fixedStrings ? escapeRegex(term) : term;
}

function buildTitleQuery(args: Args): { sql: string; params: unknown[] } {
  const where = args.terms.map(() => "re(?, title)").join(" AND ");
  const sql = `SELECT id, slug, title, directory,
                      datetime(time_created/1000, 'unixepoch') AS created,
                      datetime(time_updated/1000, 'unixepoch') AS updated
               FROM session
               WHERE ${where}
               ORDER BY time_updated DESC LIMIT ?`;
  return {
    sql,
    params: [...args.terms.map((t) => patternFor(t, args.fixedStrings)), args.limit],
  };
}

function contentRows(db: Parameters<typeof registerRegex>[0], args: Args): SearchHit[] {
  const q: ContentQuery = {
    patterns: args.terms.map((t) => patternFor(t, args.fixedStrings)),
    typeFilter: args.typeFilter,
    showSnippet: args.showSnippet,
    limit: args.limit,
  };
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const source of detectSources(db)) {
    for (const h of source.searchContent(q)) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        hits.push(h);
      }
    }
  }
  return hits;
}

function renderHuman(rows: SearchHit[], showSnippet: boolean): void {
  if (rows.length === 0) {
    process.stdout.write(`${C.grey}no sessions matched${C.reset}\n`);
    return;
  }
  for (const r of rows) {
    const id = r.id ? r.id.slice(0, 12) : "";
    const title = r.title || "(untitled)";
    const updated = r.updated || "";
    const created = r.created || "";
    const when = created && updated && created !== updated
      ? `${created} → ${updated}`
      : (updated || created);
    const slug = r.slug || "";
    const directory = r.directory || "";
    process.stdout.write(
      `${C.green}${id}${C.reset} ${C.bold}${title}${C.reset} ${C.grey}${when}${C.reset}\n`,
    );
    const meta = [slug, directory].filter(Boolean).join(" · ");
    if (meta) process.stdout.write(`${C.grey}  ${meta}${C.reset}\n`);
    if (showSnippet && r.snippet) {
      const snip = r.snippet.replace(/\s+/g, " ").trim().slice(0, 180);
      process.stdout.write(`${C.cyan}  ${snip}${C.reset}\n`);
    }
  }
  process.stdout.write(
    `${C.grey}${rows.length} session${rows.length === 1 ? "" : "s"}${C.reset}\n`,
  );
}

function parseArgs(argv: string[]): Args {
  const terms: string[] = [];
  let dbPath: string | undefined;
  let limit = 50;
  let json = false;
  let titleOnly = false;
  let showSnippet = true;
  let typeFilter: PartType = "text";
  let caseSensitive = false;
  let fixedStrings = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      dbPath = argv[++i];
      if (dbPath === undefined) throw new Error("--db requires a path");
      continue;
    }
    if (a === "--limit") {
      const v = argv[++i];
      limit = v === undefined ? NaN : parseInt(v, 10);
      if (!Number.isFinite(limit) || limit < 0) throw new Error("--limit requires a number");
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--title-only") { titleOnly = true; continue; }
    if (a === "--no-snippet") { showSnippet = false; continue; }
    if (a === "-s" || a === "--case-sensitive") { caseSensitive = true; continue; }
    if (a === "-F" || a === "--fixed-strings") { fixedStrings = true; continue; }
    if (a === "--type") {
      const v = argv[++i];
      if (v !== "text" && v !== "reasoning" && v !== "tool") {
        throw new Error(`--type must be text|reasoning|tool, got: ${v}`);
      }
      typeFilter = v;
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    terms.push(a);
  }
  return { terms, dbPath, limit, json, titleOnly, showSnippet, typeFilter, caseSensitive, fixedStrings };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotails search <pattern> [pattern...] [options]

Search opencode sessions for content matching ALL given terms.
Terms are matched as case-insensitive regular expressions (AND'd together).

Options:
  --db <path>      Database path (default: auto-discover)
  --limit <n>      Max results (default: 50)
  --json           Output JSONL instead of human-readable
  --title-only     Search session titles only
  --no-snippet     Don't show text snippet
  --type <type>    Part type to search: text, reasoning, tool (default: text)
  -F, --fixed-strings   Treat patterns as literal strings, not regex
  -s, --case-sensitive  Match case sensitively (default: case-insensitive)

Examples:
  cotails search opencode journal          # sessions matching "opencode" and "journal"
  cotails search 'event.*v2'               # regex: "event" ... "v2"
  cotails search turso wal --json          # JSONL output
  cotails search --title-only compaction   # search titles only
`);
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
  if (args.terms.length === 0) {
    printHelp();
    process.exit(1);
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
    registerRegex(db, args.caseSensitive);
    let rows: SearchHit[];
    if (args.titleOnly) {
      const q = buildTitleQuery(args);
      rows = db.prepare(q.sql).all(...q.params) as SearchHit[];
    } else {
      rows = contentRows(db, args);
    }
    if (args.json) emitJsonl(rows);
    else renderHuman(rows, args.showSnippet);
  } finally {
    db.close();
  }
}
