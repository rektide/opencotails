import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { generateSourceProfile, writeSourceProfile } from "../../profile/index.ts";
import { optionValue, ProfileUsageError } from "./options.ts";

interface GenerateArgs {
  readonly databasePath: string;
  readonly executable: string;
  readonly outputPath: string;
  readonly profileID: string;
}

export function printGenerateHelp(): void {
  process.stdout.write(`Usage: cotail profile generate --db <path> [options]

Explicitly inspect an OpenCode database and executable, then write a source profile.

Options:
  --db <path>          OpenCode SQLite database (required)
  --opencode <path>    OpenCode executable (default: opencode)
  --output <path>      Profile output path (default: XDG config profiles directory)
  --name <id>          Profile id (default: database filename)
`);
}

function parseArgs(argv: readonly string[]): GenerateArgs | undefined {
  let databasePath: string | undefined;
  let executable = "opencode";
  let outputPath: string | undefined;
  let profileID: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      printGenerateHelp();
      return undefined;
    }
    if (["--db", "--opencode", "--output", "--name"].includes(argument)) {
      const value = optionValue(argv, index, argument);
      index++;
      if (argument === "--db") databasePath = value;
      else if (argument === "--opencode") executable = value;
      else if (argument === "--output") outputPath = value;
      else profileID = value;
      continue;
    }
    throw new ProfileUsageError(`unknown option: ${argument}`);
  }
  if (databasePath === undefined) throw new ProfileUsageError("--db is required");
  profileID ??= basename(databasePath).replace(/\.db$/u, "") || "opencode-local";
  if (!/^[A-Za-z0-9._-]+$/u.test(profileID)) throw new ProfileUsageError("--name contains unsupported characters");
  outputPath ??= join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cotail", "profiles", `${profileID}.json`);
  return { databasePath, executable, outputPath: resolve(outputPath), profileID };
}

export async function runGenerate(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args === undefined) return;
  const generated = await generateSourceProfile({
    profileID: args.profileID,
    databasePath: args.databasePath,
    executable: args.executable,
  });
  if (generated.diagnostics.length > 0) process.stderr.write(generated.diagnostics);
  await writeSourceProfile(args.outputPath, generated.profile);
  process.stdout.write(`generated profile ${generated.profile.profile_id} at ${args.outputPath}\n`);
}
