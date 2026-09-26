// The page gate of the three Culture pages: /kudos, /candor and /surveys
// (and their detail pages). Spec-teams-performance section 1 Access and
// access-model-spec 5.2: a Guest always gets the in-shell 404; Kudos opens to
// every Member; Candor and Surveys open to the people who run them and to
// the people asked to answer them, and to nobody else (a Member outside
// every session and survey audience gets the in-shell 404, so the page and
// its sidebar row never disagree).
//
// `organiser` is the SAME predicate the create routes check (POST
// /api/candor and POST /api/pulse-surveys: the manager tier, HR included,
// plus the People team and Admin), so a page never shows a create button
// whose save is refused.
//
// Server only.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { candorInvitedFor, surveyTargetedFor } from "./teams-counts";

export interface CultureGateResult {
  userId: string;
  organizationId: string;
  /** May create sessions or surveys (and sees the organiser face). */
  organiser: boolean;
}

/** The create rule, one place: the legacy manager tier, the People team, Owner or Admin. */
export function isCultureOrganiser(v: { accessLevel: string | null | undefined; orgRole: string; peopleTeam?: boolean }): boolean {
  return legacyIsManagerLevel(v.accessLevel) || v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true;
}

export async function cultureGate(key: "kudos" | "candor" | "surveys", callbackUrl: string): Promise<CultureGateResult> {
  const viewer = await viewerFromSession();
  if (!viewer) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  // Guests never reach the Teams hub (access 2.3).
  if (viewer.orgRole === "GUEST") notFound();
  const session = (await getServerSession(authOptions)) as { user?: { accessLevel?: string | null } } | null;
  const organiser = isCultureOrganiser({
    accessLevel: session?.user?.accessLevel,
    orgRole: viewer.orgRole,
    peopleTeam: viewer.peopleTeam,
  });
  const base = { userId: viewer.userId, organizationId: viewer.organizationId, organiser };
  if (key === "kudos" || organiser) return base;

  if (key === "candor") {
    const invited = await candorInvitedFor(viewer.userId, viewer.organizationId, viewer.departmentId ?? null);
    if (!invited) notFound();
    return base;
  }

  const me = await prisma.user.findUnique({
    where: { id: viewer.userId },
    select: { officeId: true, departmentId: true },
  });
  const targeted = await surveyTargetedFor(viewer.userId, viewer.organizationId, {
    officeId: me?.officeId ?? null,
    departmentId: me?.departmentId ?? null,
  });
  if (!targeted) notFound();
  return base;
}

/**
 * The create rule for the API routes, over the request's session: the
 * legacy manager tier first (no extra query), then the engine's Viewer for
 * the People team and Admin.
 */
export async function cultureOrganiserFromSession(session: { user?: { accessLevel?: string | null } } | null): Promise<boolean> {
  if (legacyIsManagerLevel(session?.user?.accessLevel)) return true;
  const v = await viewerFromSession();
  if (!v) return false;
  return isCultureOrganiser({ accessLevel: session?.user?.accessLevel, orgRole: v.orgRole, peopleTeam: v.peopleTeam });
}
