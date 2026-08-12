import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function discoverDb(override?: string): string {
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
