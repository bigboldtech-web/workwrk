// Which access level may a caller give a person they are creating? Used by
// POST /api/users and POST /api/people/bulk-import, which both took the level
// straight from the request, so any manager could mint a COMPANY_ADMIN
// account (a live privilege escalation, found in the Phase 6 reconnaissance).
//
// The rule itself lives in ONE place with the invitation rule:
// src/lib/access/invite-level.ts resolveGrantLevel (via "create"). An org
// admin gives any level except SUPER_ADMIN (only a SUPER_ADMIN gives that);
// HR gives any non-admin level; everyone else gives EMPLOYEE or AGENT. An
// absent level is EMPLOYEE; an unknown string is refused, never guessed.

import { ALL_ACCESS_LEVELS, resolveGrantLevel, type InviteAccessLevel } from "@/lib/access/invite-level";

export const ACCESS_LEVELS = ALL_ACCESS_LEVELS;
export type GrantableLevel = InviteAccessLevel;

/** The level to write, or null when the caller may not give it. */
export function grantableAccessLevel(callerLevel: string | null | undefined, requested: unknown): GrantableLevel | null {
  const r = resolveGrantLevel(callerLevel, requested, "create");
  return r.ok ? r.level : null;
}
