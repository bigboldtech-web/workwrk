// The switch for repeating goals (docs/plans/recurring-goals.md 2.0), on the
// MCP_OFFERED pattern (src/lib/mcp/config.ts): one environment variable, read
// at call time, so a test (or a reload with --update-env) changes it. Off
// until RECURRING_GOALS=1 (or "true"). The founder sets it only after step 6,
// the final three reviewers and his approval of the step 3a designs.
//
// IT CLOSES THE DOORS, NOT THE READING HALF. Off: the modal renders no Goal
// type, the create and update paths refuse `repeat`, the key-results routes
// refuse `source`, the target editor and the migration offer are not
// rendered. Settling periods, the goal-periods cron, period reads and
// check-in routing run whatever the switch says, and do nothing while no goal
// repeats. Worst case of gating everything: turning the switch off after
// repeating goals exist would strand them mid-period with no close and no
// score. So "off" means "nothing new becomes repeating", and goals already
// repeating keep working.
//
// The client learns it from the server (GET /api/okrs returns
// `recurringGoals`), never from its own bundle.

const TRUE = new Set(["1", "true"]);

/** True only when RECURRING_GOALS is "1" or "true" (any case, spaces ignored). */
export function recurringGoalsOn(): boolean {
  return TRUE.has((process.env.RECURRING_GOALS ?? "").trim().toLowerCase());
}

/** The 400 a door answers while the switch is off. */
export const RECURRING_GOALS_OFF = "Repeating goals are not turned on.";
