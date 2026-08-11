#!/usr/bin/env node
import { run as search } from "./commands/search.ts";
import { run as history } from "./commands/history.ts";
import { run as getSession } from "./commands/get-session.ts";

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
      return await search(rest);
    case "history":
      return await history(rest);
    case "get-session":
      return await getSession(rest);
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
