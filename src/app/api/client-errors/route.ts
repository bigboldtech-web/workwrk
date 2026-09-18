// POST /api/client-errors (spec-shell 2.3, 2.6): the in-shell error
// boundary and the last-resort boundary report their digest here,
// fire-and-forget, so shell errors are visible in the server log next to
// the request that produced them. Never throws back to the page.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { digest?: unknown; pathname?: unknown; userAgent?: unknown; message?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const session = await getServerSession(authOptions).catch(() => null);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  const digest = typeof body.digest === "string" ? body.digest.slice(0, 120) : null;
  const pathname = typeof body.pathname === "string" ? body.pathname.slice(0, 300) : null;
  const userAgent = typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : null;
  const message = process.env.NODE_ENV !== "production" && typeof body.message === "string" ? body.message.slice(0, 500) : null;
  console.error("[client-error]", JSON.stringify({ digest, pathname, userAgent, userId: u?.id ?? null, orgId: u?.organizationId ?? null, message }));
  return new NextResponse(null, { status: 204 });
}
