import assert from "node:assert/strict";
import { validateHistoryRequest } from "@opencoattails/query-domain";

export function assertHistoryContract(): void {
  assert.doesNotThrow(() => validateHistoryRequest({ selector: {}, countSince: 0, limit: 0 }));
  assert.throws(() => validateHistoryRequest({ selector: {}, countSince: Number.NaN, limit: 0 }), /finite/);
}
