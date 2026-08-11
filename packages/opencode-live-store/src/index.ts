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
  const flags = options.caseSensitive ? "" : "i";
  const cache = new Map<string, RegExp>();
  native.function("re", { deterministic: true }, (...values: SQLOutputValue[]) => {
    const pattern = String(values[0]);
    const value = values[1];
    if (value == null) return 0;
    let expression = cache.get(pattern);
    if (expression === undefined) {
      expression = new RegExp(pattern, flags);
      cache.set(pattern, expression);
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
    async searchDirect(_request) {
      assertOpen();
      throw new Error("searchDirect not implemented");
    },
    async history(_request) {
      assertOpen();
      throw new Error("history not implemented");
    },
    async resolve(_request) {
      assertOpen();
      throw new Error("resolve not implemented");
    },
    async close() {
      if (closed) return;
      closed = true;
      await database.destroy();
    },
  };
}
