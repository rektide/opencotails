import { hashSqliteProfileTables } from "./canonical.ts";
import type {
  IndexCapability,
  SourceProfile,
  SourceProfilePlanCertificate,
  SqliteColumnFact,
  SqliteIndexAuxiliaryFact,
  SqliteIndexFact,
  SqliteIndexKeyFact,
  SqliteProfileSchema,
  SqliteTableFact,
} from "./types.ts";
import { SOURCE_PROFILE_FORMAT } from "./types.ts";

export class SourceProfileDecodeError extends Error {
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SourceProfileDecodeError";
    this.path = path;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!record(value)) throw new SourceProfileDecodeError(path, "expected object");
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new SourceProfileDecodeError(path, `unknown field ${unknown[0]}`);
  for (const key of required) {
    if (!(key in value)) throw new SourceProfileDecodeError(path, `missing field ${key}`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new SourceProfileDecodeError(path, "expected non-empty string");
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new SourceProfileDecodeError(path, `expected integer >= ${minimum}`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new SourceProfileDecodeError(path, "expected boolean");
  return value;
}

function literal<const V extends string>(value: unknown, path: string, values: readonly V[]): V {
  if (typeof value !== "string" || !values.includes(value as V)) {
    throw new SourceProfileDecodeError(path, `expected ${values.join(" or ")}`);
  }
  return value as V;
}

function stringArray(value: unknown, path: string, sorted = true): readonly string[] {
  if (!Array.isArray(value)) throw new SourceProfileDecodeError(path, "expected array");
  const result = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new SourceProfileDecodeError(path, "expected unique values");
  if (sorted && result.some((item, index) => index > 0 && result[index - 1]! > item)) {
    throw new SourceProfileDecodeError(path, "expected sorted values");
  }
  return result;
}

function column(value: unknown, path: string): SqliteColumnFact {
  const item = object(value, path, ["cid", "name", "type", "not_null", "default_value", "primary_key", "hidden"]);
  if (item.default_value !== null && typeof item.default_value !== "string") {
    throw new SourceProfileDecodeError(`${path}.default_value`, "expected string or null");
  }
  return {
    cid: integer(item.cid, `${path}.cid`),
    name: text(item.name, `${path}.name`),
    type: typeof item.type === "string" ? item.type : (() => { throw new SourceProfileDecodeError(`${path}.type`, "expected string"); })(),
    not_null: boolean(item.not_null, `${path}.not_null`),
    default_value: item.default_value,
    primary_key: integer(item.primary_key, `${path}.primary_key`),
    hidden: integer(item.hidden, `${path}.hidden`),
  };
}

function key(value: unknown, path: string): SqliteIndexKeyFact {
  if (!record(value)) throw new SourceProfileDecodeError(path, "expected object");
  const kind = literal(value.kind, `${path}.kind`, ["column", "expression", "rowid"] as const);
  const required = kind === "column"
    ? ["sequence", "kind", "column", "collation", "direction"]
    : kind === "expression"
    ? ["sequence", "kind", "expression", "collation", "direction"]
    : ["sequence", "kind", "collation", "direction"];
  const item = object(value, path, required);
  const shared = {
    sequence: integer(item.sequence, `${path}.sequence`),
    collation: text(item.collation, `${path}.collation`),
    direction: literal(item.direction, `${path}.direction`, ["asc", "desc"] as const),
  };
  if (kind === "column") return { ...shared, kind, column: text(item.column, `${path}.column`) };
  if (kind === "expression") return { ...shared, kind, expression: text(item.expression, `${path}.expression`) };
  return { ...shared, kind };
}

function auxiliary(value: unknown, path: string): SqliteIndexAuxiliaryFact {
  if (!record(value)) throw new SourceProfileDecodeError(path, "expected object");
  const kind = literal(value.kind, `${path}.kind`, ["column", "expression", "rowid"] as const);
  const item = object(value, path, kind === "column" ? ["sequence", "kind", "column"] : ["sequence", "kind"]);
  const sequence = integer(item.sequence, `${path}.sequence`);
  return kind === "column"
    ? { sequence, kind, column: text(item.column, `${path}.column`) }
    : { sequence, kind };
}

function index(value: unknown, path: string): SqliteIndexFact {
  const item = object(value, path, ["name", "unique", "partial", "origin", "predicate", "keys", "auxiliary"]);
  if (item.predicate !== null && typeof item.predicate !== "string") {
    throw new SourceProfileDecodeError(`${path}.predicate`, "expected string or null");
  }
  if (!Array.isArray(item.keys)) throw new SourceProfileDecodeError(`${path}.keys`, "expected array");
  if (!Array.isArray(item.auxiliary)) throw new SourceProfileDecodeError(`${path}.auxiliary`, "expected array");
  return {
    name: text(item.name, `${path}.name`),
    unique: boolean(item.unique, `${path}.unique`),
    partial: boolean(item.partial, `${path}.partial`),
    origin: literal(item.origin, `${path}.origin`, ["c", "u", "pk"] as const),
    predicate: item.predicate,
    keys: item.keys.map((entry, position) => key(entry, `${path}.keys[${position}]`)),
    auxiliary: item.auxiliary.map((entry, position) => auxiliary(entry, `${path}.auxiliary[${position}]`)),
  };
}

function schema(value: unknown, path: string): SqliteProfileSchema {
  const item = object(value, path, ["normalized_hash", "tables"]);
  const tablesValue = object(item.tables, `${path}.tables`, Object.keys(record(item.tables) ? item.tables : {}));
  const tables: Record<string, SqliteTableFact> = {};
  for (const [name, tableValue] of Object.entries(tablesValue)) {
    const table = object(tableValue, `${path}.tables.${name}`, ["columns", "indexes"]);
    if (!Array.isArray(table.columns)) throw new SourceProfileDecodeError(`${path}.tables.${name}.columns`, "expected array");
    if (!Array.isArray(table.indexes)) throw new SourceProfileDecodeError(`${path}.tables.${name}.indexes`, "expected array");
    tables[name] = {
      columns: table.columns.map((entry, position) => column(entry, `${path}.tables.${name}.columns[${position}]`)),
      indexes: table.indexes.map((entry, position) => index(entry, `${path}.tables.${name}.indexes[${position}]`)),
    };
  }
  const normalizedHash = text(item.normalized_hash, `${path}.normalized_hash`);
  const actualHash = hashSqliteProfileTables(tables);
  if (normalizedHash !== actualHash) throw new SourceProfileDecodeError(`${path}.normalized_hash`, "does not match schema facts");
  return { normalized_hash: normalizedHash, tables };
}

function capability(value: unknown, path: string): IndexCapability {
  if (!record(value)) throw new SourceProfileDecodeError(path, "expected object");
  const status = literal(value.status, `${path}.status`, ["indexed", "unavailable"] as const);
  if (status === "unavailable") {
    object(value, path, ["status"]);
    return { status };
  }
  const item = object(value, path, ["status", "index", "equality_prefix"]);
  return {
    status,
    index: text(item.index, `${path}.index`),
    equality_prefix: stringArray(item.equality_prefix, `${path}.equality_prefix`, false),
  };
}

function certificate(value: unknown, path: string): SourceProfilePlanCertificate {
  const item = object(value, path, ["contract", "runtime", "outer", "related", "access", "keys"]);
  const runtime = object(item.runtime, `${path}.runtime`, ["node", "sqlite"]);
  return {
    contract: integer(item.contract, `${path}.contract`, 1),
    runtime: {
      node: text(runtime.node, `${path}.runtime.node`),
      sqlite: text(runtime.sqlite, `${path}.runtime.sqlite`),
    },
    outer: text(item.outer, `${path}.outer`),
    related: text(item.related, `${path}.related`),
    access: literal(item.access, `${path}.access`, ["search"] as const),
    keys: stringArray(item.keys, `${path}.keys`, false),
  };
}

export function decodeSourceProfile(value: unknown): SourceProfile {
  const root = object(value, "$", [
    "format", "profile_id", "generated_at", "generator", "opencode", "source", "schema", "content", "capabilities",
  ], ["certificates"]);
  const format = literal(root.format, "$.format", [SOURCE_PROFILE_FORMAT] as const);
  const profileID = text(root.profile_id, "$.profile_id");
  if (!/^[A-Za-z0-9._-]+$/u.test(profileID)) throw new SourceProfileDecodeError("$.profile_id", "contains unsupported characters");
  const generatedAt = text(root.generated_at, "$.generated_at");
  const generatedDate = new Date(generatedAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(generatedAt)
    || Number.isNaN(generatedDate.valueOf())
    || generatedDate.toISOString() !== generatedAt) {
    throw new SourceProfileDecodeError("$.generated_at", "expected canonical ISO timestamp");
  }
  const generator = object(root.generator, "$.generator", ["name", "version", "contracts"]);
  const contracts = object(generator.contracts, "$.generator.contracts", ["history", "direct_search"]);
  const opencode = object(root.opencode, "$.opencode", ["executable", "generated_with", "compatible_versions"]);
  const compatibleVersions = stringArray(opencode.compatible_versions, "$.opencode.compatible_versions");
  if (compatibleVersions.length === 0) {
    throw new SourceProfileDecodeError("$.opencode.compatible_versions", "expected at least one version");
  }
  const source = object(root.source, "$.source", ["kind", "path"]);
  const content = object(root.content, "$.content", ["supported_message_variants", "observed_message_variants"]);
  const capabilitiesValue = object(root.capabilities, "$.capabilities", Object.keys(record(root.capabilities) ? root.capabilities : {}));
  const capabilities = Object.fromEntries(Object.entries(capabilitiesValue).map(([name, value]) =>
    [name, capability(value, `$.capabilities.${name}`)]));
  let certificates: Record<string, SourceProfilePlanCertificate> | undefined;
  if (root.certificates !== undefined) {
    const values = object(root.certificates, "$.certificates", Object.keys(record(root.certificates) ? root.certificates : {}));
    certificates = Object.fromEntries(Object.entries(values).map(([name, value]) =>
      [name, certificate(value, `$.certificates.${name}`)]));
  }
  const supportedMessageVariants = stringArray(content.supported_message_variants, "$.content.supported_message_variants");
  const observedMessageVariants = stringArray(content.observed_message_variants, "$.content.observed_message_variants");
  const supportedSet = new Set(supportedMessageVariants);
  if (observedMessageVariants.some((variant) => !supportedSet.has(variant))) {
    throw new SourceProfileDecodeError("$.content.observed_message_variants", "observed variant is not recorded as supported");
  }
  return {
    format,
    profile_id: profileID,
    generated_at: generatedAt,
    generator: {
      name: literal(generator.name, "$.generator.name", ["cotail"] as const),
      version: text(generator.version, "$.generator.version"),
      contracts: {
        history: integer(contracts.history, "$.generator.contracts.history", 1),
        direct_search: integer(contracts.direct_search, "$.generator.contracts.direct_search", 1),
      },
    },
    opencode: {
      executable: text(opencode.executable, "$.opencode.executable"),
      generated_with: text(opencode.generated_with, "$.opencode.generated_with"),
      compatible_versions: compatibleVersions,
    },
    source: {
      kind: literal(source.kind, "$.source.kind", ["opencode-v2"] as const),
      path: text(source.path, "$.source.path"),
    },
    schema: schema(root.schema, "$.schema"),
    content: {
      supported_message_variants: supportedMessageVariants,
      observed_message_variants: observedMessageVariants,
    },
    capabilities,
    ...(certificates === undefined ? {} : { certificates }),
  };
}

export function parseSourceProfile(json: string): SourceProfile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new SourceProfileDecodeError("$", cause instanceof Error ? cause.message : String(cause));
  }
  return decodeSourceProfile(value);
}
