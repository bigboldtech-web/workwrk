// GET /api/teammate-skills?agent=<slug>
//
// The signed-in person's own skills with one teammate, newest first
// (docs/plans/ai-teammates-phase5.md step 3, Decisions 13, 25 and 26), with
// whether skills may be used with it now and where Teach a skill can start:
//   { skills: SkillListView[],
//     availability: { offered, on, canTeach, reason },
//     startSites: Array<{ site, address }> }
//
// A signed-in viewer only, never the AI app (Decision 13: a person can
// always read, export and delete their own skills, with AI or the computer
// off). The teammate is read as the person may use it, a removed one
// included (its skills stay listed with the day they will be deleted); one
// they cannot see is 404, as a missing one is. Only the viewer's own skills,
// whoever asks (an Owner's included: Decision 25). No-store.
//
// startSites (step 3, reconciled with the code): each start site with the
// home address the Teach message sends (config.ts siteHomeAddress), since
// only the server knows whether a host is the stand-in's plain http fixture.

import { NextResponse } from "next/server";
import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { loadTeammate, teammateError, teammateNotFound } from "@/lib/agents/teammate-server";
import { listOwnSkills } from "@/lib/skills/manage";

export async function GET(req: Request) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const slug = new URL(req.url).searchParams.get("agent") ?? "";
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  const out = await listOwnSkills(viewer, agent);
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
