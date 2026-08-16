import { Schema } from "effect";

export const MessageVariant = Schema.Literals([
  "agent-switched",
  "model-switched",
  "user",
  "synthetic",
  "system",
  "skill",
  "shell",
  "assistant",
  "compaction",
]);
export type MessageVariant = typeof MessageVariant.Type;

export const CURRENT_MESSAGE_VARIANTS: ReadonlySet<MessageVariant> = new Set<MessageVariant>([
  "agent-switched",
  "model-switched",
  "user",
  "synthetic",
  "system",
  "skill",
  "shell",
  "assistant",
  "compaction",
]);

export const EventRowsCapability = Schema.Literals(["unavailable", "observed", "host-guaranteed"]);
export type EventRowsCapability = typeof EventRowsCapability.Type;

export class SourceCapabilities extends Schema.TaggedClass<SourceCapabilities>()(
  "OpenCodeV2SourceCapabilities",
  {
    sourceSchema: Schema.String,
    logicalSchema: Schema.String,
    projectedSessions: Schema.Literal(true),
    projectedMessages: Schema.Literal(true),
    pendingInput: Schema.Boolean,
    eventRows: EventRowsCapability,
    contentModel: Schema.ReadonlySet(MessageVariant),
  },
) {}

export const OPENCODE_V2_SOURCE_SCHEMA = "opencode-v2@f7545bfab4679747738aac5293faabfe13c3c26c";
export const COTAIL_LOGICAL_SCHEMA = "cotail-relations@1";
