// Soft-archive an item update. Never hard-deletes.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const existing = await prisma.itemUpdate.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, authorId: true, archivedAt: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Only the author can archive their own update.
  if (existing.authorId && existing.authorId !== ctx.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (existing.archivedAt) return NextResponse.json({ ok: true, alreadyArchived: true });

  await prisma.itemUpdate.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
