// POST /api/templates/[slug]/apply
// Applies the named template to the current org. Idempotent-ish — re-
// applying creates another copy of the sample data (no dedupe on
// names) so users can apply multiple times in dev.
//
// Auth: admin only. We don't want random teammates planting demo data
// in a live org.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { TEMPLATES_BY_SLUG } from "@/lib/templates/catalog";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });
  if (user.accessLevel !== "SUPER_ADMIN" && user.accessLevel !== "COMPANY_ADMIN") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const tpl = TEMPLATES_BY_SLUG[slug];
  if (!tpl) return NextResponse.json({ error: "unknown template" }, { status: 404 });

  try {
    const created = await tpl.apply({ orgId: user.organizationId, userId: user.id });
    return NextResponse.json({ ok: true, template: tpl.slug, name: tpl.name, created });
  } catch (e) {
    const message = e instanceof Error ? e.message : "template apply failed";
    console.error("[templates/apply]", slug, e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
