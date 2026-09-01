import { spawn } from "node:child_process";

export interface OpenCodeVersionResult {
  readonly version: string;
  readonly diagnostics: string;
}

export class OpenCodeVersionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenCodeVersionError";
  }
}

function cleanOutput(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "").trim();
}

export function parseOpenCodeVersionOutput(stdout: string, stderr = ""): string {
  const parse = (output: string): string | undefined => {
    const clean = cleanOutput(output);
    const named = /(?:^|\s)opencode(?:2)?(?:\s+version)?\s+v?([^\s]+)/imu.exec(clean);
    if (named !== null) return named[1]!.replace(/^v(?=\d)/u, "");
    const versionLike = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z._-]+)?)(?=\s|$)/u.exec(clean);
    if (versionLike !== null) return versionLike[1]!;
    const opaque = clean.split(/\r?\n/u).map((line) => line.trim()).findLast((line) => /^v?[^\s]+$/u.test(line));
    return opaque?.replace(/^v(?=\d)/u, "");
  };
  const parsed = parse(stdout) ?? parse(stderr);
  if (parsed !== undefined) return parsed;
  throw new OpenCodeVersionError("could not parse OpenCode version output");
}

export function runOpenCodeVersion(executable: string): Promise<OpenCodeVersionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (next.length > 1024 * 1024) child.kill();
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (cause) => reject(new OpenCodeVersionError(
      `failed to run ${executable} --version: ${cause.message}`,
    )));
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new OpenCodeVersionError(
          `${executable} --version failed${signal === null ? ` with exit code ${code}` : ` from signal ${signal}`}`,
        ));
        return;
      }
      try {
        resolve({ version: parseOpenCodeVersionOutput(stdout, stderr), diagnostics: stderr });
      } catch (cause) {
        reject(cause);
      }
    });
  });
}
