import type { SessionAddress } from "./address.ts";
import type { Observation } from "./observation.ts";

export interface SessionReport {
  readonly title: string | null;
  readonly slug: string;
  readonly location: {
    readonly projectID: string;
    readonly workspaceID: string | null;
    readonly directory: string;
    readonly path: string | null;
  };
  readonly lineage: {
    readonly parentSessionID: string | null;
    readonly forkSessionID: string | null;
    readonly forkBoundary: string | null;
  };
  readonly run: {
    readonly version: string;
    readonly agent: string | null;
    readonly model: string | null;
  };
  readonly usage: {
    readonly cost: number;
    readonly tokens: {
      readonly input: number;
      readonly output: number;
      readonly reasoning: number;
      readonly cache: {
        readonly read: number;
        readonly write: number;
      };
    };
  };
  readonly summary: {
    readonly additions: number | null;
    readonly deletions: number | null;
    readonly files: number | null;
  };
  readonly shareURL: string | null;
  readonly lifecycle: {
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly compactingAt: number | null;
    readonly archivedAt: number | null;
    readonly suspendedAt: number | null;
  };
}

export type SessionReportObservation = Observation<SessionAddress, SessionReport>;
