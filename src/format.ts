const isTTY = process.stdout.isTTY;

export const C = {
  green: isTTY ? "\x1b[32m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  grey: isTTY ? "\x1b[90m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  reset: isTTY ? "\x1b[0m" : "",
};

export function emitJsonl(rows: object[]): void {
  for (const r of rows) process.stdout.write(JSON.stringify(r) + "\n");
}

export function emitTsv(headers: string[], rows: (string | number)[][]): void {
  process.stdout.write(headers.join("\t") + "\n");
  for (const row of rows) process.stdout.write(row.map(String).join("\t") + "\n");
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function renderTable(headers: string[], rows: string[][], footer?: string): void {
  if (rows.length === 0) {
    process.stdout.write(`${C.grey}(no sessions)${C.reset}\n`);
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join("  ");
  process.stdout.write(`${C.grey}${headerLine.trimEnd()}${C.reset}\n`);
  for (const row of rows) {
    process.stdout.write(row.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd() + "\n");
  }
  if (footer) process.stdout.write(`${C.grey}${footer}${C.reset}\n`);
}
