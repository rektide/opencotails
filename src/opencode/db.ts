import { DatabaseSync } from "node:sqlite";
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

export function openReadOnly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export function existingTables(db: DatabaseSync): Set<string> {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name),
  );
}

export function registerRegex(db: DatabaseSync, caseSensitive: boolean): void {
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
