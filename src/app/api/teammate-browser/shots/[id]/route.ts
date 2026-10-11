// GET /api/teammate-browser/shots/[id]
//
// A picture of a page, for its person alone (docs/plans/ai-teammates-phase4.md
// Decisions 16 and 23): opened from its sealed file (browser/shots.ts
// readShot), only for the signed-in person whose browser took it, in their
// workspace, before its 24 hours are up. Anyone else's, an Owner's included,
// an expired one and one that is gone are all 404. Never cached anywhere.

import { viewerFromSession } from "@/lib/access/viewer";
import { BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { teammateError } from "@/lib/agents/teammate-server";
import { readShot } from "@/lib/browser/shots";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const viewer = await viewerFromSession();
  if (!viewer) return teammateError(401, "signed_out", BROWSER_ROUTE_ERRORS.signedOut);
  const jpeg = await readShot((await params).id, viewer);
  if (!jpeg) return teammateError(404, "not_found", BROWSER_ROUTE_ERRORS.notFound);
  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
