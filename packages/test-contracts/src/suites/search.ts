import assert from "node:assert/strict";
import { matchesPatternSet, validateContentRequirements, validateDirectSearchRequest } from "@opencoattails/query-domain";

export function assertSearchContract(): void {
  assert.equal(matchesPatternSet("alpha beta", { all: [{ source: "alpha" }, { source: "beta" }] }), true);
  assert.equal(matchesPatternSet("alpha", { any: [{ source: "beta" }, { source: "alpha" }] }), true);
  assert.equal(matchesPatternSet("alpha blocked", { none: [{ source: "blocked" }] }), false);
  assert.equal(matchesPatternSet("alpha beta", {
    all: [{ source: "alpha" }],
    any: [{ source: "gamma" }, { source: "beta" }],
    none: [{ source: "blocked" }],
  }), true);

  for (const group of ["all", "any", "none"] as const) {
    assert.throws(() => validateContentRequirements({ [group]: [] }), /must not be empty/);
  }
  assert.throws(() => validateContentRequirements({}), /must contain/);
  assert.throws(() => validateContentRequirements({ all: [{ types: [], text: { all: [{ source: "x" }] } }] }), /types must not be empty/);
  assert.throws(() => validateContentRequirements({ all: [{ types: ["text", "text"], text: { all: [{ source: "x" }] } }] }), /duplicates/);
  assert.throws(() => validateContentRequirements({ all: [{ types: ["text"], roles: [], text: { all: [{ source: "x" }] } }] }), /roles must not be empty/);
  assert.throws(() => validateContentRequirements({ all: [{ types: ["text"], text: { all: [{ source: "(" }] } }] }), /invalid regex/);
  assert.throws(() => validateDirectSearchRequest({ selector: {}, title: { all: [{ source: "x" }] }, evidence: false, limit: 1.5 }), /safe integer/);
  assert.throws(() => validateDirectSearchRequest({ selector: { updated: { from: 2, to: 2 } }, title: { all: [{ source: "x" }] }, evidence: false, limit: 1 }), /half-open/);
}
