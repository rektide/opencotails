#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const isTTY = process.stdout.isTTY;
const C = {
  green: isTTY ? "\x1b[32m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  grey: isTTY ? "\x1b[90m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  reset: isTTY ? "\x1b[0m" : "",
};

type PartType = "text" | "reasoning" | "tool";
type Mode = "v1" | "v2";

interface Schema {
  table: string;
  sessionRef: string;
  typeExpr: string;
  textExpr: string;
  snippetExpr: string;
  orderCol: string;
}

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

function registerRegex(db: DatabaseSync, caseSensitive: boolean): void {
  const flags = caseSensitive ? "" : "i";
  const cache = new Map<string, RegExp>();
  db.function("re", { deterministic: true }, (pattern: string, string: unknown) => {
    if (string == null) return 0;
    let re = cache.get(pattern);
    if (!re) {
      re = new RegExp(pattern, flags);
      cache.set(pattern, re);
    }
    return re.test(String(string)) ? 1 : 0;
  });
}

function discoverDb(override?: string): string {
  if (override) return override;
  const env = process.env.OPENCODE_DB;
  if (env) return env;
  const dir = join(homedir(), ".local", "share", "opencode");
  if (!existsSync(dir)) {
    throw new Error(`opencode data dir not found: ${dir}`);
  }
  const candidates = readdirSync(dir)
    .filter((n) => /^opencode.*\.db$/.test(n))
    .map((n) => {
      const path = join(dir, n);
      return { name: n, path, mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw new Error(`no opencode*.db found in ${dir}`);
  }
  return candidates[0].path;
}

function detectMode(db: DatabaseSync): Mode {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part'")
    .get() as { name?: string } | undefined;
  return row ? "v1" : "v2";
}

function schemaFor(mode: Mode, typeFilter: PartType): Schema {
  const isTool = typeFilter === "tool";
  if (mode === "v1") {
    return {
      table: "part p",
      sessionRef: "p.session_id = s.id",
      typeExpr: `json_extract(p.data, '$.type') = '${typeFilter}'`,
      textExpr: isTool ? "p.data" : "json_extract(p.data, '$.text')",
      snippetExpr: isTool
        ? "json_extract(p.data, '$.state.input')"
        : "json_extract(p.data, '$.text')",
      orderCol: "p.time_created",
    };
  }
  return {
    table: "event e",
    sessionRef: "json_extract(e.data, '$.sessionID') = s.id",
    typeExpr: `e.type = 'message.part.updated.1' AND json_extract(e.data, '$.part.type') = '${typeFilter}'`,
    textExpr: isTool ? "e.data" : "json_extract(e.data, '$.part.text')",
    snippetExpr: isTool
      ? "json_extract(e.data, '$.state.input')"
      : "json_extract(e.data, '$.part.text')",
    orderCol: "e.seq",
  };
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

function buildPartQuery(args: Args, mode: Mode): { sql: string; params: unknown[] } {
  const sch = schemaFor(mode, args.typeFilter);
  const exists = args.terms.map(
    () =>
      `EXISTS (SELECT 1 FROM ${sch.table} WHERE ${sch.sessionRef} AND ${sch.typeExpr} AND re(?, ${sch.textExpr}))`,
  );
  const snippetSelect = args.showSnippet
    ? `, substr((SELECT ${sch.snippetExpr} FROM ${sch.table} WHERE ${sch.sessionRef} AND ${sch.typeExpr} AND re(?, ${sch.textExpr}) ORDER BY ${sch.orderCol} LIMIT 1), 1, 200) AS snippet`
    : "";
  const sql = `SELECT s.id, s.slug, s.title, s.directory AS directory,
                       datetime(s.time_created/1000, 'unixepoch') AS created,
                       datetime(s.time_updated/1000, 'unixepoch') AS updated${snippetSelect}
               FROM session s
               WHERE ${exists.join(" AND ")}
               ORDER BY s.time_updated DESC LIMIT ?`;
  const params: unknown[] = [];
  if (args.showSnippet) {
    params.push(patternFor(args.terms[0], args.fixedStrings));
  }
  for (const t of args.terms) params.push(patternFor(t, args.fixedStrings));
  params.push(args.limit);
  return { sql, params };
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

function printHelp(): void {
  process.stdout.write(`Usage: cotails <pattern> [pattern...] [options]

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
  cotails opencode journal          # sessions matching "opencode" and "journal"
  cotails 'event.*v2'               # regex: "event" ... "v2"
  cotails turso wal --json          # JSONL output
  cotails --title-only compaction   # search titles only
`);
}

function renderHuman(rows: Record<string, unknown>[], showSnippet: boolean): void {
  if (rows.length === 0) {
    process.stdout.write(`${C.grey}no sessions matched${C.reset}\n`);
    return;
  }
  for (const r of rows) {
    const id = r.id ? String(r.id).slice(0, 12) : "";
    const title = (r.title as string) || "(untitled)";
    const updated = (r.updated as string) || "";
    const created = (r.created as string) || "";
    const when = created && updated && created !== updated
      ? `${created} → ${updated}`
      : (updated || created);
    const slug = (r.slug as string) || "";
    const directory = (r.directory as string) || "";
    process.stdout.write(
      `${C.green}${id}${C.reset} ${C.bold}${title}${C.reset} ${C.grey}${when}${C.reset}\n`,
    );
    const meta = [slug, directory].filter(Boolean).join(" · ");
    if (meta) process.stdout.write(`${C.grey}  ${meta}${C.reset}\n`);
    if (showSnippet && r.snippet) {
      const snip = String(r.snippet).replace(/\s+/g, " ").trim().slice(0, 180);
      process.stdout.write(`${C.cyan}  ${snip}${C.reset}\n`);
    }
  }
  process.stdout.write(
    `${C.grey}${rows.length} session${rows.length === 1 ? "" : "s"}${C.reset}\n`,
  );
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
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

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    registerRegex(db, args.caseSensitive);
    const mode = detectMode(db);
    const { sql, params } = args.titleOnly
      ? buildTitleQuery(args)
      : buildPartQuery(args, mode);
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    if (args.json) {
      for (const r of rows) process.stdout.write(JSON.stringify(r) + "\n");
    } else {
      renderHuman(rows, args.showSnippet);
    }
  } finally {
    db.close();
  }
}

main();
