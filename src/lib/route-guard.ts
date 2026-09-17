// Server-side route guards. The launch-checklist spec lists pages
// employees and agents must not reach (Tools, Talent, Process Runs,
// Analytics, Integrations, AI, Onboarding management, Assets). The
// sidebar already hides them, but URL-direct navigation used to load
// the page anyway and rely on the API to refuse data — leaking the
// page chrome and sometimes empty UI. These guards close that gap.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

// Delegate (migration step 1): both lists come from the engine's one copy in
// src/lib/access/legacy-levels.ts. EMPLOYEE_LEVELS stays a DENY list there,
// because that is what it is here: a level in neither list behaves oppositely
// in this file and in page-gates.ts, and the pivot does not reconcile them.
import { LEGACY_EMPLOYEE_LEVELS, legacyIsAdminLevel } from "@/lib/access/legacy-levels";

export async function requireManagerOrRedirect(redirectTo: string = "/dashboard"): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (LEGACY_EMPLOYEE_LEVELS.has(level)) redirect(redirectTo);
}

// Stricter than manager — only the two protected admin tiers. Used
// for org-wide configuration surfaces (tags, billing, integrations,
// security policy) where a regular manager shouldn't have write
// access even though they can see most operational data.
export async function requireOrgAdminOrRedirect(redirectTo: string = "/dashboard"): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (!legacyIsAdminLevel(level)) redirect(redirectTo);
}
