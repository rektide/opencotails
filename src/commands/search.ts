import { existsSync } from "node:fs";
import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  documentWitness,
  literal,
  regex,
  searchDirectSessions,
  sessionDirectoryContains,
  sessionPredicate,
  sessionUpdatedRange,
  witnessName,
  type DocumentField,
  type SessionPredicate,
} from "@opencoattails/query-kysely";
import { parseDirectoryArg, parseSince } from "../args.ts";
import { C, emitJsonl } from "../format.ts";
import { discoverDb } from "../opencode/db.ts";
import type { PartType, SearchHit } from "../opencode/types.ts";
import { emitSearchArrow } from "../arrow.ts";

interface Args {
  terms: string[];
  dbPath?: string;
  limit: number;
  json: boolean;
  arrow: boolean;
  titleOnly: boolean;
  showSnippet: boolean;
  typeFilter: PartType;
  caseSensitive: boolean;
  fixedStrings: boolean;
  directory?: string;
  sinceMs?: number;
}

function sqliteDate(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 19).replace("T", " ");
}

const SEARCH_FIELDS: Record<PartType, readonly DocumentField[]> = {
  text: ["user.text", "synthetic.text", "system.text", "skill.text", "assistant.text"],
  reasoning: ["assistant.reasoning"],
  tool: ["tool.name", "tool.input", "tool.output", "tool.error"],
};

function selection(args: Args): SessionPredicate | undefined {
  const predicates: SessionPredicate[] = [];
  if (args.directory !== undefined) predicates.push(sessionDirectoryContains(args.directory));
  if (args.sinceMs !== undefined) predicates.push(sessionUpdatedRange({ from: args.sinceMs }));
  return predicates.length === 0
    ? undefined
    : sessionPredicate((context) => context.eb.and(predicates.map((predicate) => predicate(context))));
}

async function searchRows(path: string, args: Args): Promise<SearchHit[]> {
  const fields: readonly DocumentField[] = args.titleOnly ? ["session.title"] : SEARCH_FIELDS[args.typeFilter];
  const witnesses = args.terms.map((term, index) => documentWitness(
    witnessName(`term-${String(index).padStart(6, "0")}`),
    (eb) => eb.and([
      eb("field", "in", fields),
      args.fixedStrings
        ? literal(eb.ref("text"), term, { case: args.caseSensitive ? "sensitive" : "insensitive" })
        : regex(eb.ref("text"), term, { flags: args.caseSensitive ? "" : "i" }),
    ]),
  ));
  const groups = await Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "cli" }).pipe(
      Effect.flatMap(({ query }) => args.limit === 0
        ? Effect.succeed([] as const)
        : searchDirectSessions(query, {
          witnesses,
          sessionPredicate: selection(args),
          evidence: !args.titleOnly && args.showSnippet,
          window: { sessions: { first: args.limit }, childrenPerSession: 1 },
        })),
    ),
  ));
  return groups.map(({ session, children }) => ({
    id: session.value.sessionID,
    slug: session.value.slug,
    title: session.value.title ?? "",
    directory: session.value.directory,
    created: sqliteDate(session.value.createdAt),
    updated: sqliteDate(session.value.updatedAt),
    ...(children[0] === undefined ? {} : { snippet: children[0].document.value.excerpt }),
  }));
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
  let arrow = false;
  let titleOnly = false;
  let showSnippet = true;
  let typeFilter: PartType = "text";
  let caseSensitive = false;
  let fixedStrings = false;
  let directory: string | undefined;
  let sinceMs: number | undefined;
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
    if (a === "--directory") {
      directory = parseDirectoryArg(argv[++i]);
      continue;
    }
    if (a === "--since") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--since requires a value");
      sinceMs = parseSince(v);
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--arrow") { arrow = true; continue; }
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
  if (arrow && json) throw new Error("--arrow cannot be combined with --json");
  return { terms, dbPath, limit, json, arrow, titleOnly, showSnippet, typeFilter, caseSensitive, fixedStrings, directory, sinceMs };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotail search <pattern> [pattern...] [options]

Search opencode sessions for content matching ALL given terms.
Terms are matched as case-insensitive regular expressions (AND'd together).

Options:
  --db <path>      Database path (default: auto-discover)
  --limit <n>      Max results (default: 50)
  --json           Output JSONL instead of human-readable
  --arrow          Output Apache Arrow IPC stream
  --title-only     Search session titles only
  --no-snippet     Don't show text snippet
  --type <type>    Part type to search: text, reasoning, tool (default: text)
  --since <dur>    Only sessions updated after cutoff (24h, 7d, 30m, or ISO date)
  --directory <p>  Only sessions whose directory contains <p>
  -F, --fixed-strings   Treat patterns as literal strings, not regex
  -s, --case-sensitive  Match case sensitively (default: case-insensitive)

Examples:
  cotail search opencode journal          # sessions matching "opencode" and "journal"
  cotail search 'event.*v2'               # regex: "event" ... "v2"
  cotail search turso wal --json          # JSONL output
  cotail search --title-only compaction   # search titles only
  cotail search helpers --since 7d        # only recent sessions
  cotail search helpers --directory ~/src/compfuzor
`);
}

export async function run(argv: string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    if (!argv.includes("--arrow")) printHelp();
    process.exit(2);
  }
  if (args.terms.length === 0) {
    if (args.arrow) console.error("search requires at least one pattern");
    else printHelp();
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

  try {
    const rows = await searchRows(dbPath, args);
    if (args.arrow) await emitSearchArrow(rows);
    else if (args.json) emitJsonl(rows);
    else renderHuman(rows, args.showSnippet);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
