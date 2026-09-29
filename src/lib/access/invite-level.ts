// Which access level an invitation may carry (the invite-escalation fix,
// Phase 8 Stage A). Before this, POST /api/invitations and POST /api/setup
// stored whatever level the body named, so anyone who could invite (the
// whole manager tier) could invite an outside address as COMPANY_ADMIN, and
// accept-invite applied it as stored.
//
// ONE rule for every path that gives a person a level (review A fix): POST
// /api/invitations, POST /api/setup, the AI agent's invite tool and POST
// /api/users (through src/lib/people/grantable-level.ts, which delegates
// here). Decided by the smallest worst case:
//   - SUPER_ADMIN is WorkwrK staff: never by invitation; by direct create
//     only from a SUPER_ADMIN.
//   - Admins (SUPER_ADMIN, COMPANY_ADMIN) may give any other level.
//   - Nobody else ever gives COMPANY_ADMIN.
//   - HR (the People team) places a new hire at any non-admin level, by
//     invitation or directly, as it could before this rule.
//   - Everyone else, by INVITATION, gives a level on the ladder at or below
//     their own rung (a Manager invites Managers, Team leads, Employees,
//     Agents), never HR.
//   - Everyone else, by DIRECT CREATE, gives only EMPLOYEE or AGENT. The two
//     paths differ on purpose: the creator of an account chooses its
//     password, so a Manager creating a second Manager login would own a
//     same-tier sock puppet; an invitee chooses their own password.
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

export type GrantVia = "invite" | "create";

export function resolveGrantLevel(
  callerLevel: string | null | undefined,
  requested: unknown,
  via: GrantVia,
): InviteLevelResult {
  const level = requested === undefined || requested === null || requested === "" ? "EMPLOYEE" : requested;
  if (typeof level !== "string" || !(ALL_ACCESS_LEVELS as readonly string[]).includes(level)) {
    return { ok: false, status: 400, error: `Unknown access level: ${String(level)}` };
  }
  const want = level as InviteAccessLevel;
  const caller = callerLevel ?? "EMPLOYEE";
  if (want === "SUPER_ADMIN") {
    if (via === "create" && caller === "SUPER_ADMIN") return { ok: true, level: want };
    return { ok: false, status: 403, error: via === "invite" ? "That access level cannot be given by invitation" : "You can't give that access level" };
  }
  if (ADMIN.has(caller)) return { ok: true, level: want };
  if (want === "COMPANY_ADMIN") return { ok: false, status: 403, error: via === "invite" ? "Only an Admin can invite an Admin" : "Only an Admin can make an Admin" };
  if (caller === "HR") return { ok: true, level: want };
  if (via === "create") {
    if (want === "EMPLOYEE" || want === "AGENT") return { ok: true, level: want };
    return { ok: false, status: 403, error: "You can add people as Employee or Agent. An admin or the People team sets a higher level" };
  }
  const mine = LADDER.indexOf(caller as InviteAccessLevel);
  const theirs = LADDER.indexOf(want);
  if (mine === -1 || theirs === -1 || theirs > mine) {
    return { ok: false, status: 403, error: "You can invite people at your own level or below" };
  }
  return { ok: true, level: want };
}

export function resolveInviteLevel(inviterLevel: string | null | undefined, requested: unknown): InviteLevelResult {
  return resolveGrantLevel(inviterLevel, requested, "invite");
}
