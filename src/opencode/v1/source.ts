import type { DatabaseSync } from "node:sqlite";
import type { ContentQuery, PartType, SearchHit } from "../types.ts";
import { buildContentQuery, type Source, type VersionSchema } from "../source.ts";

export class V1Source implements Source {
  readonly version = "v1" as const;
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
      table: "part p",
      sessionRef: "p.session_id = s.id",
      typeExpr: `json_extract(p.data, '$.type') = '${typeFilter}'`,
      textExpr: isTool ? "p.data" : "json_extract(p.data, '$.text')",
      snippetExpr: isTool ? "json_extract(p.data, '$.state.input')" : "json_extract(p.data, '$.text')",
      orderCol: "p.time_created",
    };
  }
}
