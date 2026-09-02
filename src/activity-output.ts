import type { MessageActivityObservation } from "@opencoattails/query-kysely";

export interface ActivityOutputRecord {
  readonly source_id: string;
  readonly session_id: string;
  readonly message_id: string;
  readonly message_type: string;
  readonly message_seq: number;
  readonly time_created: string;
  readonly time_updated: string;
  readonly session_title: string | null;
  readonly session_directory: string;
}

export function activityOutputRecord(activity: MessageActivityObservation): ActivityOutputRecord {
  return {
    source_id: activity.target.source.sourceID,
    session_id: activity.target.address.session.sessionID,
    message_id: activity.target.address.messageID,
    message_type: activity.value.messageType,
    message_seq: activity.value.messageSeq,
    time_created: new Date(activity.value.createdAt).toISOString(),
    time_updated: new Date(activity.value.updatedAt).toISOString(),
    session_title: activity.value.session.title,
    session_directory: activity.value.session.directory,
  };
}

function oneLine(value: string | null): string {
  return (value ?? "(untitled)").replace(/\s+/gu, " ").trim();
}

/** One tab-delimited physical line suitable for append-only terminal output. */
export function humanActivityLine(record: ActivityOutputRecord): string {
  return [
    record.time_created,
    record.message_type,
    record.source_id,
    record.session_id,
    record.message_id,
    record.message_seq,
    oneLine(record.session_title),
    oneLine(record.session_directory),
  ].join("\t") + "\n";
}
