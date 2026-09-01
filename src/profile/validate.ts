import { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  deriveIndexCapabilities,
  extractObservedMessageVariants,
  extractOpenCodeProfileSchema,
  type SourceProfile,
} from "@opencoattails/query-kysely";
import { runOpenCodeVersion } from "../opencode/version.ts";

export const PROFILE_VALIDATION_CHECKS = ["version", "schema", "indexes", "content", "plans"] as const;
export type ProfileValidationCheck = typeof PROFILE_VALIDATION_CHECKS[number];

export function isProfileValidationCheck(value: string): value is ProfileValidationCheck {
  return PROFILE_VALIDATION_CHECKS.some((check) => check === value);
}

export interface ValidateSourceProfileRequest {
  readonly profile: SourceProfile;
  readonly checks: ReadonlySet<ProfileValidationCheck>;
  readonly executable?: string;
  readonly databasePath?: string;
}

export interface ProfileValidationResult {
  readonly lines: readonly string[];
  readonly diagnostics: string;
  readonly valid: boolean;
}

const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const schemaFacts = (profile: SourceProfile["schema"]) => Object.fromEntries(
  Object.entries(profile.tables).map(([name, table]) => [name, { columns: table.columns }]),
);
const indexFacts = (profile: SourceProfile["schema"]) => Object.fromEntries(
  Object.entries(profile.tables).map(([name, table]) => [name, { indexes: table.indexes }]),
);

export async function validateSourceProfile(
  request: ValidateSourceProfileRequest,
): Promise<ProfileValidationResult> {
  const lines: string[] = [];
  let diagnostics = "";
  let valid = true;
  if (request.checks.has("version")) {
    const installed = await runOpenCodeVersion(request.executable ?? request.profile.opencode.executable);
    diagnostics += installed.diagnostics;
    const compatible = request.profile.opencode.compatible_versions.includes(installed.version);
    lines.push(`version: ${compatible ? "compatible" : "incompatible"} (${installed.version})`);
    valid &&= compatible;
  }

  const needsSchema = request.checks.has("schema") || request.checks.has("indexes");
  const needsDatabase = needsSchema || request.checks.has("content");
  if (needsDatabase) {
    const database = new DatabaseSync(request.databasePath ?? request.profile.source.path, { readOnly: true });
    try {
      database.exec("PRAGMA query_only = ON");
      let extracted: ReturnType<typeof extractOpenCodeProfileSchema> | undefined;
      if (needsSchema) {
        extracted = extractOpenCodeProfileSchema(database, {
          columns: request.checks.has("schema"),
          indexes: request.checks.has("indexes"),
        });
      }
      if (request.checks.has("schema")) {
        const matched = extracted !== undefined && same(schemaFacts(extracted), schemaFacts(request.profile.schema));
        lines.push(`schema: ${matched ? "match" : "mismatch"}`);
        valid &&= matched;
      }
      if (request.checks.has("indexes")) {
        const matched = same(indexFacts(extracted!), indexFacts(request.profile.schema))
          && same(deriveIndexCapabilities(extracted!), request.profile.capabilities);
        lines.push(`indexes: ${matched ? "match" : "mismatch"}`);
        valid &&= matched;
      }
      if (request.checks.has("content")) {
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

  if (request.checks.has("plans")) {
    const certificates = Object.keys(request.profile.certificates ?? {});
    if (certificates.length === 0) lines.push("plans: no certificates recorded");
    else {
      lines.push(`plans: unsupported for recorded certificates (${certificates.join(", ")})`);
      valid = false;
    }
  }
  return { lines, diagnostics, valid };
}
