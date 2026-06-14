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
