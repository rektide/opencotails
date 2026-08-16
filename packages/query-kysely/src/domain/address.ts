import type {
  EventID,
  EventSequence,
  MessageID,
  ProjectID,
  SessionID,
  ShellID,
  WorkspaceID,
} from "./identifier.ts";

export interface SessionAddress {
  readonly kind: "session";
  readonly sessionID: SessionID;
}

export interface MessageAddress {
  readonly kind: "message";
  readonly session: SessionAddress;
  readonly messageID: MessageID;
}

export interface ContentAddress {
  readonly kind: "content";
  readonly message: MessageAddress;
  readonly index: number;
}

export interface ToolCallAddress {
  readonly kind: "tool-call";
  readonly content: ContentAddress;
  readonly callID: string;
}

export interface ToolResultAddress {
  readonly kind: "tool-result";
  readonly call: ToolCallAddress;
  readonly index: number;
}

export interface ShellAddress {
  readonly kind: "shell";
  readonly message: MessageAddress;
  readonly shellID: ShellID;
}

export interface AttachmentAddress {
  readonly kind: "attachment";
  readonly message: MessageAddress;
  readonly index: number;
}

export interface ProjectAddress {
  readonly kind: "project";
  readonly projectID: ProjectID;
}

export interface WorkspaceAddress {
  readonly kind: "workspace";
  readonly workspaceID: WorkspaceID;
}

export interface EventAddress {
  readonly kind: "event";
  readonly aggregateID: string;
  readonly seq: EventSequence;
  readonly eventID: EventID;
}

export type EntityAddress =
  | SessionAddress
  | MessageAddress
  | ContentAddress
  | ToolCallAddress
  | ToolResultAddress
  | ShellAddress
  | AttachmentAddress
  | ProjectAddress
  | WorkspaceAddress
  | EventAddress;

export type DocumentField =
  | "user.text"
  | "synthetic.text"
  | "system.text"
  | "skill.text"
  | "assistant.text"
  | "assistant.reasoning"
  | "tool.name"
  | "tool.input"
  | "tool.output"
  | "tool.error"
  | "shell.command"
  | "shell.output"
  | "attachment.name"
  | "attachment.description"
  | "attachment.uri"
  | "compaction.summary"
  | "compaction.recent"
  | "compaction.error"
  | "session.title"
  | "session.location"
  | "project.name"
  | "project.root"
  | "workspace.provider"
  | "event.payload";

export interface DocumentAddress {
  readonly kind: "document";
  readonly owner: EntityAddress;
  readonly field: DocumentField;
  readonly segment: number;
}

export type Address = EntityAddress | DocumentAddress;

export interface SourceKey {
  readonly kind: "opencode-v2";
  readonly sourceID: string;
}

export interface Target<A extends Address = Address> {
  readonly source: SourceKey;
  readonly address: A;
}

const documentFields: ReadonlySet<string> = new Set<DocumentField>([
  "user.text",
  "synthetic.text",
  "system.text",
  "skill.text",
  "assistant.text",
  "assistant.reasoning",
  "tool.name",
  "tool.input",
  "tool.output",
  "tool.error",
  "shell.command",
  "shell.output",
  "attachment.name",
  "attachment.description",
  "attachment.uri",
  "compaction.summary",
  "compaction.recent",
  "compaction.error",
  "session.title",
  "session.location",
  "project.name",
  "project.root",
  "workspace.provider",
  "event.payload",
]);

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

function coordinate(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

export const sessionAddress = (sessionID: SessionID): SessionAddress =>
  Object.freeze({ kind: "session", sessionID });

export const messageAddress = (session: SessionAddress, messageID: MessageID): MessageAddress =>
  Object.freeze({ kind: "message", session, messageID });

export const contentAddress = (message: MessageAddress, index: number): ContentAddress =>
  Object.freeze({ kind: "content", message, index: coordinate("content index", index) });

export const toolCallAddress = (content: ContentAddress, callID: string): ToolCallAddress =>
  Object.freeze({ kind: "tool-call", content, callID: nonEmpty("callID", callID) });

export const toolResultAddress = (call: ToolCallAddress, index: number): ToolResultAddress =>
  Object.freeze({ kind: "tool-result", call, index: coordinate("tool result index", index) });

export const shellAddress = (message: MessageAddress, shellID: ShellID): ShellAddress =>
  Object.freeze({ kind: "shell", message, shellID });

export const attachmentAddress = (message: MessageAddress, index: number): AttachmentAddress =>
  Object.freeze({ kind: "attachment", message, index: coordinate("attachment index", index) });

export const projectAddress = (projectID: ProjectID): ProjectAddress =>
  Object.freeze({ kind: "project", projectID });

export const workspaceAddress = (workspaceID: WorkspaceID): WorkspaceAddress =>
  Object.freeze({ kind: "workspace", workspaceID });

export const eventAddress = (
  aggregateID: string,
  seq: EventSequence,
  eventID: EventID,
): EventAddress => Object.freeze({ kind: "event", aggregateID: nonEmpty("aggregateID", aggregateID), seq, eventID });

export function documentAddress(
  owner: EntityAddress,
  field: DocumentField,
  segment: number,
): DocumentAddress {
  if (!documentFields.has(field)) {
    throw new TypeError(`unknown document field: ${String(field)}`);
  }
  return Object.freeze({ kind: "document", owner, field, segment: coordinate("document segment", segment) });
}

export const sourceKey = (sourceID: string): SourceKey =>
  Object.freeze({ kind: "opencode-v2", sourceID: nonEmpty("sourceID", sourceID) });

export const target = <A extends Address>(source: SourceKey, address: A): Target<A> =>
  Object.freeze({ source, address });
