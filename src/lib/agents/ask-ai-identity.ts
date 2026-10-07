// Ask AI in the approval queue (docs/plans/ai-teammates.md, follow-up 1.5c):
// its own requests have no teammate (AgentAction.agentId null). What the
// card building and the queue read for them, in one place.
//
// Pure: types only.

import type { ActionPreview } from "./teammate-thread";

/** What prepareCall reads of the caller for Ask AI's calls (it has no teammate). */
export const ASK_AI_PREPARE = { agentId: "ask-ai", agentName: "Ask AI" } as const;

/** Ask AI's card: the same preview, without "don't ask again", which Ask AI never offers. */
export function askAiPreview(p: ActionPreview): ActionPreview {
  const out: ActionPreview = { ...p };
  delete out.alwaysKey;
  delete out.alwaysLabel;
  return out;
}
