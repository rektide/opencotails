import type { DocumentAddress, SessionAddress, Target } from "./address.ts";
import type { WitnessName } from "../direct/witness.ts";
import type { DocumentField } from "./address.ts";
import type { ProjectionRevision } from "./observation.ts";

export interface Located<A extends import("./address.ts").Address, V> {
  readonly target: Target<A>;
  readonly value: V;
}

export interface DirectEvidence {
  readonly kind: "direct";
  readonly witness: WitnessName;
  readonly document: Located<DocumentAddress, {
    readonly field: DocumentField;
    readonly excerpt: string;
    readonly revision?: ProjectionRevision;
  }>;
}

export interface DirectHit<A extends import("./address.ts").Address, V> extends Located<A, V> {
  readonly backend: "direct";
  readonly evidence: readonly DirectEvidence[];
}

export interface SessionSummary {
  readonly sessionID: string;
  readonly projectID: string;
  readonly title: string | null;
  readonly directory: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface GroupedSession<Child> {
  readonly session: Located<SessionAddress, SessionSummary>;
  readonly children: readonly Child[];
  readonly truncated: boolean;
}

export interface SessionCursor {
  readonly updatedAt: number;
  readonly sessionID: string;
}

export interface GroupWindow {
  readonly sessions: { readonly first: number; readonly after?: SessionCursor };
  readonly childrenPerSession: number;
  readonly globalHitLimit?: number;
}
