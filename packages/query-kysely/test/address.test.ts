import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentAddress,
  contentAddress,
  documentAddress,
  eventAddress,
  eventID,
  eventSequence,
  messageAddress,
  messageID,
  observation,
  projectAddress,
  projectID,
  projectionRevision,
  sessionAddress,
  sessionID,
  shellAddress,
  shellID,
  sourceKey,
  target,
  toolCallAddress,
  toolResultAddress,
  workspaceAddress,
  workspaceID,
  type Address,
  type MessageAddress,
  type Observation,
  type SessionAddress,
  type Target,
  type ToolCallAddress,
} from "../src/domain/index.ts";

test("constructs explicit hierarchical identities", () => {
  const session = sessionAddress(sessionID("ses_1"));
  const message = messageAddress(session, messageID("msg_1"));
  const content = contentAddress(message, 2);
  const call = toolCallAddress(content, "call_1");
  const result = toolResultAddress(call, 0);
  const document = documentAddress(result, "tool.output", 1);

  assert.deepEqual(document, {
    kind: "document",
    owner: {
      kind: "tool-result",
      call: {
        kind: "tool-call",
        content: {
          kind: "content",
          message: {
            kind: "message",
            session: { kind: "session", sessionID: "ses_1" },
            messageID: "msg_1",
          },
          index: 2,
        },
        callID: "call_1",
      },
      index: 0,
    },
    field: "tool.output",
    segment: 1,
  });
  assert.ok([session, message, content, call, result, document].every(Object.isFrozen));
});

test("constructs every root and message-owned address grain", () => {
  const session = sessionAddress(sessionID("ses_1"));
  const message = messageAddress(session, messageID("msg_1"));

  assert.deepEqual(shellAddress(message, shellID("sh_1")), {
    kind: "shell",
    message,
    shellID: "sh_1",
  });
  assert.deepEqual(attachmentAddress(message, 3), { kind: "attachment", message, index: 3 });
  assert.deepEqual(projectAddress(projectID("project")), { kind: "project", projectID: "project" });
  assert.deepEqual(workspaceAddress(workspaceID("workspace")), {
    kind: "workspace",
    workspaceID: "workspace",
  });
  assert.deepEqual(eventAddress("session:ses_1", eventSequence(7), eventID("evt_1")), {
    kind: "event",
    aggregateID: "session:ses_1",
    seq: 7,
    eventID: "evt_1",
  });
});

test("qualifies addresses by source and records projection provenance", () => {
  const address = contentAddress(
    messageAddress(sessionAddress(sessionID("ses_1")), messageID("msg_1")),
    0,
  );
  const located = target(sourceKey("local-opencode"), address);
  const revision = projectionRevision(1_720_000_000_000, "sha256:abc");
  const observed = observation({
    target: located,
    value: { text: "hello" },
    observedAt: 1_720_000_000_001,
    sourceSnapshot: "tx:42",
    revision,
  });

  assert.deepEqual(observed, {
    target: {
      source: { kind: "opencode-v2", sourceID: "local-opencode" },
      address,
    },
    value: { text: "hello" },
    observedAt: 1_720_000_000_001,
    sourceSnapshot: "tx:42",
    revision,
  });
  assert.ok(Object.isFrozen(located));
  assert.ok(Object.isFrozen(revision));
  assert.ok(Object.isFrozen(observed));
});

test("rejects malformed opaque values and derived coordinates", () => {
  assert.throws(() => sessionID("  "), /sessionID must not be empty/);
  assert.throws(() => sourceKey(""), /sourceID must not be empty/);
  assert.throws(() => eventSequence(-1), /non-negative safe integer/);
  assert.throws(() => eventSequence(1.5), /non-negative safe integer/);

  const message = messageAddress(sessionAddress(sessionID("ses_1")), messageID("msg_1"));
  assert.throws(() => contentAddress(message, -1), /content index/);
  assert.throws(() => attachmentAddress(message, Number.MAX_SAFE_INTEGER + 1), /attachment index/);
  assert.throws(() => toolCallAddress(contentAddress(message, 0), " "), /callID must not be empty/);
  assert.throws(
    () => documentAddress(message, "unknown" as "assistant.text", 0),
    /unknown document field/,
  );
  assert.throws(() => projectionRevision(-1, "hash"), /messageUpdatedAt/);
  assert.throws(() => projectionRevision(1, ""), /payloadHash/);
  assert.throws(
    () => observation({ target: target(sourceKey("source"), message), value: null, observedAt: 0, sourceSnapshot: "" }),
    /sourceSnapshot/,
  );
});

// These declarations are compiled by tsgo but never executed by node:test.
if (false) {
  const session = sessionAddress(sessionID("ses_1"));
  const message = messageAddress(session, messageID("msg_1"));
  const content = contentAddress(message, 0);
  const call = toolCallAddress(content, "call_1");
  const located = target(sourceKey("source"), message);

  const exactTarget: Target<MessageAddress> = located;
  const exactObservation: Observation<MessageAddress, { readonly text: string }> = observation({
    target: exactTarget,
    value: { text: "hello" },
    observedAt: 0,
    sourceSnapshot: "snapshot",
  });
  void exactObservation;

  // @ts-expect-error Message identity must retain its owning Session.
  const ownerlessMessage: MessageAddress = { kind: "message", messageID: messageID("msg_2") };
  // @ts-expect-error Tool calls require content identity, not only a Message.
  const ownerlessCall: ToolCallAddress = { kind: "tool-call", content: message, callID: "call_2" };
  // @ts-expect-error Native ID brands are not interchangeable.
  const wrongSession: SessionAddress = sessionAddress(messageID("msg_2"));
  // @ts-expect-error Address discriminants reject fields from another variant.
  const invalidCombination: Address = { kind: "session", sessionID: sessionID("ses_2"), messageID: messageID("msg_2") };
  // @ts-expect-error A Message target cannot be widened to a Session target.
  const wrongTarget: Target<SessionAddress> = located;

  void ownerlessMessage;
  void ownerlessCall;
  void wrongSession;
  void invalidCombination;
  void wrongTarget;
  void call;
}
