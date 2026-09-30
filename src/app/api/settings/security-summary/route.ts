import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import { adminEnrolment } from "@/lib/access/role-counts";

// GET /api/settings/security-summary: the live lines on Security > Sign-in
// policy (who has two step verification) and the SCIM base URL. Owner page.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const su = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!su?.id || !su.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await sessionMayManageOwnerPage(session))) return NextResponse.json({ error: "no_access", page: "security" }, { status: 403 });
  const base = process.env.NEXTAUTH_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  return NextResponse.json(
    { mfa: await adminEnrolment(su.organizationId, su.id), scimBaseUrl: `${base}/api/scim/v2` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
