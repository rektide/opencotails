const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

export function parseSince(since: string): number {
  const m = /^(\d+)([smhdw])$/.exec(since);
  if (m) return Date.now() - Number(m[1]) * UNITS[m[2]]!;
  const abs = Date.parse(since);
  if (!Number.isNaN(abs)) return abs;
  throw new Error(`--since: unrecognized time "${since}" (use e.g. 24h, 7d, 30m, or an ISO date)`);
}
