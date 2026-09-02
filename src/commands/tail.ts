import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  readRecentMessageActivity,
} from "@opencoattails/query-kysely";
import { parseSince } from "../args.ts";
import { activityOutputRecord, humanActivityLine } from "../activity-output.ts";
import { resolveRuntimeSource } from "../profile/runtime.ts";

export type ActivityOutputFormat = "human" | "jsonl";

export interface TailArgs {
  readonly since: string;
  readonly limit: number;
  readonly format: ActivityOutputFormat;
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

export function parseArgs(argv: string[]): TailArgs {
  let since = "24h";
  let limit = 50;
  let format: ActivityOutputFormat = "human";
  let dbPath: string | undefined;
  let profilePath: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--since" || argument.startsWith("--since=")) {
      const parsed = optionValue(argv, index, "--since");
      since = parsed.value;
      index = parsed.index;
      continue;
    }
    if (argument === "--limit" || argument.startsWith("--limit=")) {
      const parsed = optionValue(argv, index, "--limit");
      const value = Number(parsed.value);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("--limit requires a positive integer");
      }
      limit = value;
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
    if (argument === "--json") {
      format = "jsonl";
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown option: ${argument}`);
  }
  return { since, limit, format, dbPath, profilePath };
}

export function printHelp(): void {
  process.stdout.write(`Usage: cotail tail [options]

List finite recent Message activity without reading Message payloads.

Options:
  --since <dur-or-ISO>  Message-created cutoff (default: 24h)
  --limit <n>           Maximum Messages returned (default: 50)
  --format <format>     Output format: human or jsonl (default: human)
  --json                Alias for --format jsonl
  --profile <path>      Trusted source profile (default: XDG opencode-local profile)
  --db <path>           Database locator override (default: path recorded in profile)

Ordering is time_created descending, then message_id descending.
Human output is tab-delimited with no header or footer.

Examples:
  cotail tail --since 30m --limit 20
  cotail tail --since 2026-09-01T12:00:00Z --format jsonl
`);
}

export async function run(argv: string[]): Promise<void> {
  let args: TailArgs;
  let cutoff: number;
  try {
    args = parseArgs(argv);
    cutoff = parseSince(args.since);
  } catch (cause) {
    console.error((cause as Error).message);
    printHelp();
    process.exit(2);
  }

  try {
    const source = await resolveRuntimeSource({ databasePath: args.dbPath, profilePath: args.profilePath });
    const activity = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource(source).pipe(Effect.flatMap(({ query }) =>
        readRecentMessageActivity(query, {
          messageCreatedRange: { from: cutoff },
          limit: args.limit,
        }))),
    ));
    for (const entry of activity) {
      const record = activityOutputRecord(entry);
      process.stdout.write(args.format === "jsonl" ? `${JSON.stringify(record)}\n` : humanActivityLine(record));
    }
  } catch (cause) {
    console.error((cause as Error).message);
    process.exit(1);
  }
}
