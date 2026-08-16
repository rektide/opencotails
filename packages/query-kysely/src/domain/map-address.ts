import type { DocumentRelation } from "../relations/schema.ts";
import {
  attachmentAddress,
  contentAddress,
  documentAddress,
  messageAddress,
  sessionAddress,
  shellAddress,
  target,
  toolCallAddress,
  toolResultAddress,
  type DocumentAddress,
  type SourceKey,
  type Target,
} from "./address.ts";
import { messageID, sessionID, shellID } from "./identifier.ts";

export class RowDecodeError extends Error {
  public readonly documentKey: unknown;

  public constructor(message: string, documentKey: unknown) {
    super(message);
    this.name = "RowDecodeError";
    this.documentKey = documentKey;
  }
}

const fail = (row: DocumentRelation, message: string): never => {
  throw new RowDecodeError(message, row.documentKey);
};

function exactKey(row: DocumentRelation, expected: readonly unknown[]): number {
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.documentKey);
  } catch {
    return fail(row, "documentKey is not valid JSON");
  }
  if (!Array.isArray(decoded) || decoded.length !== expected.length + 1
    || JSON.stringify(decoded.slice(0, -1)) !== JSON.stringify(expected)) {
    return fail(row, "documentKey does not match document identity columns");
  }
  const segment = decoded.at(-1);
  if (!Number.isSafeInteger(segment) || (segment as number) < 0) {
    return fail(row, "document segment must be a non-negative safe integer");
  }
  return segment as number;
}

function present(row: DocumentRelation, name: keyof DocumentRelation): string | number {
  const value = row[name];
  return value === null ? fail(row, `${name} is required for ${row.ownerKind}`) : value as string | number;
}

function absent(row: DocumentRelation, names: readonly (keyof DocumentRelation)[]): void {
  for (const name of names) if (row[name] !== null) fail(row, `${name} is invalid for ${row.ownerKind}`);
}

export function mapDocumentAddress(row: DocumentRelation): DocumentAddress {
  const sid = sessionID(String(present(row, "sessionID")));
  const session = sessionAddress(sid);
  let owner;
  let identity: readonly unknown[];

  switch (row.ownerKind) {
    case "session":
      absent(row, ["messageID", "contentIndex", "nestedIndex", "nativeID", "messageSeq", "messageUpdatedAt"]);
      owner = session;
      identity = ["session", row.sessionID, row.field];
      break;
    case "message": {
      absent(row, ["projectID", "workspaceID", "contentIndex", "nestedIndex", "nativeID"]);
      const mid = messageID(String(present(row, "messageID")));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      owner = messageAddress(session, mid);
      identity = ["message", row.sessionID, row.messageID, row.field];
      break;
    }
    case "content": {
      absent(row, ["projectID", "workspaceID", "nestedIndex", "nativeID"]);
      const mid = messageID(String(present(row, "messageID")));
      const index = Number(present(row, "contentIndex"));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      owner = contentAddress(messageAddress(session, mid), index);
      identity = ["content", row.sessionID, row.messageID, index, row.field];
      break;
    }
    case "tool-call": {
      absent(row, ["projectID", "workspaceID", "nestedIndex"]);
      const mid = messageID(String(present(row, "messageID")));
      const index = Number(present(row, "contentIndex"));
      const native = String(present(row, "nativeID"));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      owner = toolCallAddress(contentAddress(messageAddress(session, mid), index), native);
      identity = ["tool-call", row.sessionID, row.messageID, index, native, row.field];
      break;
    }
    case "tool-result": {
      absent(row, ["projectID", "workspaceID"]);
      const mid = messageID(String(present(row, "messageID")));
      const index = Number(present(row, "contentIndex"));
      const nested = Number(present(row, "nestedIndex"));
      const native = String(present(row, "nativeID"));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      const call = toolCallAddress(contentAddress(messageAddress(session, mid), index), native);
      owner = toolResultAddress(call, nested);
      identity = ["tool-result", row.sessionID, row.messageID, index, native, nested, row.field];
      break;
    }
    case "shell": {
      absent(row, ["projectID", "workspaceID", "contentIndex", "nestedIndex"]);
      const mid = messageID(String(present(row, "messageID")));
      const native = shellID(String(present(row, "nativeID")));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      owner = shellAddress(messageAddress(session, mid), native);
      identity = ["shell", row.sessionID, row.messageID, native, row.field];
      break;
    }
    case "attachment": {
      absent(row, ["projectID", "workspaceID", "nestedIndex", "nativeID"]);
      const mid = messageID(String(present(row, "messageID")));
      const index = Number(present(row, "contentIndex"));
      present(row, "messageSeq");
      present(row, "messageUpdatedAt");
      owner = attachmentAddress(messageAddress(session, mid), index);
      identity = ["attachment", row.sessionID, row.messageID, index, row.field];
      break;
    }
    default:
      return fail(row, `unknown document owner kind: ${String(row.ownerKind)}`);
  }

  const segment = exactKey(row, identity);
  return documentAddress(owner, row.field, segment);
}

export const mapDocumentTarget = (
  source: SourceKey,
  row: DocumentRelation,
): Target<DocumentAddress> => target(source, mapDocumentAddress(row));
