import { Rpc } from "@opencode-ai/plugin/rpc";
import { SessionGetInput, SessionGetSuccess, SessionGetError } from "opencoattails/tools/session-get/contract";

/** Portable client contract; importing this entrypoint does not acquire a source. */
export const CotailRead = Rpc.define({
  id: "cotail.read",
  methods: {
    sessionGet: {
      input: SessionGetInput,
      output: SessionGetSuccess,
      errors: { read_failed: SessionGetError },
    },
  },
  events: {},
});
