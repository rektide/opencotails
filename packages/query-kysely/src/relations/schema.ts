import type { DocumentField } from "../domain/address.ts";

export interface SessionRelation {
  readonly sessionID: string;
  readonly projectID: string;
  readonly workspaceID: string | null;
  readonly parentID: string | null;
  readonly forkSessionID: string | null;
  readonly forkBoundary: string | null;
  readonly slug: string;
  readonly directory: string;
  readonly path: string | null;
  readonly title: string | null;
  readonly version: string;
  readonly shareURL: string | null;
  readonly summaryAdditions: number | null;
  readonly summaryDeletions: number | null;
  readonly summaryFiles: number | null;
  readonly summaryDiffsJSON: string | null;
  readonly metadataJSON: string | null;
  readonly cost: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensReasoning: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  readonly revertJSON: string | null;
  readonly permissionJSON: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly compactingAt: number | null;
  readonly archivedAt: number | null;
  readonly suspendedAt: number | null;
}

export interface MessageRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageType: string;
  readonly messageSeq: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceJSON: string;
}

/** Message columns available without selecting the physical payload. */
export type MessageMetadataRelation = Omit<MessageRelation, "sourceJSON">;

export interface UserMessageRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly text: string;
  readonly filesJSON: string | null;
  readonly agentsJSON: string | null;
  readonly skillsJSON: string | null;
  readonly metadataJSON: string | null;
}

export interface AssistantMessageRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly agent: string;
  readonly modelID: string;
  readonly providerID: string;
  readonly modelVariant: string | null;
  readonly finish: string | null;
  readonly cost: number | null;
  readonly tokensInput: number | null;
  readonly tokensOutput: number | null;
  readonly tokensReasoning: number | null;
  readonly tokensCacheRead: number | null;
  readonly tokensCacheWrite: number | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null;
  readonly retryAttempt: number | null;
  readonly retryAt: number | null;
  readonly retryErrorJSON: string | null;
  readonly snapshotStart: string | null;
  readonly snapshotEnd: string | null;
  readonly snapshotFilesJSON: string | null;
  readonly metadataJSON: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

export interface ContentRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly contentIndex: number;
  readonly contentKind: "user" | "synthetic" | "system" | "skill" | "text" | "reasoning";
  readonly text: string;
  readonly description: string | null;
  readonly skillID: string | null;
  readonly skillName: string | null;
  readonly providerStateJSON: string | null;
  readonly createdAt: number | null;
  readonly completedAt: number | null;
}

export interface ToolCallRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly contentIndex: number;
  readonly callID: string;
  readonly toolName: string;
  readonly state: "streaming" | "running" | "completed" | "error";
  readonly inputJSON: string;
  readonly executed: number | null;
  readonly metadataJSON: string | null;
  readonly providerStateJSON: string | null;
  readonly providerResultStateJSON: string | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null;
  readonly createdAt: number;
  readonly ranAt: number | null;
  readonly completedAt: number | null;
}

export interface ToolResultRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly contentIndex: number;
  readonly callID: string;
  readonly resultIndex: number;
  readonly resultKind: "text" | "file";
  readonly text: string | null;
  readonly uri: string | null;
  readonly mime: string | null;
  readonly name: string | null;
}

export interface ShellExecutionRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly shellID: string;
  readonly command: string;
  readonly status: "running" | "exited" | "timeout" | "killed";
  readonly exit: number | null;
  readonly output: string | null;
  readonly outputCursor: number | null;
  readonly outputSize: number | null;
  readonly outputTruncated: number | null;
  readonly metadataJSON: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

export interface AttachmentRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly attachmentIndex: number;
  readonly sourceIndex: number;
  readonly attachmentType: "file" | "agent" | "skill";
  readonly mime: string | null;
  readonly sourceType: "inline" | "uri" | null;
  readonly uri: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly skillID: string | null;
  readonly text: string | null;
  readonly mentionStart: number | null;
  readonly mentionEnd: number | null;
  readonly mentionText: string | null;
}

export interface CompactionRelation {
  readonly sessionID: string;
  readonly messageID: string;
  readonly messageSeq: number;
  readonly status: "running" | "completed" | "failed";
  readonly reason: "auto" | "manual";
  readonly summary: string | null;
  readonly recent: string | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null;
  readonly metadataJSON: string | null;
}

export type DocumentExposure =
  | "ordinary"
  | "system"
  | "reasoning"
  | "tool"
  | "shell"
  | "sensitive-metadata";

export interface DocumentRelation {
  readonly documentKey: string;
  readonly ownerKind: "session" | "message" | "content" | "tool-call" | "tool-result" | "shell" | "attachment";
  readonly sessionID: string | null;
  readonly projectID: string | null;
  readonly workspaceID: string | null;
  readonly messageID: string | null;
  readonly contentIndex: number | null;
  readonly nestedIndex: number | null;
  readonly nativeID: string | null;
  readonly field: DocumentField;
  readonly text: string;
  readonly messageSeq: number | null;
  readonly messageUpdatedAt: number | null;
  readonly fieldOrder: number;
  readonly exposure: DocumentExposure;
}

export interface CotailRelations {
  readonly cotail_session: SessionRelation;
  readonly cotail_message: MessageRelation;
  readonly cotail_user_message: UserMessageRelation;
  readonly cotail_assistant_message: AssistantMessageRelation;
  readonly cotail_content: ContentRelation;
  readonly cotail_tool_call: ToolCallRelation;
  readonly cotail_tool_result: ToolResultRelation;
  readonly cotail_shell_execution: ShellExecutionRelation;
  readonly cotail_attachment: AttachmentRelation;
  readonly cotail_compaction: CompactionRelation;
  readonly cotail_document: DocumentRelation;
}

/** Logical relations available to operations that only inspect Session roots. */
export interface CotailSessionRelations {
  readonly cotail_session: SessionRelation;
}

/** Session roots plus raw Message metadata, without payload-derived relations. */
export interface CotailSessionMessageRelations extends CotailSessionRelations {
  readonly cotail_message: MessageMetadataRelation;
}
