// /api/onboard/template: the template a workspace was created with at
// signup (/signup?template=tuesday), for the setup wizard's done screen.
//
// GET   { template: null } or { template: { name, status, spaceSlug, ... } }
// POST  finish a template that failed part way (Try again). It resumes in the
//       Space the first attempt made and never doubles a piece
//       (src/lib/templates/apply-tuesday.ts).
//
// Owner and Admin only: the wizard is theirs, and the marker names objects
// (the SOP, the goal) a Member may not have been shown yet.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { readSignupMarker, retrySignupTemplate, type SignupTemplateMarker } from "@/lib/templates/apply-tuesday";
import { TUESDAY_TEMPLATE_KEY, TUESDAY_TEMPLATE_ROW } from "@/lib/templates/tuesday-template";

const noStore = { "Cache-Control": "no-store" };

function view(marker: SignupTemplateMarker | null) {
  if (!marker || marker.key !== TUESDAY_TEMPLATE_KEY) return null;
  const base = { key: marker.key, name: TUESDAY_TEMPLATE_ROW.name, status: marker.status };
  if (marker.status === "applied") {
    return { ...base, spaceSlug: marker.spaceSlug, boardSlug: marker.boardSlug, sopId: marker.sopId, goalId: marker.goalId, docId: marker.docId };
  }
  if (marker.status === "applying") {
    const stale = Date.now() - Date.parse(marker.startedAt) > 10 * 60 * 1000;
    return { ...base, retryable: stale };
  }
  return { ...base, retryable: true };
}

async function gate() {
  const viewer = await viewerFromSession();
  if (!viewer) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore }) };
  if (viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") return { error: NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore }) };
  return { viewer };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  const org = await prisma.organization.findUnique({ where: { id: g.viewer.organizationId }, select: { settings: true } });
  return NextResponse.json({ template: view(readSignupMarker(org?.settings)) }, { headers: noStore });
}

export async function POST() {
  const g = await gate();
  if ("error" in g) return g.error;
  const marker = await retrySignupTemplate({ organizationId: g.viewer.organizationId, userId: g.viewer.userId });
  if (!marker) {
    const org = await prisma.organization.findUnique({ where: { id: g.viewer.organizationId }, select: { settings: true } });
    return NextResponse.json({ template: view(readSignupMarker(org?.settings)) }, { status: 409, headers: noStore });
  }
  return NextResponse.json({ template: view(marker) }, { status: marker.status === "applied" ? 200 : 500, headers: noStore });
}
