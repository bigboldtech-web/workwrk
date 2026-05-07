// Server-side route guards. The launch-checklist spec lists pages
// employees and agents must not reach (Tools, Talent, Process Runs,
// Analytics, Integrations, AI, Onboarding management, Assets). The
// sidebar already hides them, but URL-direct navigation used to load
// the page anyway and rely on the API to refuse data — leaking the
// page chrome and sometimes empty UI. These guards close that gap.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

const EMPLOYEE_LEVELS = new Set(["EMPLOYEE", "AGENT"]);

export async function requireManagerOrRedirect(redirectTo: string = "/dashboard"): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const level = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (EMPLOYEE_LEVELS.has(level)) redirect(redirectTo);
}
