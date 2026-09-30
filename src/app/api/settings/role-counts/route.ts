import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sessionIsSettingsReader } from "@/lib/access/workspace-admin";
import { roleCountsFor } from "@/lib/access/role-counts";

// GET /api/settings/role-counts: Owners, Admins, Members, Guests and the
// People team, live, for the Access explainer and the Members count strip.
// The people who may open those pages (Owner, Admin and the manager tier,
// read-only below Admin).
export async function GET() {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as { organizationId?: string } | undefined)?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sessionIsSettingsReader(session)) return NextResponse.json({ error: "no_access" }, { status: 403 });
  return NextResponse.json({ counts: await roleCountsFor(orgId) }, { headers: { "Cache-Control": "no-store" } });
}
