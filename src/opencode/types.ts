export type PartType = "text" | "reasoning" | "tool";

export interface ContentQuery {
  patterns: string[];
  typeFilter: PartType;
  showSnippet: boolean;
  limit: number;
}

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  directory: string;
  created: string;
  updated: string;
  snippet?: string;
}
