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

export interface SessionCounts {
  id: string;
  title: string;
  directory: string;
  slug: string;
  time_created: number;
  time_updated: number;
  messages_total: number;
  messages_recent: number;
}
