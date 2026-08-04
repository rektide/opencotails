import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { platform } from "node:os";

const IS_LINUX = platform() === "linux";

export interface ProcInfo {
  pid: number;
  cwd: string;
  db: string | undefined;
  comm: string | undefined;
}

/**
 * Decide which PID to resolve from, in priority order:
 *   1. explicit positional arg
 *   2. $OPENCODE_PID (set by opencode on startup, inherited by tool shells)
 * Returns undefined when neither is available.
 */
export function resolvePidInput(arg?: string): number | undefined {
  const raw = arg ?? process.env.OPENCODE_PID;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(arg !== undefined ? `invalid pid: ${arg}` : `invalid $OPENCODE_PID: ${raw}`);
  }
  return n;
}

/** Read the process's /proc/<pid>/cmdline basename as a best-effort label. */
export function readComm(pid: number): string | undefined {
  if (!IS_LINUX) return undefined;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const first = cmdline.split("\0")[0] ?? "";
    if (!first) return undefined;
    const base = first.split("/").pop() ?? first;
    return base || undefined;
  } catch {
    return undefined;
  }
}

function parseEnv(environ: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of environ.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

/**
 * Resolve a live opencode PID into the signals cotail needs: its working
 * directory (the project root, used to find the active session) and the
 * $OPENCODE_DB it was told to use (if any).
 *
 * Linux-only (/proc). On other platforms the caller should fall back to
 * $OPENCODE_SESSION_ID or an explicit --directory.
 */
export function readProcInfo(pid: number): ProcInfo {
  if (!IS_LINUX) {
    throw new Error(
      `PID resolution via /proc is Linux-only; on this platform (${platform()}) pass the session id directly or use --directory`,
    );
  }
  if (!existsSync(`/proc/${pid}`)) {
    throw new Error(`process ${pid} is not running`);
  }
  let cwd: string;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    throw new Error(
      `cannot read /proc/${pid}/cwd (permission denied or process exited)`,
    );
  }
  let db: string | undefined;
  try {
    const env = parseEnv(readFileSync(`/proc/${pid}/environ`, "utf8"));
    db = env.OPENCODE_DB || undefined;
  } catch {
    // environ may be unreadable across users; cwd alone is enough to proceed
  }
  return { pid, cwd, db, comm: readComm(pid) };
}
