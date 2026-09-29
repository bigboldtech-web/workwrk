// The gate of /team (My team) and /team/workload (Workload): the one
// sanctioned departure from the app-key 404 (spec-teams-people section 0,
// DECIDED). A Member with nobody reporting to them gets LockedPage with an
// explanatory sentence and no Request access, because the cause is plain
// and not secret (the org chart every Member can open says the same thing)
// and a 404 would read as a broken link. A Guest gets the in-shell 404 like
// every other Teams route. Anyone the APP_RULES row admits (reports solid or
// dotted, the People team, Owner, Admin) gets the page.
//
// Server only.

import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/access/index";
import { viewerFromSession } from "@/lib/access/viewer";
import { requireSessionUser, type PageSessionUser } from "@/lib/page-gates";

export type TeamGateResult = { status: "ok"; user: PageSessionUser } | { status: "locked" };

export async function teamAppGate(key: "team" | "workload", callbackUrl: string): Promise<TeamGateResult> {
  const viewer = await viewerFromSession();
  if (!viewer) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  if (viewer.orgRole === "GUEST") notFound();
  const decision = await can(viewer, "view", { type: "app", key });
  if (!decision.allowed) return { status: "locked" };
  return { status: "ok", user: await requireSessionUser() };
}

/** The two sentences, fixed by the spec (spec-teams-people section 1 Access). */
export const TEAM_LOCKED_SENTENCE = "My team shows the people who report to you. Nobody reports to you yet.";
export const WORKLOAD_LOCKED_SENTENCE = "Workload shows the work of people who report to you. Nobody reports to you yet.";
