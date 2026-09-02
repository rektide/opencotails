const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

export function parseDirectoryArg(value: string | undefined): string {
  if (value === undefined || value.startsWith("-")) {
    throw new Error("--directory requires a path");
  }
  return value;
}

export function optionValue(
  argv: readonly string[],
  index: number,
  name: string,
): { readonly value: string; readonly index: number } {
  const argument = argv[index]!;
  if (argument === name) {
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    return { value, index: index + 1 };
  }
  const value = argument.slice(name.length + 1);
  if (value.length === 0) throw new Error(`${name} requires a value`);
  return { value, index };
}

function durationMs(value: string): number | undefined {
  const m = /^(\d+)([smhdw])$/.exec(value);
  return m === null ? undefined : Number(m[1]) * UNITS[m[2]]!;
}

export type SinceSpec =
  | { readonly kind: "relative"; readonly durationMs: number }
  | { readonly kind: "absolute"; readonly cutoffMs: number };

export function parseSinceSpec(since: string, option = "--since"): SinceSpec {
  const relative = durationMs(since);
  if (relative !== undefined) {
    if (!Number.isSafeInteger(relative)) throw new Error(`${option}: duration "${since}" is out of range`);
    return { kind: "relative", durationMs: relative };
  }
  const absolute = Date.parse(since);
  if (!Number.isNaN(absolute)) return { kind: "absolute", cutoffMs: absolute };
  throw new Error(`${option}: unrecognized time "${since}" (use e.g. 24h, 7d, 30m, or an ISO date)`);
}

export function cutoffAt(spec: SinceSpec, now: number): number {
  return spec.kind === "relative" ? now - spec.durationMs : spec.cutoffMs;
}

export function parseDuration(value: string, option: string): number {
  const duration = durationMs(value);
  if (duration === undefined) {
    throw new Error(`${option}: unrecognized duration "${value}" (use e.g. 2s, 30m, or 1h)`);
  }
  if (!Number.isSafeInteger(duration)) throw new Error(`${option}: duration "${value}" is out of range`);
  return duration;
}

export function parseSince(since: string, option = "--since"): number {
  return cutoffAt(parseSinceSpec(since, option), Date.now());
}

/** Message history lookback behind a `--since-updated` cutoff, or `"disabled"`. */
export type SinceUpdatedBackfill = number | "disabled";

export const DEFAULT_SINCE_UPDATED_BACKFILL_MS = 21 * UNITS.d!;

export const SINCE_UPDATED_BACKFILL_DISABLE_VALUES = ["off", "false", "none", "-1"] as const;

export function isSinceUpdatedBackfillDisableValue(value: string): boolean {
  return (SINCE_UPDATED_BACKFILL_DISABLE_VALUES as readonly string[]).includes(value);
}

/**
 * Parses a backfill window duration (`30m`, `24h`, `21d`, `4w`), never a
 * cutoff timestamp. `off`, `false`, `none`, and `-1` disable the window.
 */
export function parseSinceUpdatedBackfill(
  value: string,
  option = "--since-updated-backfill",
): SinceUpdatedBackfill {
  if (isSinceUpdatedBackfillDisableValue(value)) return "disabled";
  const duration = durationMs(value);
  if (duration === undefined) {
    throw new Error(
      `${option}: unrecognized duration "${value}" `
        + "(use e.g. 30m, 24h, 21d, 4w, or off/false/none/-1 to disable)",
    );
  }
  if (!Number.isSafeInteger(duration)) {
    throw new Error(`${option}: duration "${value}" is out of range`);
  }
  return duration;
}
