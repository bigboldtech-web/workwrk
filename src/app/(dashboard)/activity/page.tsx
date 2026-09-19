// /activity: what happened recently, yours and, if you manage people, theirs.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity).
//
// The server half is the gate plus the one thing the first paint cannot guess:
// which scope pills this viewer may use. The page never renders a pill whose
// request would 403, which is the fix for an IC seeing "My team" selected and
// getting their own rows back (work-tasks #8).

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";
import { loadOrgFacts } from "@/lib/access/facts";
import { allowedScopes, parseActivityScope, viewerScopeFacts } from "@/lib/activity-scope";
import { prisma } from "@/lib/prisma";
import { ActivityClient } from "./activity-client";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; person?: string }>;
}) {
  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/activity" });
  if (viewer.orgRole === "GUEST") notFound();

  const sp = await searchParams;
  const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
  const scopes = allowedScopes(viewerScopeFacts(viewer, org.peopleTeamIds));
  const asked = parseActivityScope(sp.view);

  return (
    <ActivityClient
      scopes={scopes}
      // A person arriving on ?view=team without reports lands on Just me
      // rather than on a 403: the URL is a request, not a claim.
      initialScope={scopes.includes(asked) ? asked : "my"}
      initialPerson={sp.person ?? null}
      // The name to print on the "Filtered to" chip. Without it the page
      // filtered to one actor with nothing on screen saying so.
      initialPersonName={await personName(viewer.organizationId, sp.person ?? null)}
    />
  );
}

/**
 * The name behind `?person=`, or null.
 *
 * Scoped to the viewer's own org, so the parameter cannot be used to read back
 * a name from anywhere else, and null when the id matches nobody, which the
 * client renders as "one person" rather than as an id.
 */
async function personName(organizationId: string, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const row = await prisma.user
    .findFirst({ where: { id: personId, organizationId }, select: { firstName: true, lastName: true } })
    .catch(() => null);
  if (!row) return null;
  return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null;
}
