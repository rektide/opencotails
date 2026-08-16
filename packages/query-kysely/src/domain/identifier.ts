type Branded<Value, Brand extends symbol> = Value & { readonly [Key in Brand]: true };

declare const sessionIDBrand: unique symbol;
declare const messageIDBrand: unique symbol;
declare const shellIDBrand: unique symbol;
declare const eventIDBrand: unique symbol;
declare const eventSequenceBrand: unique symbol;
declare const projectIDBrand: unique symbol;
declare const workspaceIDBrand: unique symbol;

export type SessionID = Branded<string, typeof sessionIDBrand>;
export type MessageID = Branded<string, typeof messageIDBrand>;
export type ShellID = Branded<string, typeof shellIDBrand>;
export type EventID = Branded<string, typeof eventIDBrand>;
export type EventSequence = Branded<number, typeof eventSequenceBrand>;
export type ProjectID = Branded<string, typeof projectIDBrand>;
export type WorkspaceID = Branded<string, typeof workspaceIDBrand>;

function opaqueID<Name extends string, ID extends string>(name: Name, value: string): ID {
  if (value.length === 0 || value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value as ID;
}

export const sessionID = (value: string): SessionID => opaqueID("sessionID", value);
export const messageID = (value: string): MessageID => opaqueID("messageID", value);
export const shellID = (value: string): ShellID => opaqueID("shellID", value);
export const eventID = (value: string): EventID => opaqueID("eventID", value);
export const projectID = (value: string): ProjectID => opaqueID("projectID", value);
export const workspaceID = (value: string): WorkspaceID => opaqueID("workspaceID", value);

export function eventSequence(value: number): EventSequence {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("event sequence must be a non-negative safe integer");
  }
  return value as EventSequence;
}
