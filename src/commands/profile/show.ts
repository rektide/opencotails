import { canonicalJson } from "@opencoattails/query-kysely";
import { resolve } from "node:path";
import { readSourceProfile } from "../../profile/index.ts";
import { optionValue, ProfileUsageError } from "./options.ts";

export function printShowHelp(): void {
  process.stdout.write(`Usage: cotail profile show --profile <path>

Read, strictly decode, and print a profile JSON file. This command does not access OpenCode or SQLite.
`);
}

export async function runShow(argv: readonly string[]): Promise<void> {
  let path: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      printShowHelp();
      return;
    }
    if (argument === "--profile") {
      path = optionValue(argv, index, argument);
      index++;
      continue;
    }
    throw new ProfileUsageError(`unknown option: ${argument}`);
  }
  if (path === undefined) throw new ProfileUsageError("--profile is required");
  process.stdout.write(`${canonicalJson(await readSourceProfile(resolve(path)))}\n`);
}
