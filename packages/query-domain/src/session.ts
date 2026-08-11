export interface SessionSummary {
  id: string;
  title: string;
  directory: string;
  slug: string;
  projectId: string;
  parentId: string | null;
  version: string;
  timeCreated: number;
  timeUpdated: number;
}

export interface DirectorySelector {
  value: string;
  mode: "exact" | "contains";
}

export interface TimeRange {
  from?: number;
  to?: number;
}

export interface SessionSelector {
  ids?: readonly string[];
  projectIds?: readonly string[];
  directory?: DirectorySelector;
  updated?: TimeRange;
}

export interface ResolveRequest {
  selector: SessionSelector;
  mode: "latest" | "only";
}
