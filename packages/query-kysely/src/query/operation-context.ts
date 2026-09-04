import type { ReadonlyQueryCreator } from "kysely/readonly";
import type { CotailSearchRelations } from "../relations/schema.ts";
import type { LogicalWorldScope } from "../relations/world.ts";

/** @internal Operation-owned access to shape-only direct-search projections. */
export const directSearchWorld = Symbol("@opencoattails/query-kysely/direct-search-world");

export type DirectSearchWorld = (
  scope?: LogicalWorldScope,
) => ReadonlyQueryCreator<CotailSearchRelations>;
