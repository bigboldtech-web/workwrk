// Candidates — list + create. Manager+ only (candidate data is PII
// the wider org shouldn't see). Email is org-scoped unique.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  jsonError,
  jsonSuccess,
  isManager,
} from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const sp = new URL(req.url).searchParams;
  const search = sp.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(1, Number(sp.get("limit") ?? 100)), 200);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  // Workspace filter — see CRM pattern in /api/crm/leads. Legacy rows
  // (workspaceId null) remain visible across every workspace.
  const workspaceId = sp.get("workspace");
  if (workspaceId) {
    if (where.OR) {
      // Combine search OR with workspace OR using AND.
      where.AND = [{ OR: where.OR }, { OR: [{ workspaceId }, { workspaceId: null }] }];
      delete where.OR;
    } else {
      where.OR = [{ workspaceId }, { workspaceId: null }];
    }
  }

  const candidates = await prisma.candidate.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      resumeUrl: true,
      hiredUserId: true,
      _count: { select: { applications: true } },
    },
  });

  return jsonSuccess(candidates);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const body = await req.json();
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
  const resumeUrl = typeof body.resumeUrl === "string" ? body.resumeUrl.trim() || null : null;
  const source = typeof body.source === "string" ? body.source.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  if (!firstName || !lastName) return jsonError("firstName and lastName are required");
  if (!emailRaw || !emailRaw.includes("@")) return jsonError("Valid email is required");

  const orgId = getOrgId(session);
  const userId = (session.user as { id: string }).id;

  const existing = await prisma.candidate.findUnique({
    where: { organizationId_email: { organizationId: orgId, email: emailRaw } },
    select: { id: true },
  });
  if (existing) {
    return jsonError("A candidate with that email already exists in this org", 409);
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const candidate = await prisma.candidate.create({
    data: {
      organizationId: orgId,
      workspaceId,
      firstName,
      lastName,
      email: emailRaw,
      phone,
      resumeUrl,
      source,
      notes,
    },
  });

  logActivity({
    type: "candidate_added",
    actorId: userId,
    organizationId: orgId,
    description: `Added candidate ${firstName} ${lastName}`,
    targetId: candidate.id,
    targetType: "candidate",
  });

  return jsonSuccess(candidate, 201);
}
