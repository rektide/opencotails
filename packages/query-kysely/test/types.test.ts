import test from "node:test";
import type { Effect } from "effect";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import type { CotailRelations } from "../src/relations/schema.ts";
import type {
  CompiledLogicalQuery,
  LogicalQueryShape,
  QueryError,
} from "../src/query/logical-query.ts";
import { all } from "../src/query/logical-query.ts";
import type { QueryCompileError } from "../src/query/errors.ts";

test("logical query callbacks preserve output and hide physical schema", () => {
  const check = (query: LogicalQueryShape, db: ReadonlyQueryCreator<CotailRelations>) => {
    const rows: Effect.Effect<
      Readonly<Array<{ sessionID: string; messageSeq: number }>>,
      QueryError
    > = all(query, ({ db: logical }) => logical.selectFrom("cotail_message")
      .select(["sessionID", "messageSeq"]));

    const compiled: Effect.Effect<
      CompiledLogicalQuery<{ sessionID: string; title: string | null }>,
      QueryCompileError
    > = query.compile(({ db: logical }) => logical.selectFrom("cotail_session")
      .select(["sessionID", "title"]));

    // @ts-expect-error physical tables are absent from the logical world
    db.selectFrom("session_v2");
    // @ts-expect-error unknown logical columns cannot be selected
    db.selectFrom("cotail_session").select("physical_secret");
    return { rows, compiled };
  };
  void check;
});
