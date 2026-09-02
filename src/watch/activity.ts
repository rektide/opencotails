import type { MessageActivityObservation } from "@opencoattails/query-kysely";

export type WatchObservationKind = "initial" | "subsequent";

export interface WatchActivityObservation {
  readonly observation: WatchObservationKind;
  readonly observedAt: number;
  readonly activity: MessageActivityObservation;
}

export interface WatchActivitySource {
  readonly sample: (cutoff: number, limit: number) => Promise<readonly MessageActivityObservation[]>;
}

export interface WatchActivityOptions {
  readonly source: WatchActivitySource;
  readonly cutoffAt: (now: number) => number;
  readonly limit: number;
  readonly includeInitial: boolean;
  readonly once: boolean;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly wait: (signal: AbortSignal) => Promise<void>;
  readonly emit: (observation: WatchActivityObservation) => Promise<void>;
}

function identity(activity: MessageActivityObservation): string {
  return `${activity.target.source.sourceID}\u0000${activity.target.address.messageID}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ascendingActivity(a: MessageActivityObservation, b: MessageActivityObservation): number {
  return a.value.createdAt - b.value.createdAt
    || compareText(a.target.address.messageID, b.target.address.messageID)
    || compareText(a.target.source.sourceID, b.target.source.sourceID)
    || compareText(a.target.address.session.sessionID, b.target.address.session.sessionID);
}

/**
 * Polls finite recent-activity snapshots and emits identities not previously
 * observed by this process. These are observations, not reconstructed causal
 * events; changes that enter and leave between samples are not recoverable.
 */
export async function watchMessageActivity(options: WatchActivityOptions): Promise<void> {
  const seen = new Map<string, number>();
  let first = true;
  while (!options.signal.aborted) {
    const cutoff = options.cutoffAt(options.now());
    const sample = await options.source.sample(cutoff, options.limit);
    if (options.signal.aborted) return;
    const observedAt = options.now();

    for (const [key, createdAt] of seen) {
      if (createdAt < cutoff) seen.delete(key);
    }

    const unseen = sample.filter((activity) => !seen.has(identity(activity)))
      .sort(ascendingActivity);
    for (const activity of unseen) {
      const key = identity(activity);
      seen.set(key, activity.value.createdAt);
      if (!first || options.includeInitial) {
        await options.emit({
          observation: first ? "initial" : "subsequent",
          observedAt,
          activity,
        });
      }
      if (options.signal.aborted) return;
    }

    if (options.once) return;
    first = false;
    await options.wait(options.signal);
  }
}

export function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
