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

function supports(index: SqliteIndexFact, requirement: IndexRequirement): boolean {
  if (index.partial) return false;
  for (let position = 0; position < requirement.predicates.length; position++) {
    const predicate = requirement.predicates[position]!;
    if (!columnKey(index.keys[position], predicate.column, predicate.collation ?? "BINARY")) return false;
  }
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
  const index = table.indexes.find((candidate) => supports(candidate, requirement));
  return index === undefined
    ? { status: "unavailable" }
    : {
      status: "indexed",
      index: index.name,
      equality_prefix: requirement.predicates.map(({ column }) => column),
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
    Object.entries(requirements).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, requirement]) => [name, deriveIndexCapability(schema, requirement)]),
  );
}
