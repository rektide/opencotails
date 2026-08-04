import { existsSync } from "node:fs";
import { C, emitJsonl } from "../format.ts";
import { discoverDb, openReadOnly } from "../opencode/db.ts";
import { getSessionById, latestSessionByDirectory, type SessionInfo } from "../opencode/session-info.ts";
import { readProcInfo, resolvePidInput } from "../opencode/pid.ts";

interface Args {
  pid: string | undefined;
  directory: string | undefined;
  sessionId: string | undefined;
  dbPath: string | undefined;
  json: boolean;
  idOnly: boolean;
}

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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      dbPath = argv[++i];
      if (dbPath === undefined) throw new Error("--db requires a path");
      continue;
    }
    if (a === "--directory" || a === "-C") {
      directory = argv[++i];
      if (directory === undefined) throw new Error("--directory requires a path");
      continue;
    }
    if (a === "--session" || a === "-s") {
      sessionId = argv[++i];
      if (sessionId === undefined) throw new Error("--session requires an id");
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--id-only") { idOnly = true; continue; }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    if (pid !== undefined) throw new Error(`unexpected second positional: ${a}`);
    pid = a;
  }
  return { pid, directory, sessionId, dbPath, json, idOnly };
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

function resolveSession(args: Args): { info: SessionInfo; via: string } {
  // 1. explicit session id — no resolution needed
  if (args.sessionId) {
    return loadAndReport(args, (db) => getSessionById(db, args.sessionId!), `session ${args.sessionId}`);
  }

  // 2. explicit directory — skip /proc, match the dir
  if (args.directory) {
    return loadAndReport(args, (db) => latestSessionByDirectory(db, args.directory!), `directory ${args.directory}`);
  }

  // 3. direct env shortcut
  const envSid = process.env.OPENCODE_SESSION_ID;
  const pid = resolvePidInput(args.pid);
  if (envSid && args.pid === undefined) {
    return loadAndReport(args, (db) => getSessionById(db, envSid), `$OPENCODE_SESSION_ID`);
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
  const { db, close } = openDb(dbPath);
  try {
    const info = latestSessionByDirectory(db, proc.cwd);
    if (!info) {
      throw new Error(`no session found for directory ${proc.cwd} (pid ${pid})`);
    }
    return { info, via };
  } finally {
    close();
  }
}

function openDb(dbPath: string | undefined): { db: ReturnType<typeof openReadOnly>; close: () => void } {
  const resolved = discoverDb(dbPath);
  if (!existsSync(resolved)) throw new Error(`db not found: ${resolved}`);
  const db = openReadOnly(resolved);
  return { db, close: () => db.close() };
}

function loadAndReport(
  args: Args,
  find: (db: ReturnType<typeof openReadOnly>) => SessionInfo | undefined,
  via: string,
): { info: SessionInfo; via: string } {
  const { db, close } = openDb(args.dbPath);
  try {
    const info = find(db);
    if (!info) throw new Error(`session not found (${via})`);
    return { info, via };
  } finally {
    close();
  }
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

  try {
    const { info, via } = resolveSession(args);
    if (args.idOnly) {
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
