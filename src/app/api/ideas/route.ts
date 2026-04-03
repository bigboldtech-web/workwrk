import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const mine = url.searchParams.get("mine");
  const sort = url.searchParams.get("sort") || "newest";

  const where: any = { organizationId: orgId };
  if (status) where.status = status;
  if (category) where.category = category;
  if (mine === "true") where.submitterId = getUserId(session);

  const orderBy: any = sort === "votes"
    ? { votes: { _count: "desc" } }
    : { createdAt: "desc" };

  const ideas = await prisma.idea.findMany({
    where,
    include: {
      submitter: { select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { name: true } } } },
      reviewer: { select: { id: true, firstName: true, lastName: true } },
      votes: { select: { userId: true } },
      _count: { select: { votes: true, comments: true } },
    },
    orderBy,
    take: 50,
  });

  return jsonSuccess(ideas);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json();
  const { title, description, category } = body;

  if (!title?.trim() || !description?.trim()) {
    return jsonError("Title and description are required");
  }

  const idea = await prisma.idea.create({
    data: {
      title: title.trim(),
      description: description.trim(),
      category: category || null,
      submitterId: userId,
      organizationId: orgId,
    },
    include: {
      submitter: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      _count: { select: { votes: true, comments: true } },
    },
  });

  return jsonSuccess(idea, 201);
}
