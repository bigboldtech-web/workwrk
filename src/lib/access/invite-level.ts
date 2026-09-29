// Which access level an invitation may carry (the invite-escalation fix,
// Phase 8 Stage A). Before this, POST /api/invitations and POST /api/setup
// stored whatever level the body named, so anyone who could invite (the
// whole manager tier) could invite an outside address as COMPANY_ADMIN, and
// accept-invite applied it as stored.
//
// The rule, decided by the smallest worst case:
//   - SUPER_ADMIN is never invitable (it is WorkwrK staff, granted by hand).
//   - Admins (SUPER_ADMIN, COMPANY_ADMIN) may invite any other level.
//   - Everyone else may invite only on the ladder at or below their own
//     rung (a Manager invites Managers, Team leads, Employees, Agents), and
//     never an admin; HR invites at or below Employee plus HR itself.
//   - An unknown level is a 400 that names it; no level means EMPLOYEE.
//
// Pure and inside src/lib/access (the one directory allowed to reason about
// levels). The engine's org.invite_member rule replaces the tier half when
// access step 5 lands; the level half stays.

export const ALL_ACCESS_LEVELS = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "MANAGER",
  "TEAM_LEAD",
  "EMPLOYEE",
  "AGENT",
  "HR",
] as const;
export type InviteAccessLevel = (typeof ALL_ACCESS_LEVELS)[number];

const LADDER: readonly InviteAccessLevel[] = ["AGENT", "EMPLOYEE", "TEAM_LEAD", "MANAGER", "DIRECTOR", "VP", "C_LEVEL"];
const ADMIN = new Set<string>(["SUPER_ADMIN", "COMPANY_ADMIN"]);

export type InviteLevelResult =
  | { ok: true; level: InviteAccessLevel }
  | { ok: false; status: 400 | 403; error: string };

export function resolveInviteLevel(inviterLevel: string | null | undefined, requested: unknown): InviteLevelResult {
  const level = requested === undefined || requested === null || requested === "" ? "EMPLOYEE" : requested;
  if (typeof level !== "string" || !(ALL_ACCESS_LEVELS as readonly string[]).includes(level)) {
    return { ok: false, status: 400, error: `Unknown access level: ${String(level)}` };
  }
  const want = level as InviteAccessLevel;
  if (want === "SUPER_ADMIN") return { ok: false, status: 403, error: "That access level cannot be given by invitation" };
  const inviter = inviterLevel ?? "EMPLOYEE";
  if (ADMIN.has(inviter)) return { ok: true, level: want };
  if (want === "COMPANY_ADMIN") return { ok: false, status: 403, error: "Only an Admin can invite an Admin" };
  if (inviter === "HR") {
    if (want === "HR" || want === "EMPLOYEE" || want === "AGENT") return { ok: true, level: want };
    return { ok: false, status: 403, error: "You can invite people at your own level or below" };
  }
  const mine = LADDER.indexOf(inviter as InviteAccessLevel);
  const theirs = LADDER.indexOf(want);
  if (mine === -1 || theirs === -1 || theirs > mine) {
    return { ok: false, status: 403, error: "You can invite people at your own level or below" };
  }
  return { ok: true, level: want };
}
