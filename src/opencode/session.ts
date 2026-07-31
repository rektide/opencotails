import type { DatabaseSync } from "node:sqlite";
import type { SessionCounts } from "./types.ts";
import { existingTables } from "./db.ts";

export interface CountOpts {
  cutoff: number;
  directory: string | null;
  limit: number;
}

export function countActiveSessions(db: DatabaseSync, opts: CountOpts): SessionCounts[] {
  const tables = existingTables(db);
  const totalParts: string[] = [];
  const recentParts: string[] = [];
  if (tables.has("message")) {
    totalParts.push("(SELECT count(*) FROM message m WHERE m.session_id = s.id)");
    recentParts.push("(SELECT count(*) FROM message m WHERE m.session_id = s.id AND m.time_created >= ?)");
  }
  if (tables.has("session_message")) {
    totalParts.push("(SELECT count(*) FROM session_message sm WHERE sm.session_id = s.id)");
    recentParts.push("(SELECT count(*) FROM session_message sm WHERE sm.session_id = s.id AND sm.time_created >= ?)");
  }
  const totalExpr = totalParts.length ? totalParts.join(" + ") : "0";
  const recentExpr = recentParts.length ? recentParts.join(" + ") : "0";

  const sql = `SELECT s.id, s.title, s.directory, s.slug, s.time_created, s.time_updated,
                      ${totalExpr} AS messages_total,
                      ${recentExpr} AS messages_recent
               FROM session s
               WHERE s.time_updated >= ?
                 AND (? IS NULL OR instr(s.directory, ?) > 0)
               ORDER BY s.time_updated DESC
               LIMIT ?`;

  const params: unknown[] = [];
  for (let i = 0; i < recentParts.length; i++) params.push(opts.cutoff);
  params.push(opts.cutoff, opts.directory, opts.directory, opts.limit > 0 ? opts.limit : -1);
  return db.prepare(sql).all(...params) as SessionCounts[];
}
