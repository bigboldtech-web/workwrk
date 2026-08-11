// Person career home — one page, three render modes, decided SERVER-side:
//
//   self    the signed-in person's own home: my job title and JD, my
//           inherited KRAs with MY KPI readings, recording my numbers
//           into the approval loop, my goals, my reviews, my assets.
//   manage  a manager / org-wide viewer inspecting a report: the same
//           narrative plus manage actions (edit profile, manage
//           alignment, record numbers on their behalf).
//   peer    a minimal directory card (name, title, department, manager);
//           never KPI readings, reviews, moods or scores.
//
// The gate runs here, not in the client: resolveAccess({type:"user"})
// decides, and /api/users/[id] + /api/people/[id]/alignment enforce the
// same ladder again server-side.

import { notFound } from "next/navigation";
import { resolveAccess } from "@/lib/access";
import { ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { requireSessionUser } from "@/lib/page-gates";
import ProfileClient from "./profile-client";

export const dynamic = "force-dynamic";

export default async function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireSessionUser();

  const decision = await resolveAccess(
    { userId: viewer.id, organizationId: viewer.organizationId, accessLevel: viewer.accessLevel },
    { type: "user", id },
  );
  if (decision.permission === "none") notFound();

  const mode =
    id === viewer.id
      ? "self"
      : ORG_WIDE_ALIGNMENT_LEVELS.has(viewer.accessLevel) || decision.permission !== "read"
        ? "manage"
        : "peer";

  return <ProfileClient id={id} mode={mode} />;
}
