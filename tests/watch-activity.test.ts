import assert from "node:assert/strict";
import test from "node:test";
import type { MessageActivityObservation } from "@opencoattails/query-kysely";
import {
  waitForAbortableDelay,
  watchMessageActivity,
  type WatchActivityObservation,
} from "../src/watch/activity.ts";

function activity(messageID: string, createdAt: number): MessageActivityObservation {
  return {
    target: {
      source: { kind: "opencode-v2", sourceID: "fixture" },
      address: {
        kind: "message",
        session: { kind: "session", sessionID: "ses_fixture" },
        messageID,
      },
    },
    value: {
      messageType: "user",
      messageSeq: createdAt,
      createdAt,
      updatedAt: createdAt,
      session: { title: "Fixture", directory: "/fixture" },
    },
    read: { readScopeID: "fixture" as never, observedAt: createdAt },
  } as unknown as MessageActivityObservation;
}

test("emits deterministic initial and subsequent observations without duplicates", async () => {
  const samples = [
    [activity("msg_b", 20), activity("msg_a", 10)],
    [activity("msg_c", 30), activity("msg_b", 20), activity("msg_a", 10)],
    [activity("msg_c", 30), activity("msg_b", 20)],
  ];
  const emitted: WatchActivityObservation[] = [];
  let wakes = 0;
  const controller = new AbortController();
  await watchMessageActivity({
    source: { sample: async () => samples.shift() ?? [] },
    cutoffAt: () => 0,
    limit: 10,
    includeInitial: true,
    once: false,
    signal: controller.signal,
    now: () => 100 + wakes,
    wait: async () => {
      wakes++;
      if (wakes === 3) controller.abort();
    },
    emit: async (observation) => { emitted.push(observation); },
  });

  assert.deepEqual(emitted.map(({ observation, observedAt, activity: row }) => ({
    observation, observedAt, id: row.target.address.messageID,
  })), [
    { observation: "initial", observedAt: 100, id: "msg_a" },
    { observation: "initial", observedAt: 100, id: "msg_b" },
    { observation: "subsequent", observedAt: 101, id: "msg_c" },
  ]);
});

test("no-initial establishes a baseline and once never waits", async () => {
  const emitted: WatchActivityObservation[] = [];
  let waits = 0;
  await watchMessageActivity({
    source: { sample: async () => [activity("msg_a", 10)] },
    cutoffAt: () => 0,
    limit: 1,
    includeInitial: false,
    once: true,
    signal: new AbortController().signal,
    now: () => 100,
    wait: async () => { waits++; },
    emit: async (observation) => { emitted.push(observation); },
  });
  assert.deepEqual(emitted, []);
  assert.equal(waits, 0);
});

test("recomputes moving cutoffs and stops from an abortable wake", async () => {
  const cutoffs: number[] = [];
  let now = 100;
  const controller = new AbortController();
  await watchMessageActivity({
    source: { sample: async (cutoff) => { cutoffs.push(cutoff); return []; } },
    cutoffAt: (value) => value - 10,
    limit: 1,
    includeInitial: true,
    once: false,
    signal: controller.signal,
    now: () => now,
    wait: async () => {
      now = 200;
      if (cutoffs.length === 2) controller.abort();
    },
    emit: async () => {},
  });
  assert.deepEqual(cutoffs, [90, 190]);

  const waiting = new AbortController();
  const started = Date.now();
  const promise = waitForAbortableDelay(10_000, waiting.signal);
  waiting.abort();
  await promise;
  assert.ok(Date.now() - started < 1_000);
});

test("source and emitter failures remain visible", async () => {
  const options = {
    cutoffAt: () => 0,
    limit: 1,
    includeInitial: true,
    once: true,
    signal: new AbortController().signal,
    now: () => 0,
    wait: async () => {},
  } as const;
  await assert.rejects(watchMessageActivity({
    ...options,
    source: { sample: async () => { throw new Error("sample failed"); } },
    emit: async () => {},
  }), /sample failed/u);
  await assert.rejects(watchMessageActivity({
    ...options,
    source: { sample: async () => [activity("msg_a", 1)] },
    emit: async () => { throw new Error("emit failed"); },
  }), /emit failed/u);
});
