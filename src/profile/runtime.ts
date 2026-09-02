import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  SourceProfileDecodeError,
  type TrustedSourceProfileFacts,
} from "@opencoattails/query-kysely";
import { readSourceProfile } from "./files.ts";

export interface RuntimeSourceSelection {
  readonly path: string;
  readonly sourceID: string;
  readonly profile: TrustedSourceProfileFacts;
}

export interface ResolveRuntimeSourceRequest {
  readonly databasePath?: string;
  readonly profilePath?: string;
}

export function defaultSourceProfilePath(): string {
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(config, "cotail", "profiles", "opencode-local.json");
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function databaseHint(override: string | undefined): string {
  if (override !== undefined) return override;
  return process.env.OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
}

function generateCommand(profilePath: string, databasePath: string | undefined): string {
  return `cotail profile generate --db ${shellArgument(databaseHint(databasePath))} --opencode opencode --output ${shellArgument(profilePath)} --name opencode-local`;
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

export async function resolveRuntimeSource(
  request: ResolveRuntimeSourceRequest,
): Promise<RuntimeSourceSelection> {
  const profilePath = resolve(request.profilePath ?? defaultSourceProfilePath());
  let decoded;
  try {
    decoded = await readSourceProfile(profilePath);
  } catch (cause) {
    const command = generateCommand(profilePath, request.databasePath);
    if (errorCode(cause) === "ENOENT") {
      throw new Error(`source profile not found: ${profilePath}\nGenerate it with:\n${command}`);
    }
    if (cause instanceof SourceProfileDecodeError) {
      throw new Error(`source profile is malformed: ${profilePath}\n${cause.message}\nRegenerate it with:\n${command}`);
    }
    throw new Error(`failed to read source profile ${profilePath}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return Object.freeze({
    path: request.databasePath ?? decoded.source.path,
    sourceID: decoded.profile_id,
    profile: Object.freeze({
      capabilities: decoded.capabilities,
      supportedMessageVariants: decoded.content.supported_message_variants,
    }),
  });
}
