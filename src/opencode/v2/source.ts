import type { DatabaseSync } from "node:sqlite";
import type { ContentQuery, PartType, SearchHit } from "../types.ts";
import { buildContentQuery, type Source, type VersionSchema } from "../source.ts";

export class V2Source implements Source {
  readonly version = "v2" as const;
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  searchContent(q: ContentQuery): SearchHit[] {
    const { sql, params } = buildContentQuery(this.schema(q.typeFilter), q);
    return this.db.prepare(sql).all(...params) as SearchHit[];
  }

  private schema(typeFilter: PartType): VersionSchema {
    const isTool = typeFilter === "tool";
    return {
      table: "event e",
      sessionRef: "json_extract(e.data, '$.sessionID') = s.id",
      typeExpr: `e.type = 'message.part.updated.1' AND json_extract(e.data, '$.part.type') = '${typeFilter}'`,
      textExpr: isTool ? "e.data" : "json_extract(e.data, '$.part.text')",
      snippetExpr: isTool ? "json_extract(e.data, '$.state.input')" : "json_extract(e.data, '$.part.text')",
      orderCol: "e.seq",
    };
  }
}
