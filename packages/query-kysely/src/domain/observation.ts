import { Schema } from "effect";
import type { Address, Target } from "./address.ts";

export const ReadScopeID = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("ReadScopeID"),
);
export type ReadScopeID = typeof ReadScopeID.Type;

export interface ReadProvenance {
  readonly readScopeID: ReadScopeID;
  readonly observedAt: number;
}

export interface ProjectionRevision {
  readonly messageUpdatedAt: number;
  readonly payloadHash: string;
}

export interface Observation<A extends Address, V> {
  readonly target: Target<A>;
  readonly value: V;
  readonly read: ReadProvenance;
  readonly revision?: ProjectionRevision;
}

function timestamp(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

export const readProvenance = (readScopeID: ReadScopeID, observedAt: number): ReadProvenance => Object.freeze({
  readScopeID,
  observedAt: timestamp("observedAt", observedAt),
});

export const projectionRevision = (
  messageUpdatedAt: number,
  payloadHash: string,
): ProjectionRevision => Object.freeze({
  messageUpdatedAt: timestamp("messageUpdatedAt", messageUpdatedAt),
  payloadHash: nonEmpty("payloadHash", payloadHash),
});

export function observation<A extends Address, V>(input: {
  readonly target: Target<A>;
  readonly value: V;
  readonly read: ReadProvenance;
  readonly revision?: ProjectionRevision;
}): Observation<A, V> {
  const common = {
    target: input.target,
    value: input.value,
    read: input.read,
  };
  return Object.freeze(input.revision === undefined ? common : { ...common, revision: input.revision });
}
