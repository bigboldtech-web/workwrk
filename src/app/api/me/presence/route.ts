// PUT /api/me/presence: the signed-in person's own status and Do not
// disturb (decided addition c). The avatar menu and the Set status modal
// write it; the Directory, the Org chart, the person record and the
// avatar dots read User.presenceStatus / presenceUntil (presence.ts).
//
// Body: { status: string | null, until: ISO string | null }. A null status
// clears the dot. Only the person writes their own presence.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";

const err = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function PUT(req: NextRequest) {
  const viewer = await viewerFromSession();
  if (!viewer) return err(401, "Unauthorized");
  const body = (await req.json().catch(() => null)) as { status?: unknown; until?: unknown } | null;
  if (!body || typeof body !== "object") return err(400, "Send { status, until }");
  const raw = body.status;
  if (raw !== null && typeof raw !== "string") return err(400, "A status is text, or null to clear it");
  const status = typeof raw === "string" ? raw.trim().slice(0, 60) || null : null;
  let until: Date | null = null;
  if (body.until !== null && body.until !== undefined) {
    if (typeof body.until !== "string") return err(400, "Until is a date and time, or null");
    const d = new Date(body.until);
    if (Number.isNaN(d.getTime())) return err(400, "Until is a date and time, or null");
    until = d;
  }
  try {
    await prisma.user.update({
      where: { id: viewer.userId },
      data: { presenceStatus: status, presenceUntil: status ? until : null },
    });
  } catch {
    // The Phase 6 columns are absent for one release: the status still
    // shows on this device (the shell keeps it locally).
    return err(503, "Status can't be shared yet");
  }
  return NextResponse.json({ status, until: status && until ? until.toISOString() : null });
}
