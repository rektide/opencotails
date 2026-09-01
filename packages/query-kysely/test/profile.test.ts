import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createSourceProfile,
  decodeSourceProfile,
  deriveIndexCapability,
  extractSqliteProfileSchema,
  SourceProfileDecodeError,
  UnsupportedObservedMessageVariantsError,
} from "../src/profile/index.ts";

function indexedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT ('user'),
      seq INTEGER NOT NULL,
      normalized_type TEXT GENERATED ALWAYS AS (lower(type)) VIRTUAL
    );
    CREATE INDEX wrong_order_idx ON session_message(seq, session_id);
    CREATE INDEX owner_timeline_idx ON session_message(
      session_id COLLATE BINARY ASC,
      seq COLLATE BINARY DESC
    );
    CREATE INDEX expression_idx ON session_message(lower(type), session_id);
    CREATE INDEX partial_owner_idx ON session_message(session_id) WHERE type = 'user';
  `);
  return database;
}

test("extracts canonical table_xinfo, index_list, and index_xinfo facts", () => {
  const database = indexedDatabase();
  try {
    const schema = extractSqliteProfileSchema(database, ["session_message"]);
    const table = schema.tables.session_message!;
    assert.equal(schema.normalized_hash.startsWith("sha256:"), true);
    assert.deepEqual(table.columns.at(-1), {
      cid: 4,
      name: "normalized_type",
      type: "TEXT",
      not_null: false,
      default_value: null,
      primary_key: 0,
      hidden: 2,
    });

    const owner = table.indexes.find((index) => index.name === "owner_timeline_idx")!;
    assert.equal(owner.unique, false);
    assert.equal(owner.partial, false);
    assert.equal(owner.origin, "c");
    assert.deepEqual(owner.keys, [
      { sequence: 0, kind: "column", column: "session_id", collation: "BINARY", direction: "asc" },
      { sequence: 1, kind: "column", column: "seq", collation: "BINARY", direction: "desc" },
    ]);
    assert.deepEqual(owner.auxiliary, [{ sequence: 2, kind: "rowid" }]);

    const expression = table.indexes.find((index) => index.name === "expression_idx")!;
    assert.deepEqual(expression.keys[0], {
      sequence: 0,
      kind: "expression",
      expression: "lower ( type )",
      collation: "BINARY",
      direction: "asc",
    });
    assert.equal(table.indexes.find((index) => index.name === "partial_owner_idx")!.predicate, "type = 'user'");
  } finally {
    database.close();
  }
});

test("hashes structured extracted facts independent of CREATE statement whitespace", () => {
  const left = new DatabaseSync(":memory:");
  const right = new DatabaseSync(":memory:");
  try {
    left.exec("CREATE TABLE item (id TEXT, value INTEGER DEFAULT (1 + 2)); CREATE INDEX item_idx ON item (id, value)");
    right.exec(`
      CREATE TABLE item(
        id TEXT,
        value INTEGER DEFAULT( 1+2 )
      );
      CREATE INDEX item_idx ON item(id,value);
    `);
    assert.equal(
      extractSqliteProfileSchema(left, ["item"]).normalized_hash,
      extractSqliteProfileSchema(right, ["item"]).normalized_hash,
    );
  } finally {
    left.close();
    right.close();
  }
});

test("extracts columns and indexes independently when explicit validation selects one fact family", () => {
  const database = indexedDatabase();
  try {
    const columns = extractSqliteProfileSchema(database, ["session_message"], {
      columns: true,
      indexes: false,
    });
    assert.equal(columns.tables.session_message!.columns.length, 5);
    assert.deepEqual(columns.tables.session_message!.indexes, []);

    const indexes = extractSqliteProfileSchema(database, ["session_message"], {
      columns: false,
      indexes: true,
    });
    assert.deepEqual(indexes.tables.session_message!.columns, []);
    assert.equal(indexes.tables.session_message!.indexes.length, 5);
  } finally {
    database.close();
  }
});

test("derives capabilities using leftmost keys, collation, direction, expressions, and partial-index safety", () => {
  const database = indexedDatabase();
  try {
    const schema = extractSqliteProfileSchema(database, ["session_message"]);
    assert.deepEqual(deriveIndexCapability(schema, {
      table: "session_message",
      predicates: [{ column: "session_id", operator: "equality", collation: "BINARY" }],
      order: [{ column: "seq", direction: "desc", collation: "BINARY" }],
    }), {
      status: "indexed",
      index: "owner_timeline_idx",
      equality_prefix: ["session_id"],
    });
    assert.deepEqual(deriveIndexCapability(schema, {
      table: "session_message",
      predicates: [{ column: "session_id", operator: "equality", collation: "NOCASE" }],
    }), { status: "unavailable" });

    database.exec("DROP INDEX owner_timeline_idx");
    const partialOnly = extractSqliteProfileSchema(database, ["session_message"]);
    assert.deepEqual(deriveIndexCapability(partialOnly, {
      table: "session_message",
      predicates: [{ column: "session_id", operator: "equality", collation: "BINARY" }],
    }), { status: "unavailable" });
  } finally {
    database.close();
  }
});

test("derives equality prefixes in index order rather than predicate declaration order", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE item (a TEXT, b TEXT); CREATE INDEX item_ab_idx ON item(a, b)");
    const schema = extractSqliteProfileSchema(database, ["item"]);
    assert.deepEqual(deriveIndexCapability(schema, {
      table: "item",
      predicates: [
        { column: "b", operator: "equality" },
        { column: "a", operator: "equality" },
      ],
    }), {
      status: "indexed",
      index: "item_ab_idx",
      equality_prefix: ["a", "b"],
    });
  } finally {
    database.close();
  }
});

test("strictly decodes complete profiles without rebuilding supported variants", () => {
  const database = indexedDatabase();
  try {
    const profile = createSourceProfile({
      profileID: "fixture",
      generatedAt: "2026-09-01T12:00:00.000Z",
      generatorVersion: "0.1.0",
      executable: "opencode2",
      opencodeVersion: "0.0.0-local-fixture",
      sourcePath: "/data/opencode.db",
      schema: extractSqliteProfileSchema(database, ["session_message"]),
      supportedMessageVariants: ["assistant", "location-switched"],
      observedMessageVariants: ["location-switched"],
    });
    assert.deepEqual(decodeSourceProfile(JSON.parse(JSON.stringify(profile))), profile);

    const malformed = structuredClone(profile) as unknown as Record<string, unknown>;
    (malformed.source as Record<string, unknown>).unexpected = true;
    assert.throws(() => decodeSourceProfile(malformed), SourceProfileDecodeError);

    const noCompatibleVersion = structuredClone(profile) as unknown as Record<string, unknown>;
    (noCompatibleVersion.opencode as Record<string, unknown>).compatible_versions = [];
    assert.throws(() => decodeSourceProfile(noCompatibleVersion), /expected at least one version/u);

    for (const generatedAt of [
      "2026-09-01",
      "2026-09-01T12:00:00Z",
      "2026-09-01T12:00:00.000+00:00",
      "2026-02-30T12:00:00.000Z",
    ]) {
      const nonCanonical = structuredClone(profile) as unknown as Record<string, unknown>;
      nonCanonical.generated_at = generatedAt;
      assert.throws(() => decodeSourceProfile(nonCanonical), /expected canonical ISO timestamp/u);
    }

    const inconsistent = {
      ...structuredClone(profile),
      content: {
        ...profile.content,
        supported_message_variants: ["assistant"],
      },
    };
    assert.throws(() => decodeSourceProfile(inconsistent), /observed variant is not recorded as supported/u);
  } finally {
    database.close();
  }
});

test("profile construction rejects observed variants unsupported by the supplied build facts", () => {
  const database = indexedDatabase();
  try {
    assert.throws(() => createSourceProfile({
      profileID: "fixture",
      generatedAt: "2026-09-01T12:00:00.000Z",
      generatorVersion: "0.1.0",
      executable: "opencode",
      opencodeVersion: "1.0.0",
      sourcePath: "/data/opencode.db",
      schema: extractSqliteProfileSchema(database, ["session_message"]),
      supportedMessageVariants: ["assistant"],
      observedMessageVariants: ["assistant", "location-switched"],
    }), (error) => {
      assert(error instanceof UnsupportedObservedMessageVariantsError);
      assert.deepEqual(error.variants, ["location-switched"]);
      return true;
    });
  } finally {
    database.close();
  }
});

test("profile construction rejects an empty explicit compatible-version allowlist", () => {
  const database = indexedDatabase();
  try {
    assert.throws(() => createSourceProfile({
      profileID: "fixture",
      generatedAt: "2026-09-01T12:00:00.000Z",
      generatorVersion: "0.1.0",
      executable: "opencode",
      opencodeVersion: "1.0.0",
      compatibleVersions: [],
      sourcePath: "/data/opencode.db",
      schema: extractSqliteProfileSchema(database, ["session_message"]),
      supportedMessageVariants: ["assistant"],
      observedMessageVariants: ["assistant"],
    }), /compatibleVersions must contain at least one version/u);
  } finally {
    database.close();
  }
});
