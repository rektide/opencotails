import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import {
  canonicalJson,
  createSourceProfile,
  CURRENT_MESSAGE_VARIANTS,
  extractObservedMessageVariants,
  extractOpenCodeProfileSchema,
  type SourceProfile,
} from "@opencoattails/query-kysely";

export async function deterministicSourceProfile(databasePath: string): Promise<SourceProfile> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return createSourceProfile({
      profileID: "fixture",
      generatedAt: "2026-09-01T00:00:00.000Z",
      generatorVersion: "0.1.0",
      executable: "/must-not-run/opencode",
      opencodeVersion: "fixture",
      sourcePath: databasePath,
      schema: extractOpenCodeProfileSchema(database),
      supportedMessageVariants: [...CURRENT_MESSAGE_VARIANTS],
      observedMessageVariants: extractObservedMessageVariants(database),
    });
  } finally {
    database.close();
  }
}

export async function writeCliSourceProfile(databasePath: string, profilePath: string): Promise<void> {
  await writeFile(profilePath, `${canonicalJson(await deterministicSourceProfile(databasePath))}\n`);
}

export async function writeMalformedSourceProfile(profilePath: string): Promise<void> {
  await writeFile(profilePath, "{\n");
}
