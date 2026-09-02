import assert from "node:assert/strict";
import test from "node:test";
import {
  activityOutputRecord,
  humanActivityLine,
  humanWatchActivityLine,
  watchActivityOutputRecord,
} from "../src/activity-output.ts";
import type { MessageActivityObservation } from "@opencoattails/query-kysely";

const activity = {
  target: {
    source: { kind: "opencode-v2", sourceID: "fixture" },
    address: {
      kind: "message",
      session: { kind: "session", sessionID: "ses_a" },
      messageID: "msg_a",
    },
  },
  value: {
    messageType: "assistant",
    messageSeq: 3,
    createdAt: 1_000,
    updatedAt: 2_000,
    session: { title: "two\nlines", directory: "/work\tarea" },
  },
  read: { readScopeID: "read" as never, observedAt: 3_000 },
} as unknown as MessageActivityObservation;

test("activity output preserves stable identities and ISO timestamps", () => {
  assert.deepEqual(activityOutputRecord(activity), {
    source_id: "fixture",
    session_id: "ses_a",
    message_id: "msg_a",
    message_type: "assistant",
    message_seq: 3,
    time_created: "1970-01-01T00:00:01.000Z",
    time_updated: "1970-01-01T00:00:02.000Z",
    session_title: "two\nlines",
    session_directory: "/work\tarea",
  });
});

test("human activity is exactly one tab-delimited physical line", () => {
  assert.equal(humanActivityLine(activityOutputRecord(activity)),
    "1970-01-01T00:00:01.000Z\tassistant\tfixture\tses_a\tmsg_a\t3\ttwo lines\t/work area\n");
});

test("watch output labels snapshot observations without calling them events", () => {
  const record = watchActivityOutputRecord({ observation: "subsequent", observedAt: 4_000, activity });
  assert.deepEqual(record, {
    observation: "subsequent",
    observed_at: "1970-01-01T00:00:04.000Z",
    source_id: "fixture",
    session_id: "ses_a",
    message_id: "msg_a",
    message_type: "assistant",
    message_seq: 3,
    time_created: "1970-01-01T00:00:01.000Z",
    time_updated: "1970-01-01T00:00:02.000Z",
    session_title: "two\nlines",
    session_directory: "/work\tarea",
  });
  assert.equal(humanWatchActivityLine(record),
    "1970-01-01T00:00:04.000Z\tsubsequent\t1970-01-01T00:00:01.000Z\tassistant\tfixture\tses_a\tmsg_a\t3\ttwo lines\t/work area\n");
});
