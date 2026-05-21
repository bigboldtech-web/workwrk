// /api/me — light read of the current session user's identity +
// department. Used by the dashboard to render a dept-aware "Jump
// into your workspace" callout, and by other surfaces that need
// the user's natural product home.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: {
      id: true, firstName: true, lastName: true, email: true, avatar: true,
      accessLevel: true,
      department: { select: { id: true, name: true } },
      role: { select: { id: true, title: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ user });
}
