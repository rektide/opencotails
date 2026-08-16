export interface SessionV2Table {
  readonly id: string;
  readonly project_id: string;
  readonly workspace_id: string | null;
  readonly parent_id: string | null;
  readonly fork_session_id: string | null;
  readonly fork_boundary: string | null;
  readonly slug: string;
  readonly directory: string;
  readonly path: string | null;
  readonly title: string | null;
  readonly version: string;
  readonly share_url: string | null;
  readonly summary_additions: number | null;
  readonly summary_deletions: number | null;
  readonly summary_files: number | null;
  readonly summary_diffs: string | null;
  readonly metadata: string | null;
  readonly cost: number;
  readonly tokens_input: number;
  readonly tokens_output: number;
  readonly tokens_reasoning: number;
  readonly tokens_cache_read: number;
  readonly tokens_cache_write: number;
  readonly revert: string | null;
  readonly permission: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly time_created: number;
  readonly time_updated: number;
  readonly time_compacting: number | null;
  readonly time_archived: number | null;
  readonly time_suspended: number | null;
}

export interface SessionMessageTable {
  readonly id: string;
  readonly session_id: string;
  readonly type: string;
  readonly seq: number;
  readonly time_created: number;
  readonly time_updated: number;
  readonly data: string;
}

export interface KvTable {
  readonly key: string;
  readonly value: string;
  readonly time_created: number;
  readonly time_updated: number;
}

export interface EventSequenceTable {
  readonly aggregate_id: string;
  readonly seq: number;
  readonly owner_id: string | null;
}

export interface EventTable {
  readonly id: string;
  readonly aggregate_id: string;
  readonly seq: number;
  readonly created: number;
  readonly type: string;
  readonly data: string;
}

export interface SessionPendingTable {
  readonly id: string;
  readonly session_id: string;
  readonly type: string;
  readonly data: string;
  readonly delivery: string | null;
  readonly admitted_seq: number;
  readonly time_created: number;
}

export interface PhysicalOpenCodeV2 {
  readonly session_v2: SessionV2Table;
  readonly session_message: SessionMessageTable;
  readonly kv: KvTable;
  readonly session_pending: SessionPendingTable;
  readonly event_sequence: EventSequenceTable;
  readonly event: EventTable;
}
