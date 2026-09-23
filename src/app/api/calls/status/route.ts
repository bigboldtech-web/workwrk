import { NextResponse } from "next/server";
import { getSessionOrFail, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";

// GET /api/calls/status -> { configured } (spec-talk.md section 2.6 Data).
//
// One honest answer to "are calls set up on this deployment", read by the Talk
// module card in Workspace settings and by the Call button's 400 dialog. Until
// now the only way to find out was to press Call and watch it fail, or to
// arrive at a guest page that silently forwarded you to a public third-party
// server.
//
// TWO AUDIENCES, TWO ANSWERS, and the split is the point:
//
//   every member  { configured }, "can I have a call at all". They need it,
//     because without it the Call button posts "Started a call" into the
//     channel's history for a call that can never connect, and the misleading
//     card outlives the attempt. This is the same fact the dock already tells
//     them one click later; telling them one click earlier costs nothing.
//   Owners and Admins  also { host }, WHICH media server this points at, so
//     a misconfiguration is recognisable. Never the key and never the secret.
//
// It reports on environment variables and reaches no database and no media
// server, so it is cheap enough to call on a page render.

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!getOrgId(session)) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const accessLevel = (session.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";
  const isAdmin = legacyIsAdminLevel(accessLevel);

  const configured = Boolean(
    process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET,
  );

  // The URL's HOST, never the key or the secret, and only for the people whose
  // business the deployment's configuration is.
  let host: string | null = null;
  if (configured && isAdmin) {
    try { host = new URL(process.env.LIVEKIT_URL as string).host; } catch { host = null; }
  }

  return jsonSuccess(isAdmin ? { configured, host } : { configured });
}
