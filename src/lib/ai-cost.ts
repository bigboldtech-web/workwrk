// What one AI answer cost, as the AI routes record it (AgentRun.costCents,
// ChatSession.totalCostCents): an ESTIMATE at approximate Sonnet prices, $3
// per million input tokens and $15 per million output tokens, rounded up to
// a whole cent. Nothing a person reads shows it: a person's use is counted in
// AI questions, the unit the plan sells.
//
// The four places that record it (Ask AI's chat and its stream, the
// autonomous agents' loop, an AI teammate's turn) each multiplied by 100 once
// too often until 2026-10-07, so rows written before then hold 100 times
// this. Whole numbers only here: a cent is 10,000 input tokens' worth of
// three, so no rounding error can push an exact cent up by one.
//
// Pure: no imports.

/** Cents for `tokensIn` input and `tokensOut` output tokens, rounded up. */
export function aiCostCents(tokensIn: number, tokensOut: number): number {
  const input = Number.isFinite(tokensIn) && tokensIn > 0 ? Math.floor(tokensIn) : 0;
  const output = Number.isFinite(tokensOut) && tokensOut > 0 ? Math.floor(tokensOut) : 0;
  // $3 per million input tokens is 3 cents per 10,000; $15 per million output is 15.
  return Math.ceil((input * 3 + output * 15) / 10_000);
}
