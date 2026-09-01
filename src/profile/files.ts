import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  canonicalJson,
  decodeSourceProfile,
  parseSourceProfile,
  type SourceProfile,
} from "@opencoattails/query-kysely";

export async function readSourceProfile(path: string): Promise<SourceProfile> {
  return parseSourceProfile(await readFile(path, "utf8"));
}

export async function writeSourceProfile(path: string, profile: SourceProfile): Promise<void> {
  const decoded = decodeSourceProfile(profile);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${canonicalJson(decoded)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}
