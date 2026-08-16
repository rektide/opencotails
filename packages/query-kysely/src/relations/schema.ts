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

export interface CotailRelations {
  readonly cotail_session: SessionRelation;
  readonly cotail_message: MessageRelation;
}
