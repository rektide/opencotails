#!/usr/bin/env node

if (process.versions.node.startsWith("22.")) {
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    const sqliteExperimental = warning.name === "ExperimentalWarning"
      && warning.message === "SQLite is an experimental feature and might change at any time";
    if (!sqliteExperimental) process.stderr.write(`${warning.stack ?? warning.message}\n`);
  });
}

function printHelp(): void {
  process.stdout.write(`Usage: cotail <command> [options]

Commands:
  search <pattern> [pattern...]   Search opencode sessions for matching content
  history                         List sessions active within a time window
  get-session [pid]               Resolve the active session id for an opencode PID

Run "cotail <command> --help" for command-specific options.
`);
}

export async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "search":
      return await (await import("./commands/search.ts")).run(rest);
    case "history":
      return await (await import("./commands/history.ts")).run(rest);
    case "get-session":
      return await (await import("./commands/get-session.ts")).run(rest);
    case "-h":
    case "--help":
    case "help":
      printHelp();
      process.exit(0);
    case undefined:
      printHelp();
      process.exit(1);
    default:
      console.error(`unknown subcommand: ${sub}`);
      printHelp();
      process.exit(2);
  }
}

await main();
