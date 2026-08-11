export interface SessionTable {
  id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
}

export interface MessageTable {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

export interface PartTable {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  data: string;
}

export interface SessionMessageTable {
  id: string;
  session_id: string;
  type: string;
  seq: number;
  time_created: number;
  data: string;
}

export interface OpencodeDatabase {
  session: SessionTable;
  message: MessageTable;
  part: PartTable;
  session_message: SessionMessageTable;
}
