// Plan resource limits — a PURE constant (zero imports) so Client
// Components (e.g. the billing settings page) can read it WITHOUT pulling
// prisma/pg (and its Node built-ins: dns/fs/net/tls) into the browser
// bundle. The enforcement logic that needs prisma lives in plan-limits.ts,
// which re-exports this.
export const PLAN_LIMITS: Record<string, { users: number; sops: number; ai: number }> = {
  STARTER: { users: 10, sops: 3, ai: 50 },
  GROWTH: { users: 50, sops: 20, ai: 500 },
  SCALE: { users: 200, sops: 100, ai: 2000 },
  ENTERPRISE: { users: 99999, sops: 99999, ai: 99999 },
};

// AI teammates per plan (docs/plans/ai-teammates.md, "Decisions taken" 1).
// `personal` is how many teammates of their own (PRIVATE) one person may
// have; `workspace` is how many the whole workspace may share (WORKSPACE).
// Every turn spends one of the plan's AI questions either way, so these bound
// clutter, not cost. 99999 is no limit, as above (Plan & billing shows it as
// "no limit").
export const TEAMMATE_LIMITS: Record<string, { personal: number; workspace: number }> = {
  STARTER: { personal: 3, workspace: 3 },
  GROWTH: { personal: 20, workspace: 30 },
  SCALE: { personal: 50, workspace: 100 },
  ENTERPRISE: { personal: 99999, workspace: 99999 },
};
