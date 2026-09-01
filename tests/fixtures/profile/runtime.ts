import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { createCliDatabase } from "./database.ts";
import { writeVersionExecutable } from "./executable.ts";
import { writeMalformedSourceProfile } from "./source-profile.ts";

export interface ProfileCliFixture {
  readonly directory: string;
  readonly database: string;
  readonly executable: string;
  readonly invocations: string;
  readonly profile: string;
  readonly missingProfile: string;
  readonly malformedProfile: string;
  readonly staleDatabase: string;
  readonly readInvocations: () => Promise<string>;
  readonly resetInvocations: () => Promise<void>;
  readonly writeMalformedProfile: () => Promise<void>;
  readonly writeStaleDatabase: () => Promise<void>;
}

export async function createProfileCliFixture(t: TestContext): Promise<ProfileCliFixture> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-profile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "opencode.db");
  const executable = join(directory, "opencode-fixture");
  const invocations = join(directory, "invocations.log");
  const profile = join(directory, "profile.json");
  const malformedProfile = join(directory, "malformed.json");
  const staleDatabase = join(directory, "stale.db");
  await createCliDatabase(database);
  await writeVersionExecutable({ path: executable, version: "0.0.0-local-fixture" });
  await writeFile(invocations, "");
  return {
    directory,
    database,
    executable,
    invocations,
    profile,
    missingProfile: join(directory, "missing.json"),
    malformedProfile,
    staleDatabase,
    readInvocations: () => readFile(invocations, "utf8"),
    resetInvocations: () => writeFile(invocations, ""),
    writeMalformedProfile: () => writeMalformedSourceProfile(malformedProfile),
    writeStaleDatabase: async () => {
      const stale = new DatabaseSync(staleDatabase);
      try {
        stale.exec("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
      } finally {
        stale.close();
      }
    },
  };
}
