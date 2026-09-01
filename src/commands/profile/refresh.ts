import { resolve } from "node:path";
import { generateSourceProfile, readSourceProfile, writeSourceProfile } from "../../profile/index.ts";
import { optionValue, ProfileUsageError } from "./options.ts";

export function printRefreshHelp(): void {
  process.stdout.write(`Usage: cotail profile refresh --profile <path> [options]

Explicitly regenerate an existing profile in place while preserving its id and source path.

Options:
  --opencode <path>  Override the recorded executable
`);
}

export async function runRefresh(argv: readonly string[]): Promise<void> {
  let profilePath: string | undefined;
  let executable: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      printRefreshHelp();
      return;
    }
    if (argument === "--profile" || argument === "--opencode") {
      const value = optionValue(argv, index, argument);
      index++;
      if (argument === "--profile") profilePath = value;
      else executable = value;
      continue;
    }
    throw new ProfileUsageError(`unknown option: ${argument}`);
  }
  if (profilePath === undefined) throw new ProfileUsageError("--profile is required");
  const path = resolve(profilePath);
  const previous = await readSourceProfile(path);
  const generated = await generateSourceProfile({
    profileID: previous.profile_id,
    databasePath: previous.source.path,
    executable: executable ?? previous.opencode.executable,
  });
  if (generated.diagnostics.length > 0) process.stderr.write(generated.diagnostics);
  await writeSourceProfile(path, generated.profile);
  process.stdout.write(`refreshed profile ${generated.profile.profile_id} at ${path}\n`);
}
