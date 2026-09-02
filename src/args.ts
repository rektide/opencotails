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

function durationMs(value: string): number | undefined {
  const m = /^(\d+)([smhdw])$/.exec(value);
  return m === null ? undefined : Number(m[1]) * UNITS[m[2]]!;
}

export function parseSince(since: string, option = "--since"): number {
  const relative = durationMs(since);
  if (relative !== undefined) return Date.now() - relative;
  const abs = Date.parse(since);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(`${option}: unrecognized time "${since}" (use e.g. 24h, 7d, 30m, or an ISO date)`);
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
