import { resolve } from "node:path";
import { readSourceProfile, validateSourceProfile, type ProfileValidationSelection } from "../../profile/index.ts";
import { optionValue, ProfileUsageError } from "./options.ts";

export function printValidateHelp(): void {
  process.stdout.write(`Usage: cotail profile validate --profile <path> [checks]

Explicitly compare selected profile facts with an executable or database. No files are rewritten.

Checks:
  --version   Run the configured executable and compare the exact version allowlist
  --schema    Re-extract and compare canonical SQLite schema facts
  --indexes   Re-extract indexes and re-derive capabilities
  --content   Scan and compare distinct Message variants
  --plans     Validate recorded certificates (reports none when absent)
  --all       Run all checks (also the default when no check is selected)

Overrides:
  --opencode <path>  Executable used by --version
  --db <path>        Database used by schema, index, and content checks
`);
}

export async function runValidate(argv: readonly string[]): Promise<void> {
  let profilePath: string | undefined;
  let executable: string | undefined;
  let databasePath: string | undefined;
  const selected = new Set<keyof ProfileValidationSelection>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      printValidateHelp();
      return;
    }
    if (["--profile", "--opencode", "--db"].includes(argument)) {
      const value = optionValue(argv, index, argument);
      index++;
      if (argument === "--profile") profilePath = value;
      else if (argument === "--opencode") executable = value;
      else databasePath = value;
      continue;
    }
    if (argument === "--all") {
      for (const check of ["version", "schema", "indexes", "content", "plans"] as const) selected.add(check);
      continue;
    }
    const check = argument.replace(/^--/u, "") as keyof ProfileValidationSelection;
    if (["version", "schema", "indexes", "content", "plans"].includes(check)) {
      selected.add(check);
      continue;
    }
    throw new ProfileUsageError(`unknown option: ${argument}`);
  }
  if (profilePath === undefined) throw new ProfileUsageError("--profile is required");
  if (selected.size === 0) {
    for (const check of ["version", "schema", "indexes", "content", "plans"] as const) selected.add(check);
  }
  const profile = await readSourceProfile(resolve(profilePath));
  const selection = Object.fromEntries(
    ["version", "schema", "indexes", "content", "plans"].map((check) => [check, selected.has(check as keyof ProfileValidationSelection)]),
  ) as unknown as ProfileValidationSelection;
  const result = await validateSourceProfile({
    profile,
    selection,
    ...(executable === undefined ? {} : { executable }),
    ...(databasePath === undefined ? {} : { databasePath: resolve(databasePath) }),
  });
  if (result.diagnostics.length > 0) process.stderr.write(result.diagnostics);
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  if (!result.valid) {
    process.stderr.write("profile validation failed\n");
    process.exitCode = 1;
  }
}
