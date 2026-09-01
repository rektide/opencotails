import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import {
  canonicalJson,
  createSourceProfile,
  CURRENT_MESSAGE_VARIANTS,
  extractObservedMessageVariants,
  extractOpenCodeProfileSchema,
} from "@opencoattails/query-kysely";

export async function writeCliSourceProfile(databasePath: string, profilePath: string): Promise<void> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const profile = createSourceProfile({
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
    await writeFile(profilePath, `${canonicalJson(profile)}\n`);
  } finally {
    database.close();
  }
}
