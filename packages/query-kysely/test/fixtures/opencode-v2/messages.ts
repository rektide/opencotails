import { CURRENT_MESSAGE_VARIANTS } from "../../../src/source/index.ts";

export function validMessageData(type: string, _id: string, created = 1): Record<string, unknown> {
  const base = { time: { created } };
  switch (type) {
    case "agent-switched": return { ...base, agent: "build" };
    case "model-switched": return { ...base, model: { id: "fixture", providerID: "fixture" } };
    case "location-switched": return {
      ...base,
      location: { directory: "/fixture/current", workspaceID: "workspace-current" },
      projectID: "project-current",
      subpath: "packages/current",
      previous: {
        location: { directory: "/fixture/previous", workspaceID: "workspace-previous" },
        projectID: "project-previous",
        subpath: "packages/previous",
      },
    };
    case "user": return { ...base, text: "fixture user" };
    case "synthetic": return { ...base, text: "fixture synthetic" };
    case "system": return { ...base, text: "fixture system" };
    case "skill": return { ...base, skill: "fixture", name: "fixture", text: "fixture skill" };
    case "shell": return { ...base, shellID: "sh_fixture", command: "true", status: "exited" };
    case "assistant": return {
      ...base, agent: "build", model: { id: "fixture", providerID: "fixture" }, content: [],
    };
    case "compaction": return {
      ...base, status: "completed", reason: "auto", summary: "fixture summary", recent: "fixture recent",
    };
    default: return base;
  }
}

export const allMessageVariants = Object.freeze([...CURRENT_MESSAGE_VARIANTS]);
