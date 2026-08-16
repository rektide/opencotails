import assert from "node:assert/strict";
import test from "node:test";
import { mapDocumentTarget, RowDecodeError } from "../src/domain/map-address.ts";
import { sourceKey } from "../src/domain/address.ts";
import type { DocumentRelation } from "../src/relations/schema.ts";

const contentRow: DocumentRelation = {
  documentKey: JSON.stringify(["content", "ses_a", "msg_a", 2, "assistant.text", 0]),
  ownerKind: "content",
  sessionID: "ses_a",
  projectID: null,
  workspaceID: null,
  messageID: "msg_a",
  contentIndex: 2,
  nestedIndex: null,
  nativeID: null,
  field: "assistant.text",
  text: "alpha",
  messageSeq: 4,
  messageUpdatedAt: 9,
  fieldOrder: 200,
  exposure: "ordinary",
};

test("maps checked document rows to hierarchical Targets", () => {
  assert.deepEqual(mapDocumentTarget(sourceKey("fixture"), contentRow), {
    source: { kind: "opencode-v2", sourceID: "fixture" },
    address: {
      kind: "document",
      owner: {
        kind: "content",
        message: {
          kind: "message",
          session: { kind: "session", sessionID: "ses_a" },
          messageID: "msg_a",
        },
        index: 2,
      },
      field: "assistant.text",
      segment: 0,
    },
  });
});

test("rejects discriminator columns and keys that disagree", () => {
  assert.throws(
    () => mapDocumentTarget(sourceKey("fixture"), { ...contentRow, nativeID: "call_a" }),
    RowDecodeError,
  );
  assert.throws(
    () => mapDocumentTarget(sourceKey("fixture"), { ...contentRow, documentKey: "[]" }),
    /documentKey does not match/,
  );
});
