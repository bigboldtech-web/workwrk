// /api/onboard/template: the template a workspace was created with at
// signup (/signup?template=tuesday), for the setup wizard's done screen.
//
// GET   { template: null } or { template: { name, status, spaceSlug, ... } }
// POST  finish a template that failed part way (Try again). It resumes in the
//       Space the first attempt made and never doubles a piece
//       (src/lib/templates/apply-tuesday.ts). When that Space is in Trash
//       the view says so (spaceInTrash) and the body chooses:
//       { choice: "restore" } brings it back and resumes in it,
//       { choice: "fresh" } makes a new one (the one in Trash stays there).
//
// Owner and Admin only: the wizard is theirs, and the marker names objects
// (the SOP, the goal) a Member may not have been shown yet.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { readSignupMarker, retrySignupTemplate, trashedPieceOf, type SignupTemplateMarker, type TrashedPieceKind } from "@/lib/templates/apply-tuesday";
import { restoreTrashRow } from "@/lib/trash-server";
import { TUESDAY_TEMPLATE_KEY, TUESDAY_TEMPLATE_ROW } from "@/lib/templates/tuesday-template";

const noStore = { "Cache-Control": "no-store" };

function view(marker: SignupTemplateMarker | null, trashed: { name: string; kind: TrashedPieceKind } | null = null) {
  if (!marker || marker.key !== TUESDAY_TEMPLATE_KEY) return null;
  const base = { key: marker.key, name: TUESDAY_TEMPLATE_ROW.name, status: marker.status };
  if (marker.status === "applied") {
    return {
      ...base, spaceSlug: marker.spaceSlug, boardSlug: marker.boardSlug, sopId: marker.sopId, goalId: marker.goalId, docId: marker.docId,
      kraId: marker.kraId ?? null, kpiId: marker.kpiId ?? null, jobTitles: Array.isArray(marker.jobTitleIds) ? marker.jobTitleIds.length : 0,
      skipped: Array.isArray(marker.skipped) ? marker.skipped.filter((x): x is string => typeof x === "string") : [],
    };
  }
  const inTrash = trashed ? { name: trashed.name, kind: trashed.kind } : null;
  if (marker.status === "applying") {
    const stale = Date.now() - Date.parse(marker.startedAt) > 10 * 60 * 1000;
    return { ...base, retryable: stale, spaceInTrash: stale ? inTrash : null };
  }
  return { ...base, retryable: true, spaceInTrash: inTrash };
}

async function gate() {
  const viewer = await viewerFromSession();
  if (!viewer) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore }) };
  if (viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") return { error: NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore }) };
  return { viewer };
}

async function currentView(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const marker = readSignupMarker(org?.settings);
  return view(marker, await trashedPieceOf(orgId, marker));
}

export async function GET() {
  const g = await gate();
  if ("error" in g) return g.error;
  return NextResponse.json({ template: await currentView(g.viewer.organizationId) }, { headers: noStore });
}

export async function POST(req: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const orgId = g.viewer.organizationId;
  const body = (await req.json().catch(() => ({}))) as { choice?: unknown };
  const choice = body.choice === "restore" || body.choice === "fresh" ? body.choice : null;
  if (choice === "restore") {
    // Bring the piece back out of Trash (the Trash page's own restore and
    // its checks), then resume in it. A refusal says why, with both choices
    // still offered.
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const trashed = await trashedPieceOf(orgId, readSignupMarker(org?.settings));
    if (trashed) {
      const res = await restoreTrashRow(g.viewer, trashed.rowId);
      if (!res.ok) return NextResponse.json({ template: await currentView(orgId), error: res.message }, { status: res.status, headers: noStore });
    }
  }
  const marker = await retrySignupTemplate({ organizationId: orgId, userId: g.viewer.userId, fresh: choice === "fresh" });
  if (!marker) return NextResponse.json({ template: await currentView(orgId) }, { status: 409, headers: noStore });
  return NextResponse.json({ template: view(marker, await trashedPieceOf(orgId, marker)) }, { status: marker.status === "applied" ? 200 : 500, headers: noStore });
}
