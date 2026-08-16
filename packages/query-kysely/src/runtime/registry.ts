import {
  QueryCapability,
  QueryInstanceId,
  queryFactory,
  queryKey,
} from "@opencoattails/query-runtime";
import { Effect } from "effect";
import type { LogicalQueryShape } from "../query/logical-query.ts";
import { acquireNodeOpenCodeSource, type NodeOpenCodeSourceConfig } from "./node-sqlite.ts";

export const logicalKyselyQueryKey = queryKey<LogicalQueryShape>(
  QueryInstanceId.make("opencode-v2.logical-kysely"),
);

export const logicalKyselyCapability = QueryCapability.make("logical-kysely");
export const openCodeV2Capability = QueryCapability.make("opencode-v2");

export const nodeLogicalKyselyQueryFactory = (config: NodeOpenCodeSourceConfig) => queryFactory({
  key: logicalKyselyQueryKey,
  capabilities: [logicalKyselyCapability, openCodeV2Capability],
  acquire: () => acquireNodeOpenCodeSource(config).pipe(Effect.map((source) => source.query)),
});
