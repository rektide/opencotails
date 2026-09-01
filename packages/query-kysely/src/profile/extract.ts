import type { DatabaseSync } from "node:sqlite";
import { withSqliteProfileHash } from "./canonical.ts";
import type {
  SqliteColumnFact,
  SqliteIndexAuxiliaryFact,
  SqliteIndexFact,
  SqliteIndexKeyFact,
  SqliteProfileSchema,
  SqliteTableFact,
} from "./types.ts";

interface TableXinfoRow {
  readonly cid: unknown;
  readonly name: unknown;
  readonly type: unknown;
  readonly not_null: unknown;
  readonly default_value: unknown;
  readonly primary_key: unknown;
  readonly hidden: unknown;
}

interface IndexListRow {
  readonly name: unknown;
  readonly unique_value: unknown;
  readonly origin: unknown;
  readonly partial: unknown;
  readonly definition: unknown;
}

interface IndexXinfoRow {
  readonly sequence: unknown;
  readonly cid: unknown;
  readonly name: unknown;
  readonly descending: unknown;
  readonly collation: unknown;
  readonly is_key: unknown;
}

export class SqliteProfileExtractionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SqliteProfileExtractionError";
  }
}

export interface SqliteProfileExtractionSelection {
  readonly columns?: boolean;
  readonly indexes?: boolean;
}

export const OPENCODE_PROFILE_REQUIRED_TABLES = Object.freeze([
  "kv",
  "session_message",
  "session_v2",
] as const);

export const OPENCODE_PROFILE_OPTIONAL_TABLES = Object.freeze([
  "event",
  "event_sequence",
  "session_pending",
] as const);

function number(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isInteger(result)) throw new SqliteProfileExtractionError(`invalid SQLite metadata field ${field}`);
  return result;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new SqliteProfileExtractionError(`invalid SQLite metadata field ${field}`);
  return value;
}

function sqlTokens(sql: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length;) {
    const current = sql[index]!;
    if (/\s/u.test(current)) {
      index++;
      continue;
    }
    if (current === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index++;
      continue;
    }
    if (current === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      let token = current;
      index++;
      while (index < sql.length) {
        const next = sql[index]!;
        token += next;
        index++;
        if (next !== quote) continue;
        if (sql[index] === quote) {
          token += quote;
          index++;
          continue;
        }
        break;
      }
      tokens.push(token);
      continue;
    }
    if (current === "[") {
      const end = sql.indexOf("]", index + 1);
      const stop = end < 0 ? sql.length : end + 1;
      tokens.push(sql.slice(index, stop));
      index = stop;
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(current)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/u.test(sql[end]!)) end++;
      tokens.push(sql.slice(index, end));
      index = end;
      continue;
    }
    const pair = sql.slice(index, index + 2);
    if (["<=", ">=", "!=", "<>", "==", "||", "->", "<<", ">>"].includes(pair)) {
      tokens.push(pair);
      index += 2;
      continue;
    }
    tokens.push(current);
    index++;
  }
  return tokens;
}

function canonicalSqlFragment(sql: string): string {
  return sqlTokens(sql).join(" ");
}

function indexDefinition(sql: unknown): { readonly expressions: readonly string[]; readonly predicate: string | null } {
  if (typeof sql !== "string") return { expressions: [], predicate: null };
  const tokens = sqlTokens(sql);
  const on = tokens.findIndex((token) => token.toUpperCase() === "ON");
  const open = tokens.findIndex((token, index) => index > on && token === "(");
  if (on < 0 || open < 0) return { expressions: [], predicate: null };
  const terms: string[][] = [[]];
  let depth = 1;
  let close = -1;
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "(") depth++;
    if (token === ")") {
      depth--;
      if (depth === 0) {
        close = index;
        break;
      }
    }
    if (token === "," && depth === 1) terms.push([]);
    else terms.at(-1)!.push(token);
  }
  const expressions = terms.map((term) => {
    const copy = [...term];
    if (["ASC", "DESC"].includes(copy.at(-1)?.toUpperCase() ?? "")) copy.pop();
    if (copy.length >= 2 && copy.at(-2)?.toUpperCase() === "COLLATE") copy.splice(-2, 2);
    return copy.join(" ");
  });
  const where = close < 0 ? -1 : tokens.findIndex((token, index) =>
    index > close && token.toUpperCase() === "WHERE");
  return {
    expressions,
    predicate: where < 0 ? null : tokens.slice(where + 1).filter((token) => token !== ";").join(" "),
  };
}

function extractIndex(database: DatabaseSync, row: IndexListRow): SqliteIndexFact {
  const name = string(row.name, "index_list.name");
  const origin = string(row.origin, "index_list.origin");
  if (origin !== "c" && origin !== "u" && origin !== "pk") {
    throw new SqliteProfileExtractionError(`unsupported SQLite index origin ${origin}`);
  }
  const definition = indexDefinition(row.definition);
  const rows = database.prepare(`
    SELECT seqno AS sequence, cid, name, desc AS descending, coll AS collation, key AS is_key
    FROM pragma_index_xinfo(?)
    ORDER BY seqno
  `).all(name) as unknown as readonly IndexXinfoRow[];
  const keys: SqliteIndexKeyFact[] = [];
  const auxiliary: SqliteIndexAuxiliaryFact[] = [];
  for (const item of rows) {
    const sequence = number(item.sequence, "index_xinfo.seqno");
    const cid = number(item.cid, "index_xinfo.cid");
    const isKey = number(item.is_key, "index_xinfo.key") !== 0;
    if (!isKey) {
      if (cid === -1) auxiliary.push({ sequence, kind: "rowid" });
      else if (cid === -2) auxiliary.push({ sequence, kind: "expression" });
      else auxiliary.push({ sequence, kind: "column", column: string(item.name, "index_xinfo.name") });
      continue;
    }
    const shared = {
      sequence,
      collation: string(item.collation, "index_xinfo.coll"),
      direction: number(item.descending, "index_xinfo.desc") === 0 ? "asc" as const : "desc" as const,
    };
    if (cid === -1) keys.push({ ...shared, kind: "rowid" });
    else if (cid === -2) keys.push({
      ...shared,
      kind: "expression",
      expression: definition.expressions[keys.length] ?? "<unknown-expression>",
    });
    else keys.push({ ...shared, kind: "column", column: string(item.name, "index_xinfo.name") });
  }
  return {
    name,
    unique: number(row.unique_value, "index_list.unique") !== 0,
    partial: number(row.partial, "index_list.partial") !== 0,
    origin,
    predicate: definition.predicate,
    keys,
    auxiliary,
  };
}

function extractTable(
  database: DatabaseSync,
  name: string,
  selection: Required<SqliteProfileExtractionSelection>,
): SqliteTableFact {
  let columnFacts: readonly SqliteColumnFact[] = [];
  if (selection.columns) {
    const columns = database.prepare(`
      SELECT cid, name, type, "notnull" AS not_null, dflt_value AS default_value,
             pk AS primary_key, hidden
      FROM pragma_table_xinfo(?)
      ORDER BY cid
    `).all(name) as unknown as readonly TableXinfoRow[];
    if (columns.length === 0) throw new SqliteProfileExtractionError(`SQLite table not found: ${name}`);
    columnFacts = columns.map((column) => ({
      cid: number(column.cid, "table_xinfo.cid"),
      name: string(column.name, "table_xinfo.name"),
      type: string(column.type, "table_xinfo.type").toUpperCase(),
      not_null: number(column.not_null, "table_xinfo.notnull") !== 0,
      default_value: column.default_value === null ? null : canonicalSqlFragment(string(column.default_value, "table_xinfo.dflt_value")),
      primary_key: number(column.primary_key, "table_xinfo.pk"),
      hidden: number(column.hidden, "table_xinfo.hidden"),
    }));
  } else if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) === undefined) {
    throw new SqliteProfileExtractionError(`SQLite table not found: ${name}`);
  }
  let indexes: readonly SqliteIndexFact[] = [];
  if (selection.indexes) {
    const indexRows = database.prepare(`
      SELECT list.name, list."unique" AS unique_value, list.origin, list.partial, schema.sql AS definition
      FROM pragma_index_list(?) AS list
      LEFT JOIN sqlite_schema AS schema ON schema.type = 'index' AND schema.name = list.name
      ORDER BY list.name
    `).all(name) as unknown as readonly IndexListRow[];
    indexes = indexRows.map((row) => extractIndex(database, row));
  }
  return { columns: columnFacts, indexes };
}

export function extractSqliteProfileSchema(
  database: DatabaseSync,
  tableNames?: readonly string[],
  input: SqliteProfileExtractionSelection = {},
): SqliteProfileSchema {
  const selection = { columns: input.columns ?? true, indexes: input.indexes ?? true };
  if (!selection.columns && !selection.indexes) {
    throw new SqliteProfileExtractionError("profile extraction must select columns or indexes");
  }
  const names = tableNames === undefined
    ? (database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as unknown as readonly { readonly name: string }[]).map(({ name }) => name)
    : [...new Set(tableNames)].sort();
  const tables: Record<string, SqliteTableFact> = {};
  for (const name of names) tables[name] = extractTable(database, name, selection);
  return withSqliteProfileHash(tables);
}

export function extractOpenCodeProfileSchema(
  database: DatabaseSync,
  selection?: SqliteProfileExtractionSelection,
): SqliteProfileSchema {
  const present = new Set(
    (database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as unknown as
      readonly { readonly name: unknown }[]).map(({ name }) => string(name, "sqlite_schema.name")),
  );
  const missing = OPENCODE_PROFILE_REQUIRED_TABLES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new SqliteProfileExtractionError(`required OpenCode table${missing.length === 1 ? "" : "s"} missing: ${missing.join(", ")}`);
  }
  const selected = [
    ...OPENCODE_PROFILE_REQUIRED_TABLES,
    ...OPENCODE_PROFILE_OPTIONAL_TABLES.filter((name) => present.has(name)),
  ];
  return extractSqliteProfileSchema(database, selected, selection);
}

export function extractObservedMessageVariants(database: DatabaseSync): readonly string[] {
  const rows = database.prepare("SELECT DISTINCT type FROM session_message ORDER BY type").all() as unknown as
    readonly { readonly type: unknown }[];
  return rows.map(({ type }) => string(type, "session_message.type"));
}
