import { deriveIndexCapabilities } from "./capabilities.ts";
import type { SourceProfile, SqliteProfileSchema } from "./types.ts";
import { SOURCE_PROFILE_FORMAT } from "./types.ts";

export class UnsupportedObservedMessageVariantsError extends Error {
  public readonly variants: readonly string[];

  public constructor(variants: readonly string[]) {
    super(`observed but unsupported Message variants: ${variants.join(", ")}`);
    this.name = "UnsupportedObservedMessageVariantsError";
    this.variants = variants;
  }
}

export interface CreateSourceProfileInput {
  readonly profileID: string;
  readonly generatedAt: string;
  readonly generatorVersion: string;
  readonly executable: string;
  readonly opencodeVersion: string;
  readonly compatibleVersions?: readonly string[];
  readonly sourcePath: string;
  readonly schema: SqliteProfileSchema;
  readonly supportedMessageVariants: readonly string[];
  readonly observedMessageVariants: readonly string[];
}

const sortedUnique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

export function createSourceProfile(input: CreateSourceProfileInput): SourceProfile {
  const supported = sortedUnique(input.supportedMessageVariants);
  const observed = sortedUnique(input.observedMessageVariants);
  const supportedSet = new Set(supported);
  const unsupported = observed.filter((variant) => !supportedSet.has(variant));
  if (unsupported.length > 0) throw new UnsupportedObservedMessageVariantsError(unsupported);
  return {
    format: SOURCE_PROFILE_FORMAT,
    profile_id: input.profileID,
    generated_at: input.generatedAt,
    generator: {
      name: "cotail",
      version: input.generatorVersion,
      contracts: { history: 1, direct_search: 1 },
    },
    opencode: {
      executable: input.executable,
      generated_with: input.opencodeVersion,
      compatible_versions: sortedUnique(input.compatibleVersions ?? [input.opencodeVersion]),
    },
    source: { kind: "opencode-v2", path: input.sourcePath },
    schema: input.schema,
    content: {
      supported_message_variants: supported,
      observed_message_variants: observed,
    },
    capabilities: deriveIndexCapabilities(input.schema),
  };
}
