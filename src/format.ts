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
