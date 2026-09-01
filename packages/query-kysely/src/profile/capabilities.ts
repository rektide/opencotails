import type {
  IndexCapability,
  IndexRequirement,
  SqliteIndexFact,
  SqliteIndexKeyFact,
  SqliteProfileSchema,
} from "./types.ts";

function columnKey(
  key: SqliteIndexKeyFact | undefined,
  column: string,
  collation: string,
): boolean {
  return key?.kind === "column" && key.column === column && key.collation.toUpperCase() === collation.toUpperCase();
}

function equalityPrefix(index: SqliteIndexFact, requirement: IndexRequirement): readonly string[] | undefined {
  if (index.partial) return undefined;
  const remaining = [...requirement.predicates];
  const prefix: string[] = [];
  for (let position = 0; position < requirement.predicates.length; position++) {
    const key = index.keys[position];
    if (key?.kind !== "column") return undefined;
    const match = remaining.findIndex((predicate) =>
      columnKey(key, predicate.column, predicate.collation ?? "BINARY"));
    if (match < 0) return undefined;
    prefix.push(key.column);
    remaining.splice(match, 1);
  }
  return prefix;
}

function supportsOrder(index: SqliteIndexFact, requirement: IndexRequirement): boolean {
  const order = requirement.order ?? [];
  if (order.length === 0) return true;
  const offset = requirement.predicates.length;
  const exact = order.every((item, position) => {
    const key = index.keys[offset + position];
    return columnKey(key, item.column, item.collation ?? "BINARY") && key.direction === item.direction;
  });
  if (exact) return true;
  return order.every((item, position) => {
    const key = index.keys[offset + position];
    return columnKey(key, item.column, item.collation ?? "BINARY")
      && key.direction === (item.direction === "asc" ? "desc" : "asc");
  });
}

export function deriveIndexCapability(
  schema: SqliteProfileSchema,
  requirement: IndexRequirement,
): IndexCapability {
  const table = schema.tables[requirement.table];
  if (table === undefined) return { status: "unavailable" };
  const match = table.indexes.map((index) => ({
    index,
    prefix: equalityPrefix(index, requirement),
  })).find(({ index, prefix }) => prefix !== undefined && supportsOrder(index, requirement));
  return match === undefined
    ? { status: "unavailable" }
    : {
      status: "indexed",
      index: match.index.name,
      equality_prefix: match.prefix!,
    };
}

export const SOURCE_PROFILE_INDEX_REQUIREMENTS = Object.freeze({
  "history.message_owner_lookup": {
    table: "session_message",
    predicates: [{ column: "session_id", operator: "equality", collation: "BINARY" }],
  },
  "message.timeline": {
    table: "session_message",
    predicates: [{ column: "session_id", operator: "equality", collation: "BINARY" }],
    order: [{ column: "seq", direction: "asc", collation: "BINARY" }],
  },
} as const satisfies Readonly<Record<string, IndexRequirement>>);

export function deriveIndexCapabilities(
  schema: SqliteProfileSchema,
  requirements: Readonly<Record<string, IndexRequirement>> = SOURCE_PROFILE_INDEX_REQUIREMENTS,
): Readonly<Record<string, IndexCapability>> {
  return Object.fromEntries(
    Object.entries(requirements).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, requirement]) => [name, deriveIndexCapability(schema, requirement)]),
  );
}
