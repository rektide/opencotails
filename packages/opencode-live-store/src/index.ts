import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type {
  DirectSearchHit,
  DirectSearchRequest,
  HistoryEntry,
  HistoryRequest,
  ResolveRequest,
  SessionSummary,
} from "@opencoattails/query-domain";
import { Kysely, SqliteDialect } from "kysely";
import { NodeSqliteDatabase } from "./runtime/node-sqlite.ts";
import { detectCapabilities } from "./schema/capabilities.ts";
import type { OpencodeDatabase } from "./schema/tables.ts";
import { resolveSession } from "./query/session-row.ts";
import { searchTitles } from "./query/title.ts";
import { searchV1Content } from "./query/content.ts";

export interface OpenedOpencodeLiveStore {
  searchDirect(request: DirectSearchRequest): Promise<readonly DirectSearchHit[]>;
  history(request: HistoryRequest): Promise<readonly HistoryEntry[]>;
  resolve(request: ResolveRequest): Promise<SessionSummary | undefined>;
  close(): Promise<void>;
}

export interface OpenStoreOptions {
  caseSensitive?: boolean;
}

export function openOpencodeLiveStore(path: string, options: OpenStoreOptions = {}): OpenedOpencodeLiveStore {
  const native = new DatabaseSync(path, { readOnly: true });
  const cache = new Map<string, RegExp>();
  native.function("re", { deterministic: true }, (patternValue: SQLOutputValue, value: SQLOutputValue, sensitivity: SQLOutputValue) => {
    const pattern = String(patternValue);
    const caseSensitive = sensitivity === 1;
    if (value == null) return 0;
    const key = `${caseSensitive ? "s" : "i"}:${pattern}`;
    let expression = cache.get(key);
    if (expression === undefined) {
      expression = new RegExp(pattern, caseSensitive ? "" : "i");
      cache.set(key, expression);
    }
    return expression.test(String(value)) ? 1 : 0;
  });
  detectCapabilities(native);
  const adapter = new NodeSqliteDatabase(native);
  const database = new Kysely<OpencodeDatabase>({ dialect: new SqliteDialect({ database: adapter }) });
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error("store closed");
  };
  return {
    async searchDirect(request) {
      assertOpen();
      if (request.title !== undefined) return searchTitles(database, request);
      return searchV1Content(database, request);
    },
    async history(_request) {
      assertOpen();
      throw new Error("history not implemented");
    },
    async resolve(request) {
      assertOpen();
      return resolveSession(database, request);
    },
    async close() {
      if (closed) return;
      closed = true;
      await database.destroy();
    },
  };
}
