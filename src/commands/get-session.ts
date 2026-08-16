import { existsSync } from "node:fs";
import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  resolveSession as querySession,
  sessionDirectoryExact,
  sessionIDs,
  type SessionDetails,
  type SessionPredicate,
} from "@opencoattails/query-kysely";
import { parseDirectoryArg } from "../args.ts";
import { C, emitJsonl } from "../format.ts";
import { discoverDb } from "../opencode/db.ts";
import { readProcInfo, resolvePidInput } from "../opencode/pid.ts";
import { emitSessionArrow } from "../arrow.ts";

interface Args {
  pid: string | undefined;
  directory: string | undefined;
  sessionId: string | undefined;
  dbPath: string | undefined;
  json: boolean;
  idOnly: boolean;
  arrow: boolean;
}

type SessionInfo = SessionDetails & { readonly title: string };

function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseArgs(argv: string[]): Args {
  let pid: string | undefined;
  let directory: string | undefined;
  let sessionId: string | undefined;
  let dbPath: string | undefined;
  let json = false;
  let idOnly = false;
  let arrow = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      dbPath = argv[++i];
      if (dbPath === undefined) throw new Error("--db requires a path");
      continue;
    }
    if (a === "--directory" || a === "-C") {
      directory = parseDirectoryArg(argv[++i]);
      continue;
    }
    if (a === "--session" || a === "-s") {
      sessionId = argv[++i];
      if (sessionId === undefined) throw new Error("--session requires an id");
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--id-only") { idOnly = true; continue; }
    if (a === "--arrow") { arrow = true; continue; }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    if (pid !== undefined) throw new Error(`unexpected second positional: ${a}`);
    pid = a;
  }
  if (arrow && json) throw new Error("--arrow cannot be combined with --json");
  if (arrow && idOnly) throw new Error("--arrow cannot be combined with --id-only");
  return { pid, directory, sessionId, dbPath, json, idOnly, arrow };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotail get-session [pid] [options]

Resolve the current active opencode session id for a running opencode process.

PID resolution (first that applies):
  1. positional <pid> argument
  2. $OPENCODE_PID env var (set by opencode, inherited by tool shells)
  3. $OPENCODE_SESSION_ID env var (returned directly, no lookup needed)

The PID's working directory (/proc/<pid>/cwd) is matched against the session
table's directory, picking the most recently updated session.

Options:
  -s, --session <id>    Use this session id directly (skip PID resolution)
  -C, --directory <dir> Override the directory to match (skip /proc lookup)
  --db <path>           Database path (default: auto-discover)
  --json                Output the full session object as JSONL
  --id-only             Print only the session id (scripting-friendly)
  --arrow               Output Apache Arrow IPC stream
  -h, --help            Show this help

Examples:
  cotail get-session                   # via $OPENCODE_PID / $OPENCODE_SESSION_ID
  cotail get-session 992039            # explicit opencode PID
  cotail get-session --id-only         # bare id for shell capture
  cotail get-session -s ses_04602d85affe...
`);
}

function renderHuman(info: SessionInfo, via: string): void {
  process.stdout.write(`${C.green}${info.id}${C.reset}\n`);
  process.stdout.write(`${C.bold}${info.title || "(untitled)"}${C.reset} ${C.grey}${via}${C.reset}\n`);
  const meta = [
    info.directory,
    info.slug,
    info.version,
    `updated ${fmtLocal(info.timeUpdated)}`,
  ].filter(Boolean);
  process.stdout.write(`${C.grey}  ${meta.join(" · ")}${C.reset}\n`);
}

async function resolveSession(args: Args): Promise<{ info: SessionInfo; via: string }> {
  // 1. explicit session id — no resolution needed
  if (args.sessionId) {
    return loadAndReport(args, sessionIDs([args.sessionId]), "only", `session ${args.sessionId}`);
  }

  // 2. explicit directory — skip /proc, match the dir
  if (args.directory) {
    return loadAndReport(args, sessionDirectoryExact(args.directory), "latest", `directory ${args.directory}`);
  }

  // 3. direct env shortcut
  const envSid = process.env.OPENCODE_SESSION_ID;
  const pid = resolvePidInput(args.pid);
  if (envSid && args.pid === undefined) {
    return loadAndReport(args, sessionIDs([envSid]), "only", `$OPENCODE_SESSION_ID`);
  }

  // 4. PID via /proc
  if (pid === undefined) {
    throw new Error(
      "no pid given: pass a positional <pid>, set $OPENCODE_PID, or use --session / --directory",
    );
  }
  const proc = readProcInfo(pid);
  const dbPath = args.dbPath ?? proc.db;
  const via = proc.comm ? `pid ${pid} (${proc.comm}) @ ${proc.cwd}` : `pid ${pid} @ ${proc.cwd}`;
  const info = await loadSession(dbPath, sessionDirectoryExact(proc.cwd), "latest");
  if (!info) {
    throw new Error(`no session found for directory ${proc.cwd} (pid ${pid})`);
  }
  return { info, via };
}

async function loadSession(
  dbPath: string | undefined,
  predicate: SessionPredicate,
  mode: "latest" | "only",
): Promise<SessionInfo | undefined> {
  const resolved = discoverDb(dbPath);
  if (!existsSync(resolved)) throw new Error(`db not found: ${resolved}`);
  const info = await Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path: resolved, sourceID: "cli" }).pipe(
      Effect.flatMap(({ query }) => querySession(query, { predicate, mode })),
    ),
  ));
  return info === undefined ? undefined : { ...info, title: info.title ?? "" };
}

async function loadAndReport(
  args: Args,
  predicate: SessionPredicate,
  mode: "latest" | "only",
  via: string,
): Promise<{ info: SessionInfo; via: string }> {
  const info = await loadSession(args.dbPath, predicate, mode);
  if (!info) throw new Error(`session not found (${via})`);
  return { info, via };
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

  try {
    const { info, via } = await resolveSession(args);
    if (args.arrow) {
      await emitSessionArrow([info]);
    } else if (args.idOnly) {
      process.stdout.write(info.id + "\n");
    } else if (args.json) {
      emitJsonl([info]);
    } else {
      renderHuman(info, via);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
