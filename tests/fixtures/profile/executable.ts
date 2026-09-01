import { chmod, writeFile } from "node:fs/promises";

export interface VersionExecutableOptions {
  readonly path: string;
  readonly version: string;
  readonly namedOutput?: boolean;
}

export async function writeVersionExecutable(options: VersionExecutableOptions): Promise<void> {
  const namedOutput = options.namedOutput ?? true;
  await writeFile(options.path, `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
await appendFile(process.env.PROFILE_INVOCATION_LOG, process.argv.slice(2).join(" ") + "\\n");
process.stderr.write("diagnostic: ${namedOutput ? "local development build" : "opencode version cache stale"}\\n");
process.stdout.write("${namedOutput ? "opencode2 " : ""}v${options.version}\\n");
`);
  await chmod(options.path, 0o755);
}
