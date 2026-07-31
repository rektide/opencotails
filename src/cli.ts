#!/usr/bin/env node
import { run as search } from "./commands/search.ts";
import { run as history } from "./commands/history.ts";

function printHelp(): void {
  process.stdout.write(`Usage: cotails <command> [options]

Commands:
  search <pattern> [pattern...]   Search opencode sessions for matching content
  history                         List sessions active within a time window

Run "cotails <command> --help" for command-specific options.
`);
}

export function main(): void {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "search":
      return search(rest);
    case "history":
      return history(rest);
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

main();
