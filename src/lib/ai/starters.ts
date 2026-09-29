// The Ask AI starters: ONE list for the /sidekick landing and the Ask AI
// panel, so the one assistant never speaks with two voices (spec-ai-automation
// section 2: one assistant, one name, one panel, one page).
//
// Each is backed by a registered tool so it actually runs (search_tasks,
// get_team_alignment_rollup, create_task, list_my_kpi_status, search_sops,
// send_kudos). A starter that ends in a space wants the rest typed: clicking
// it fills the composer instead of sending.

export const ASK_AI_STARTERS: readonly string[] = [
  "What is due for me this week?",
  "Summarise what my team finished last week",
  "Create a task from this note: ",
  "Where do I stand on my KPIs?",
  "Find the SOP for ",
  "Give kudos to ",
];

/** Whether clicking this starter fills the composer rather than sending. */
export function starterWantsMore(s: string): boolean {
  return s.endsWith(" ");
}

/**
 * The label a starter button shows. One that wants more typed ends in an
 * ellipsis ("Find the SOP for…"), so it reads as "fill this in", not as a
 * question that sends on click.
 */
export function starterLabel(s: string): string {
  const base = s.trim().replace(/:$/, "");
  return starterWantsMore(s) ? `${base}\u2026` : base;
}
