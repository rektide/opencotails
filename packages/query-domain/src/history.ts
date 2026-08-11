import type { SessionSelector, SessionSummary } from "./session.ts";

export interface HistoryRequest {
  selector: SessionSelector;
  countSince: number;
  limit: number;
}

export interface HistoryEntry extends SessionSummary {
  messagesRecent: number;
  messagesTotal: number;
}
