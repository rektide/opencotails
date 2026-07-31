import type { DatabaseSync } from "node:sqlite";

/**
 * Canonical session report — the consolidated "session information" block.
 *
 * Starts minimal (identity + timestamps). Later tickets extend it:
 * `cotail-basic-fields` adds model/agent/cost/tokens, `cotail-fork-point`
 * adds fork provenance, etc. Keep field names stable and camelCase so the
 * `--json` output is a clean public shape.
 */
export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
  slug: string;
  projectId: string;
  parentId: string | null;
  version: string;
  timeCreated: number;
  timeUpdated: number;
}

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  slug: string;
  project_id: string;
  parent_id: string | null;
  version: string;
  time_created: number;
  time_updated: number;
}

function mapRow(r: SessionRow): SessionInfo {
  return {
    id: r.id,
    title: r.title,
    directory: r.directory,
    slug: r.slug,
    projectId: r.project_id,
    parentId: r.parent_id,
    version: r.version,
    timeCreated: r.time_created,
    timeUpdated: r.time_updated,
  };
}

const COLUMNS =
  "id, title, directory, slug, project_id, parent_id, version, time_created, time_updated";

/** Most recently updated session whose `directory` exactly matches. */
export function latestSessionByDirectory(db: DatabaseSync, directory: string): SessionInfo | undefined {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM session WHERE directory = ? ORDER BY time_updated DESC LIMIT 1`,
    )
    .get(directory) as SessionRow | undefined;
  return row ? mapRow(row) : undefined;
}

/** Look up a single session by id. */
export function getSessionById(db: DatabaseSync, id: string): SessionInfo | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM session WHERE id = ? LIMIT 1`).get(
    id,
  ) as SessionRow | undefined;
  return row ? mapRow(row) : undefined;
}
