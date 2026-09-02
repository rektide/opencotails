import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  readRecentMessageActivity,
} from "@opencoattails/query-kysely";
import {
  cutoffAt,
  parseDuration,
  parseSinceSpec,
  type SinceSpec,
} from "../args.ts";
import {
  humanWatchActivityLine,
  watchActivityOutputRecord,
  type ActivityOutputFormat,
} from "../activity-output.ts";
import { resolveRuntimeSource } from "../profile/runtime.ts";
import { waitForAbortableDelay, watchMessageActivity } from "../watch/activity.ts";

export interface WatchArgs {
  readonly since: SinceSpec;
  readonly limit: number;
  readonly intervalMs: number;
  readonly format: ActivityOutputFormat;
  readonly includeInitial: boolean;
  readonly once: boolean;
  readonly dbPath?: string;
  readonly profilePath?: string;
}

function optionValue(argv: string[], index: number, name: string): { readonly value: string; readonly index: number } {
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

export function parseArgs(argv: string[]): WatchArgs {
  let since = parseSinceSpec("24h");
  let limit = 50;
  let intervalMs = 2_000;
  let format: ActivityOutputFormat = "human";
  let includeInitial = true;
  let once = false;
  let dbPath: string | undefined;
  let profilePath: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--since" || argument.startsWith("--since=")) {
      const parsed = optionValue(argv, index, "--since");
      since = parseSinceSpec(parsed.value);
      index = parsed.index;
      continue;
    }
    if (argument === "--limit" || argument.startsWith("--limit=")) {
      const parsed = optionValue(argv, index, "--limit");
      const value = Number(parsed.value);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("--limit requires a positive integer");
      limit = value;
      index = parsed.index;
      continue;
    }
    if (argument === "--interval" || argument.startsWith("--interval=")) {
      const parsed = optionValue(argv, index, "--interval");
      intervalMs = parseDuration(parsed.value, "--interval");
      if (intervalMs < 1) throw new Error("--interval requires a positive duration");
      index = parsed.index;
      continue;
    }
    if (argument === "--format" || argument.startsWith("--format=")) {
      const parsed = optionValue(argv, index, "--format");
      if (parsed.value !== "human" && parsed.value !== "jsonl") {
        throw new Error("--format must be human or jsonl");
      }
      format = parsed.value;
      index = parsed.index;
      continue;
    }
    if (argument === "--db" || argument.startsWith("--db=")) {
      const parsed = optionValue(argv, index, "--db");
      dbPath = parsed.value;
      index = parsed.index;
      continue;
    }
    if (argument === "--profile" || argument.startsWith("--profile=")) {
      const parsed = optionValue(argv, index, "--profile");
      profilePath = parsed.value;
      index = parsed.index;
      continue;
    }
    if (argument === "--json") { format = "jsonl"; continue; }
    if (argument === "--no-initial") { includeInitial = false; continue; }
    if (argument === "--once") { once = true; continue; }
    if (argument === "-h" || argument === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown option: ${argument}`);
  }
  if (once && !includeInitial) throw new Error("--once cannot be combined with --no-initial");
  return { since, limit, intervalMs, format, includeInitial, once, dbPath, profilePath };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotail watch [options]

Observe newly visible Message metadata by polling the same bounded view as cotail tail.
Output reports observations, not exact causal events.

Options:
  --since <dur-or-ISO>  Moving duration or fixed Message-created cutoff (default: 24h)
  --limit <n>           Maximum Messages visible in each sample (default: 50)
  --interval <dur>      Delay between non-overlapping samples (default: 2s)
  --format <format>     Output format: human or jsonl (default: human)
  --json                Alias for --format jsonl
  --no-initial          Establish the first sample silently
  --once                Emit one bounded initial sample and exit
  --profile <path>      Trusted source profile (default: XDG opencode-local profile)
  --db <path>           Database locator override (default: path recorded in profile)

Each Message identity is emitted at most once while it remains in the selected window.
Rows within an observation batch are ordered by time_created then message_id ascending.

Examples:
  cotail watch --since 30m --format human
  cotail watch --no-initial --interval 1s --format jsonl
  cotail watch --once --since 7d --limit 100 --json
`);
}

export function isBrokenPipe(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause
    && (cause as { readonly code?: unknown }).code === "EPIPE";
}

function writeChunk(chunk: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted || process.stdout.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      process.stdout.off("drain", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    process.stdout.once("drain", finish);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function run(argv: string[]): Promise<void> {
  let args: WatchArgs;
  try {
    args = parseArgs(argv);
  } catch (cause) {
    console.error((cause as Error).message);
    printHelp();
    process.exit(2);
  }

  const controller = new AbortController();
  let outputFailure: Error | undefined;
  const stop = () => { controller.abort(); };
  const outputError = (cause: Error) => {
    if (!isBrokenPipe(cause)) outputFailure = cause;
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdout.on("error", outputError);

  try {
    const source = await resolveRuntimeSource({ databasePath: args.dbPath, profilePath: args.profilePath });
    await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource(source).pipe(Effect.flatMap(({ query }) => Effect.tryPromise({
        try: () => watchMessageActivity({
          source: {
            sample: (cutoff, limit) => Effect.runPromise(readRecentMessageActivity(query, {
              messageCreatedRange: { from: cutoff },
              limit,
            })),
          },
          cutoffAt: (now) => cutoffAt(args.since, now),
          limit: args.limit,
          includeInitial: args.includeInitial,
          once: args.once,
          signal: controller.signal,
          now: Date.now,
          wait: (signal) => waitForAbortableDelay(args.intervalMs, signal),
          emit: async (observation) => {
            const record = watchActivityOutputRecord(observation);
            await writeChunk(args.format === "jsonl"
              ? `${JSON.stringify(record)}\n`
              : humanWatchActivityLine(record), controller.signal);
          },
        }),
        catch: (cause) => cause,
      }))),
    ));
    if (outputFailure !== undefined) throw outputFailure;
  } catch (cause) {
    if (!controller.signal.aborted || outputFailure !== undefined) {
      console.error((cause as Error).message);
      process.exitCode = 1;
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.off("error", outputError);
  }
}
