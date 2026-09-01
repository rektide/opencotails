import { spawn } from "node:child_process";

export interface OpenCodeVersionResult {
  readonly version: string;
  readonly diagnostics: string;
}

export interface OpenCodeVersionOptions {
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
  readonly terminateGraceMs?: number;
}

export class OpenCodeVersionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenCodeVersionError";
  }
}

const VERSION_TOKEN = "[A-Za-z0-9][A-Za-z0-9._+-]*";
const NAMED_VERSION = new RegExp(`^(?:opencode|opencode2)\\s+v(${VERSION_TOKEN})$`, "iu");
const BARE_RELEASE = /^(?:v)?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?)$/u;

function cleanLines(value: string): readonly string[] {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function candidates(value: string): readonly string[] {
  return cleanLines(value).flatMap((line) => {
    const named = NAMED_VERSION.exec(line);
    if (named !== null) return [named[1]!];
    const bare = BARE_RELEASE.exec(line);
    return bare === null ? [] : [bare[1]!];
  });
}

function selectVersion(values: readonly string[]): string | undefined {
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new OpenCodeVersionError(`ambiguous OpenCode version output: ${unique.join(", ")}`);
  return unique[0];
}

export function parseOpenCodeVersionOutput(stdout: string, stderr = ""): string {
  const parsed = selectVersion(candidates(stdout)) ?? selectVersion(candidates(stderr));
  if (parsed !== undefined) return parsed;
  throw new OpenCodeVersionError("could not parse OpenCode version output");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new OpenCodeVersionError(`${name} must be a positive integer`);
  return value;
}

export function runOpenCodeVersion(
  executable: string,
  options: OpenCodeVersionOptions = {},
): Promise<OpenCodeVersionResult> {
  const maxOutputBytes = positiveInteger(options.maxOutputBytes ?? 1024 * 1024, "maxOutputBytes");
  const timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeoutMs");
  const terminateGraceMs = positiveInteger(options.terminateGraceMs ?? 250, "terminateGraceMs");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let failure: string | undefined;
    let closed = false;
    let escalation: NodeJS.Timeout | undefined;

    const terminate = (message: string) => {
      if (failure !== undefined) return;
      failure = message;
      child.kill("SIGTERM");
      escalation = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, terminateGraceMs);
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (failure !== undefined) return;
      const remaining = maxOutputBytes - outputBytes;
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        terminate(`${executable} --version output exceeded ${maxOutputBytes} bytes`);
      }
    };

    const timeout = setTimeout(() => {
      terminate(`${executable} --version timed out after ${timeoutMs} ms`);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (cause) => {
      clearTimeout(timeout);
      if (escalation !== undefined) clearTimeout(escalation);
      reject(new OpenCodeVersionError(`failed to run ${executable} --version: ${cause.message}`));
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (escalation !== undefined) clearTimeout(escalation);
      if (failure !== undefined) {
        reject(new OpenCodeVersionError(failure));
        return;
      }
      if (code !== 0) {
        reject(new OpenCodeVersionError(
          `${executable} --version failed${signal === null ? ` with exit code ${code}` : ` from signal ${signal}`}`,
        ));
        return;
      }
      try {
        const output = Buffer.concat(stdout).toString("utf8");
        const diagnostics = Buffer.concat(stderr).toString("utf8");
        resolve({ version: parseOpenCodeVersionOutput(output, diagnostics), diagnostics });
      } catch (cause) {
        reject(cause);
      }
    });
  });
}
