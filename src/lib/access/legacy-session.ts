// The legacy tier answers for the signed-in person, as booleans, for the
// delegating gates that must keep today's behaviour until the engine flips
// (spec-ai-automation section 4 step 2: "until then the wrappers delegate, so
// behaviour is unchanged on merge"). It lives here because this directory is
// the one place allowed to read the access level; callers get yes/no answers
// and never the level itself.
//
// Server-only: reads the session.

import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth";
import { legacyIsAdminLevel, legacyIsManagerLevel } from "./legacy-levels";

/** The four levels the Tools list has always treated as tool admins. */
const TOOL_ADMIN_LEVELS: ReadonlySet<string> = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "HR"]);

export interface LegacySessionTiers {
  /** A manager or above (C_LEVEL, VP, DIRECTOR, MANAGER, TEAM_LEAD, HR, admins). */
  manager: boolean;
  /** SUPER_ADMIN or COMPANY_ADMIN. */
  admin: boolean;
  /** Sees every tool in the workspace (GET /api/tools's old rule). */
  toolAdmin: boolean;
  /** The display name on the session, for Trash's "Deleted by". */
  name: string | null;
}

export async function legacySessionTiers(): Promise<LegacySessionTiers> {
  const session = await getServerSession(authOptions);
  const user = (session?.user ?? {}) as Record<string, unknown>;
  const level = typeof user["accessLevel"] === "string" ? (user["accessLevel"] as string) : null;
  return {
    manager: legacyIsManagerLevel(level),
    admin: legacyIsAdminLevel(level),
    toolAdmin: level !== null && TOOL_ADMIN_LEVELS.has(level),
    name: typeof user.name === "string" ? user.name : null,
  };
}
