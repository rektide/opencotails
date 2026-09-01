import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  findLatestSession,
  getSession,
  sessionDirectoryExact,
  sessionID,
  SessionNotFoundError,
  type SessionDetails,
  type SessionPredicate,
  type SessionReportObservation,
} from "@opencoattails/query-kysely";
import { parseDirectoryArg } from "../args.ts";
import { C, emitJsonl } from "../format.ts";
import { readProcInfo, resolvePidInput } from "../opencode/pid.ts";
import { emitSessionArrow } from "../arrow.ts";
import { resolveRuntimeSource } from "../profile/runtime.ts";

interface Args {
  pid: string | undefined;
  directory: string | undefined;
  sessionId: string | undefined;
  dbPath: string | undefined;
  profilePath: string | undefined;
  json: boolean;
  idOnly: boolean;
  arrow: boolean;
}

type SessionInfo = SessionDetails & { readonly title: string };
type SessionLookup =
  | { readonly kind: "exact"; readonly sessionID: string }
  | { readonly kind: "latest"; readonly predicate: SessionPredicate };

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
  let profilePath: string | undefined;
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
    if (a === "--profile") {
      profilePath = argv[++i];
      if (profilePath === undefined) throw new Error("--profile requires a path");
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
  return { pid, directory, sessionId, dbPath, profilePath, json, idOnly, arrow };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotail get-session [pid] [options]

Resolve the current active opencode session id for a running opencode process.

PID resolution (first that applies):
  1. positional <pid> argument
  2. $OPENCODE_PID env var (set by opencode, inherited by tool shells)
  3. $OPENCODE_SESSION_ID env var (validated by exact Session lookup)

The PID's working directory (/proc/<pid>/cwd) is matched against the session
table's directory, picking the most recently updated session.

Options:
  -s, --session <id>    Use this session id directly (skip PID resolution)
  -C, --directory <dir> Override the directory to match (skip /proc lookup)
  --profile <path>      Trusted source profile (default: XDG opencode-local profile)
  --db <path>           Database locator override (default: path recorded in profile)
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
    return loadAndReport(args, { kind: "exact", sessionID: args.sessionId }, `session ${args.sessionId}`);
  }

  // 2. explicit directory — skip /proc, match the dir
  if (args.directory) {
    return loadAndReport(args, {
      kind: "latest", predicate: sessionDirectoryExact(args.directory),
    }, `directory ${args.directory}`);
  }

  // 3. direct env shortcut
  const envSid = process.env.OPENCODE_SESSION_ID;
  const pid = resolvePidInput(args.pid);
  if (envSid && args.pid === undefined) {
    return loadAndReport(args, { kind: "exact", sessionID: envSid }, `$OPENCODE_SESSION_ID`);
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
  const info = await loadSession(dbPath, args.profilePath, { kind: "latest", predicate: sessionDirectoryExact(proc.cwd) });
  if (!info) {
    throw new Error(`no session found for directory ${proc.cwd} (pid ${pid})`);
  }
  return { info, via };
}

async function loadSession(
  dbPath: string | undefined,
  profilePath: string | undefined,
  lookup: SessionLookup,
): Promise<SessionInfo | undefined> {
  const source = await resolveRuntimeSource({ databasePath: dbPath, profilePath });
  let observed: SessionReportObservation | undefined;
  try {
    observed = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ ...source, sourceID: "cli" }).pipe(
        Effect.flatMap(({ query }) => lookup.kind === "exact"
          ? getSession(query, sessionID(lookup.sessionID))
          : findLatestSession(query, lookup.predicate)),
      ),
    ));
  } catch (error) {
    if (error instanceof SessionNotFoundError) return undefined;
    throw error;
  }
  return observed === undefined ? undefined : toSessionInfo(observed);
}

function toSessionInfo(observed: SessionReportObservation): SessionInfo {
  const report = observed.value;
  return {
    id: observed.target.address.sessionID,
    title: report.title ?? "",
    directory: report.location.directory,
    slug: report.slug,
    projectId: report.location.projectID,
    parentId: report.lineage.parentSessionID,
    version: report.run.version,
    timeCreated: report.lifecycle.createdAt,
    timeUpdated: report.lifecycle.updatedAt,
  };
}

async function loadAndReport(
  args: Args,
  lookup: SessionLookup,
  via: string,
): Promise<{ info: SessionInfo; via: string }> {
  const info = await loadSession(args.dbPath, args.profilePath, lookup);
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
