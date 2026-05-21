// GET /api/sidekick/sessions  — list my chat sessions
// POST /api/sidekick/sessions — start a new session (returns the id)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  return { userId: user.id, orgId: user.organizationId };
}

export async function GET() {
  const c = await ctx();
  if ("error" in c) return c.error;
  const sessions = await prisma.chatSession.findMany({
    where: { organizationId: c.orgId, userId: c.userId, archivedAt: null },
    select: {
      id: true,
      title: true,
      pinned: true,
      lastModel: true,
      totalTokensIn: true,
      totalTokensOut: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ sessions });
}

const createSchema = z.object({
  title: z.string().max(200).optional(),
  agentSlug: z.string().max(64).optional(),
  // Board-level context — when the session is opened from an app
  // surface (e.g. /crm/pipeline → Sidekick link), the caller passes
  // the product slug and current board key so the runtime can scope
  // tools + system prompt without asking the user "which board?".
  productContext: z.string().max(80).optional(),
  boardContext: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Resolve optional agent — must belong to the same org + be enabled.
  let agentId: string | null = null;
  let inheritedTitle: string | null = null;
  if (parsed.data.agentSlug) {
    const agent = await prisma.agent.findFirst({
      where: { organizationId: c.orgId, slug: parsed.data.agentSlug, status: "ENABLED" },
      select: { id: true, name: true },
    });
    if (!agent) return NextResponse.json({ error: "agent not found or not enabled" }, { status: 404 });
    agentId = agent.id;
    inheritedTitle = `Chat with ${agent.name}`;
  }

  const session = await prisma.chatSession.create({
    data: {
      organizationId: c.orgId,
      userId: c.userId,
      title: parsed.data.title ?? inheritedTitle,
      agentId,
      productContext: parsed.data.productContext ?? null,
      boardContext: parsed.data.boardContext ?? null,
    },
    select: {
      id: true, title: true, agentId: true,
      productContext: true, boardContext: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ session });
}
