export const SOURCE_PROFILE_FORMAT = "cotail.source-profile/v1" as const;

export interface SqliteColumnFact {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly not_null: boolean;
  readonly default_value: string | null;
  readonly primary_key: number;
  readonly hidden: number;
}

export interface SqliteColumnIndexKeyFact {
  readonly sequence: number;
  readonly kind: "column";
  readonly column: string;
  readonly collation: string;
  readonly direction: "asc" | "desc";
}

export interface SqliteExpressionIndexKeyFact {
  readonly sequence: number;
  readonly kind: "expression";
  readonly expression: string;
  readonly collation: string;
  readonly direction: "asc" | "desc";
}

export interface SqliteRowIDIndexKeyFact {
  readonly sequence: number;
  readonly kind: "rowid";
  readonly collation: string;
  readonly direction: "asc" | "desc";
}

export type SqliteIndexKeyFact =
  | SqliteColumnIndexKeyFact
  | SqliteExpressionIndexKeyFact
  | SqliteRowIDIndexKeyFact;

export type SqliteIndexAuxiliaryFact =
  | { readonly sequence: number; readonly kind: "column"; readonly column: string }
  | { readonly sequence: number; readonly kind: "expression" }
  | { readonly sequence: number; readonly kind: "rowid" };

export interface SqliteIndexFact {
  readonly name: string;
  readonly unique: boolean;
  readonly partial: boolean;
  readonly origin: "c" | "u" | "pk";
  readonly predicate: string | null;
  readonly keys: readonly SqliteIndexKeyFact[];
  readonly auxiliary: readonly SqliteIndexAuxiliaryFact[];
}

export interface SqliteTableFact {
  readonly columns: readonly SqliteColumnFact[];
  readonly indexes: readonly SqliteIndexFact[];
}

export interface SqliteProfileSchema {
  readonly normalized_hash: string;
  readonly tables: Readonly<Record<string, SqliteTableFact>>;
}

export interface IndexRequirement {
  readonly table: string;
  readonly predicates: readonly {
    readonly column: string;
    readonly operator: "equality";
    readonly collation?: string;
  }[];
  readonly order?: readonly {
    readonly column: string;
    readonly direction: "asc" | "desc";
    readonly collation?: string;
  }[];
}

export type IndexCapability =
  | { readonly status: "unavailable" }
  | {
    readonly status: "indexed";
    readonly index: string;
    readonly equality_prefix: readonly string[];
  };

export interface SourceProfilePlanCertificate {
  readonly contract: number;
  readonly runtime: {
    readonly node: string;
    readonly sqlite: string;
  };
  readonly outer: string;
  readonly related: string;
  readonly access: "search";
  readonly keys: readonly string[];
}

export interface SourceProfile {
  readonly format: typeof SOURCE_PROFILE_FORMAT;
  readonly profile_id: string;
  readonly generated_at: string;
  readonly generator: {
    readonly name: "cotail";
    readonly version: string;
    readonly contracts: {
      readonly history: number;
      readonly direct_search: number;
    };
  };
  readonly opencode: {
    readonly executable: string;
    readonly generated_with: string;
    readonly compatible_versions: readonly string[];
  };
  readonly source: {
    readonly kind: "opencode-v2";
    readonly path: string;
  };
  readonly schema: SqliteProfileSchema;
  readonly content: {
    readonly supported_message_variants: readonly string[];
    readonly observed_message_variants: readonly string[];
  };
  readonly capabilities: Readonly<Record<string, IndexCapability>>;
  readonly certificates?: Readonly<Record<string, SourceProfilePlanCertificate>>;
}

export interface TrustedSourceProfileFacts {
  readonly capabilities: SourceProfile["capabilities"];
  readonly supportedMessageVariants: SourceProfile["content"]["supported_message_variants"];
}
