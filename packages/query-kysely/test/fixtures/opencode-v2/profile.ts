import type { TrustedSourceProfileFacts } from "../../../src/profile/types.ts";
import { allMessageVariants } from "./messages.ts";

export const trustedSourceProfileFacts: TrustedSourceProfileFacts = Object.freeze({
  capabilities: Object.freeze({
    "history.message_owner_lookup": Object.freeze({
      status: "indexed",
      index: "session_message_session_seq_idx",
      equality_prefix: ["session_id"],
    }),
    "message.timeline": Object.freeze({
      status: "indexed",
      index: "session_message_session_seq_idx",
      equality_prefix: ["session_id"],
    }),
  }),
  supportedMessageVariants: allMessageVariants,
});
