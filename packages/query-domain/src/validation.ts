import type { HistoryRequest } from "./history.ts";
import type {
  ContentRequirement,
  ContentRequirements,
  DirectSearchRequest,
  PatternSet,
  TextPattern,
} from "./search.ts";
import type { ResolveRequest, SessionSelector } from "./session.ts";

const GROUPS = ["all", "any", "none"] as const;

function assertFinite(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertDistinct(values: readonly string[] | undefined, name: string): void {
  if (values === undefined) return;
  if (values.length === 0) throw new Error(`${name} must not be empty`);
  if (new Set(values).size !== values.length) throw new Error(`${name} must not contain duplicates`);
  if (values.some((value) => value.length === 0)) throw new Error(`${name} values must not be empty`);
}

export function validateTextPattern(pattern: TextPattern): void {
  if (pattern.source.length === 0) throw new Error("pattern source must not be empty");
  if ((pattern.mode ?? "regex") === "regex") {
    try {
      new RegExp(pattern.source, pattern.caseSensitive ? "" : "i");
    } catch (error) {
      throw new Error(`invalid regex: ${(error as Error).message}`);
    }
  }
}

export function validatePatternSet(patterns: PatternSet): void {
  let present = false;
  for (const group of GROUPS) {
    const members = patterns[group];
    if (members === undefined) continue;
    present = true;
    if (members.length === 0) throw new Error(`pattern ${group} must not be empty`);
    for (const pattern of members) validateTextPattern(pattern);
  }
  if (!present) throw new Error("pattern set must contain all, any, or none");
}

export function validateContentRequirement(requirement: ContentRequirement): void {
  assertDistinct(requirement.types, "requirement types");
  assertDistinct(requirement.roles, "requirement roles");
  validatePatternSet(requirement.text);
}

export function validateContentRequirements(requirements: ContentRequirements): void {
  let present = false;
  for (const group of GROUPS) {
    const members = requirements[group];
    if (members === undefined) continue;
    present = true;
    if (members.length === 0) throw new Error(`requirements ${group} must not be empty`);
    for (const requirement of members) validateContentRequirement(requirement);
  }
  if (!present) throw new Error("requirements must contain all, any, or none");
}

export function validateSessionSelector(selector: SessionSelector): void {
  assertDistinct(selector.ids, "selector ids");
  assertDistinct(selector.projectIds, "selector project ids");
  if (selector.directory?.value.length === 0) throw new Error("directory value must not be empty");
  assertFinite(selector.updated?.from, "updated.from");
  assertFinite(selector.updated?.to, "updated.to");
  if (selector.updated?.from !== undefined && selector.updated.to !== undefined && selector.updated.from >= selector.updated.to) {
    throw new Error("updated range must be half-open with from < to");
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("limit must be a non-negative safe integer");
}

export function validateDirectSearchRequest(request: DirectSearchRequest): void {
  validateSessionSelector(request.selector);
  validateLimit(request.limit);
  if (request.title === undefined && request.requirements === undefined) throw new Error("search requires title or content requirements");
  if (request.title !== undefined) validatePatternSet(request.title);
  if (request.requirements !== undefined) validateContentRequirements(request.requirements);
}

export function validateHistoryRequest(request: HistoryRequest): void {
  validateSessionSelector(request.selector);
  validateLimit(request.limit);
  assertFinite(request.countSince, "countSince");
}

export function validateResolveRequest(request: ResolveRequest): void {
  validateSessionSelector(request.selector);
}

function matchesPattern(value: string, pattern: TextPattern): boolean {
  const source = pattern.mode === "literal" ? pattern.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern.source;
  return new RegExp(source, pattern.caseSensitive ? "" : "i").test(value);
}

export function matchesPatternSet(value: string, patterns: PatternSet): boolean {
  validatePatternSet(patterns);
  return (patterns.all?.every((pattern) => matchesPattern(value, pattern)) ?? true)
    && (patterns.any?.some((pattern) => matchesPattern(value, pattern)) ?? true)
    && (patterns.none?.every((pattern) => !matchesPattern(value, pattern)) ?? true);
}
