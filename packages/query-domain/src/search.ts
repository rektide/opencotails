import type { SessionSelector, SessionSummary } from "./session.ts";

export type ContentType = "text" | "reasoning" | "tool" | "shell";
export type ContentRole = "user" | "assistant" | "system";

export interface TextPattern {
  source: string;
  mode?: "regex" | "literal";
  caseSensitive?: boolean;
}

export interface PatternSet {
  all?: readonly TextPattern[];
  any?: readonly TextPattern[];
  none?: readonly TextPattern[];
}

export interface ContentRequirement {
  types: readonly ContentType[];
  roles?: readonly ContentRole[];
  text: PatternSet;
}

export interface ContentRequirements {
  all?: readonly ContentRequirement[];
  any?: readonly ContentRequirement[];
  none?: readonly ContentRequirement[];
}

export interface DirectSearchRequest {
  selector: SessionSelector;
  title?: PatternSet;
  requirements?: ContentRequirements;
  evidence: boolean;
  limit: number;
}

export interface SearchResult {
  session: SessionSummary;
  evidenceText?: string;
}

export interface DirectSearchHit extends SearchResult {
  backend: "direct";
  evidence?: {
    kind: "content-witness";
    requirement: { scope: "all" | "any"; index: number };
    contentId: string;
    layout: "v1-part" | "v2-session-message";
    ordinal: readonly [major: number, minor: number];
  };
}
