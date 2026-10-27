// Workspace settings > Plan & billing's copy that is tested on its own
// (settings-cleanup Phase 7). A page file may export only what Next reads,
// so the strings live here.

/**
 * What the AI questions meter counts: one line under it, and the rest behind
 * its Show more (B6), every fact of the old six-line hint kept.
 */
export const AI_METER_HINT = "Ask AI messages, agent runs and the AI actions people start count.";
export const AI_METER_MORE = [
  "The AI actions are the ones people start in docs, files, forms, tables, whiteboards, SOPs, KRAs, meetings and the app builder.",
  "A request that fails before the AI answers is not counted; an answer that could not be used still is.",
  "Suggestions nobody asked for (field suggestions and goal assessments) never count, run up to a daily total, and stop once the total here is used.",
  "Fill with AI and Talk updates have their own daily limit.",
] as const;
