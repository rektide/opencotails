import { runGenerate, printGenerateHelp } from "./generate.ts";
import { ProfileUsageError } from "./options.ts";
import { runRefresh } from "./refresh.ts";
import { runShow } from "./show.ts";
import { runValidate } from "./validate.ts";

export function printHelp(): void {
  process.stdout.write(`Usage: cotail profile <command> [options]

Explicit OpenCode source profile lifecycle commands:
  generate   Inspect an executable and database, then atomically create a profile
  show       Read and print profile JSON only
  validate   Explicitly compare selected recorded facts
  refresh    Explicitly regenerate a profile in place

Run "cotail profile <command> --help" for command-specific options.
`);
}

export async function run(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  try {
    if (command === "generate") await runGenerate(rest);
    else if (command === "show") await runShow(rest);
    else if (command === "validate") await runValidate(rest);
    else if (command === "refresh") await runRefresh(rest);
    else if (command === "-h" || command === "--help" || command === "help") printHelp();
    else if (command === undefined) {
      printHelp();
      process.exitCode = 1;
    } else throw new ProfileUsageError(`unknown profile command: ${command}`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    process.stderr.write(`${error.message}\n`);
    if (error instanceof ProfileUsageError) {
      if (command === "generate") printGenerateHelp();
      else printHelp();
      process.exitCode = 2;
    } else process.exitCode = 1;
  }
}
