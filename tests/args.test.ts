import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SINCE_UPDATED_BACKFILL_MS,
  cutoffAt,
  isSinceUpdatedBackfillDisableValue,
  optionValue,
  parseDuration,
  parseSince,
  parseSinceSpec,
  parseSinceUpdatedBackfill,
} from "../src/args.ts";

const DAY = 86_400_000;

test("parseSince accepts ISO dates exactly and reports the requesting option", () => {
  assert.equal(parseSince("1970-01-30T00:00:00Z"), 29 * DAY);
  assert.equal(parseSince("1970-01-30T00:00:00Z", "--since-updated"), 29 * DAY);
  assert.throws(() => parseSince("wat"), /--since: unrecognized time "wat" \(use e\.g\. 24h, 7d, 30m, or an ISO date\)/);
  assert.throws(() => parseSince("wat", "--since-updated"), /--since-updated: unrecognized time "wat"/);
});

test("parseSince treats bare durations as relative cutoffs from now", () => {
  const before = Date.now();
  const cutoff = parseSince("2d");
  const after = Date.now();
  assert.ok(cutoff <= before - 2 * DAY && cutoff >= after - 2 * DAY);
});

test("since specifications preserve moving durations and fixed cutoffs", () => {
  const relative = parseSinceSpec("2d");
  assert.deepEqual(relative, { kind: "relative", durationMs: 2 * DAY });
  assert.equal(cutoffAt(relative, 10 * DAY), 8 * DAY);
  assert.equal(cutoffAt(relative, 11 * DAY), 9 * DAY);

  const absolute = parseSinceSpec("1970-01-30T00:00:00Z");
  assert.deepEqual(absolute, { kind: "absolute", cutoffMs: 29 * DAY });
  assert.equal(cutoffAt(absolute, 100 * DAY), 29 * DAY);
});

test("parseDuration provides checked watch intervals", () => {
  assert.equal(parseDuration("2s", "--interval"), 2_000);
  assert.throws(() => parseDuration("1.5s", "--interval"), /--interval: unrecognized duration/);
  assert.throws(() => parseDuration("99999999999999999999d", "--interval"), /out of range/);
});

test("optionValue handles space/equal forms without consuming another flag", () => {
  assert.deepEqual(optionValue(["--since", "2h"], 0, "--since"), { value: "2h", index: 1 });
  assert.deepEqual(optionValue(["--since=2h"], 0, "--since"), { value: "2h", index: 0 });
  assert.throws(() => optionValue(["--since", "--json"], 0, "--since"), /requires a value/u);
});

test("parseSinceUpdatedBackfill parses durations, never cutoff timestamps", () => {
  assert.equal(parseSinceUpdatedBackfill("30m"), 30 * 60_000);
  assert.equal(parseSinceUpdatedBackfill("24h"), 24 * 3_600_000);
  assert.equal(parseSinceUpdatedBackfill("21d"), DEFAULT_SINCE_UPDATED_BACKFILL_MS);
  assert.equal(parseSinceUpdatedBackfill("4w"), 28 * DAY);
  assert.equal(parseSinceUpdatedBackfill("0d"), 0);
  // ISO dates are cutoff spellings, not lookback windows, and must be rejected.
  assert.throws(() => parseSinceUpdatedBackfill("1970-01-30T00:00:00Z"), /unrecognized duration/);
});

test("parseSinceUpdatedBackfill disables on off, false, none, and -1", () => {
  for (const value of ["off", "false", "none", "-1"]) {
    assert.equal(isSinceUpdatedBackfillDisableValue(value), true);
    assert.equal(parseSinceUpdatedBackfill(value), "disabled");
  }
  assert.equal(isSinceUpdatedBackfillDisableValue("0"), false);
});

test("parseSinceUpdatedBackfill rejects malformed and out-of-range durations", () => {
  for (const value of ["21x", "1.5d", "", "d", "-2", "offt", "21D"]) {
    assert.throws(
      () => parseSinceUpdatedBackfill(value),
      /--since-updated-backfill: unrecognized duration ".*" \(use e\.g\. 30m, 24h, 21d, 4w, or off\/false\/none\/-1 to disable\)/,
      value,
    );
  }
  assert.throws(
    () => parseSinceUpdatedBackfill("99999999999999999999d"),
    /--since-updated-backfill: duration "99999999999999999999d" is out of range/,
  );
  assert.throws(
    () => parseSinceUpdatedBackfill("21x", "--other"),
    /--other: unrecognized duration "21x"/,
  );
});
