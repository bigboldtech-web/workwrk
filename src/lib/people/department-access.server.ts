import "server-only";

// Who writes departments: Owner and Admin, plus whoever the org's permission
// matrix grants organization.manageDepartments (the People team and the
// org-wide levels by default). That matrix is what the Departments page
// checked yesterday, so the buttons and the routes now agree on one rule and
// nobody who could manage departments loses it.

import { hasPermission } from "@/lib/api-helpers";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";

export async function mayWriteDepartments(session: unknown): Promise<boolean> {
  const s = session as { user?: { accessLevel?: string | null } } | null;
  if (!s?.user) return false;
  if (s.user.accessLevel === "GUEST" || s.user.accessLevel === "AGENT") return false;
  if (legacyIsAdminLevel(s.user.accessLevel ?? null)) return true;
  return hasPermission(s, "organization", "manageDepartments");
}
