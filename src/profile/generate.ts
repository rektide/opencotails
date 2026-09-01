import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import {
  createSourceProfile,
  CURRENT_MESSAGE_VARIANTS,
  decodeSourceProfile,
  extractObservedMessageVariants,
  extractOpenCodeProfileSchema,
  type SourceProfile,
} from "@opencoattails/query-kysely";
import { runOpenCodeVersion } from "../opencode/version.ts";

export const COTAIL_VERSION = "0.1.0";

export interface GenerateSourceProfileRequest {
  readonly profileID: string;
  readonly databasePath: string;
  readonly executable: string;
  readonly generatedAt?: string;
}

export interface GeneratedSourceProfile {
  readonly profile: SourceProfile;
  readonly diagnostics: string;
}

function inspectDatabase(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    return {
      schema: extractOpenCodeProfileSchema(database),
      observedMessageVariants: extractObservedMessageVariants(database),
    };
  } finally {
    database.close();
  }
}

export async function generateSourceProfile(
  request: GenerateSourceProfileRequest,
): Promise<GeneratedSourceProfile> {
  const version = await runOpenCodeVersion(request.executable);
  const databasePath = resolve(request.databasePath);
  const extracted = inspectDatabase(databasePath);
  const profile = createSourceProfile({
    profileID: request.profileID,
    generatedAt: request.generatedAt ?? new Date().toISOString(),
    generatorVersion: COTAIL_VERSION,
    executable: request.executable,
    opencodeVersion: version.version,
    sourcePath: databasePath,
    schema: extracted.schema,
    supportedMessageVariants: [...CURRENT_MESSAGE_VARIANTS],
    observedMessageVariants: extracted.observedMessageVariants,
  });
  return { profile: decodeSourceProfile(profile), diagnostics: version.diagnostics };
}
