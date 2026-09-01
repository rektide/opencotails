import { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  deriveIndexCapabilities,
  extractObservedMessageVariants,
  extractSqliteProfileSchema,
  type SourceProfile,
} from "@opencoattails/query-kysely";
import { runOpenCodeVersion } from "../opencode/version.ts";

export interface ProfileValidationSelection {
  readonly version: boolean;
  readonly schema: boolean;
  readonly indexes: boolean;
  readonly content: boolean;
  readonly plans: boolean;
}

export interface ValidateSourceProfileRequest {
  readonly profile: SourceProfile;
  readonly selection: ProfileValidationSelection;
  readonly executable?: string;
  readonly databasePath?: string;
}

export interface ProfileValidationResult {
  readonly lines: readonly string[];
  readonly diagnostics: string;
  readonly valid: boolean;
}

const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

export async function validateSourceProfile(
  request: ValidateSourceProfileRequest,
): Promise<ProfileValidationResult> {
  const lines: string[] = [];
  let diagnostics = "";
  let valid = true;
  if (request.selection.version) {
    const installed = await runOpenCodeVersion(request.executable ?? request.profile.opencode.executable);
    diagnostics += installed.diagnostics;
    const compatible = request.profile.opencode.compatible_versions.includes(installed.version);
    lines.push(`version: ${compatible ? "compatible" : "incompatible"} (${installed.version})`);
    valid &&= compatible;
  }

  const needsSchema = request.selection.schema || request.selection.indexes;
  const needsDatabase = needsSchema || request.selection.content;
  if (needsDatabase) {
    const database = new DatabaseSync(request.databasePath ?? request.profile.source.path, { readOnly: true });
    try {
      database.exec("PRAGMA query_only = ON");
      let extracted: ReturnType<typeof extractSqliteProfileSchema> | undefined;
      if (needsSchema) {
        extracted = extractSqliteProfileSchema(database, Object.keys(request.profile.schema.tables));
      }
      if (request.selection.schema) {
        const matched = extracted !== undefined && same(extracted, request.profile.schema);
        lines.push(`schema: ${matched ? "match" : "mismatch"}`);
        valid &&= matched;
      }
      if (request.selection.indexes) {
        const actualIndexes = Object.fromEntries(Object.entries(extracted!.tables).map(([name, table]) =>
          [name, table.indexes]));
        const expectedIndexes = Object.fromEntries(Object.entries(request.profile.schema.tables).map(([name, table]) =>
          [name, table.indexes]));
        const matched = same(actualIndexes, expectedIndexes)
          && same(deriveIndexCapabilities(extracted!), request.profile.capabilities);
        lines.push(`indexes: ${matched ? "match" : "mismatch"}`);
        valid &&= matched;
      }
      if (request.selection.content) {
        const observed = extractObservedMessageVariants(database);
        const supported = new Set(request.profile.content.supported_message_variants);
        const matched = same(observed, request.profile.content.observed_message_variants)
          && observed.every((variant) => supported.has(variant));
        lines.push(`content: ${matched ? "match" : "mismatch"}`);
        valid &&= matched;
      }
    } finally {
      database.close();
    }
  }

  if (request.selection.plans) {
    const certificates = Object.keys(request.profile.certificates ?? {});
    if (certificates.length === 0) lines.push("plans: no certificates recorded");
    else {
      lines.push(`plans: not validated (${certificates.join(", ")})`);
      valid = false;
    }
  }
  return { lines, diagnostics, valid };
}
