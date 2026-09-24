// /api/forms/[id]/submissions: the one-release alias of /api/forms/[id]/responses.
//
// The route family was renamed in one change (naming canon: Response). This
// path stays mounted for ONE release so an integration or an old tab keeps
// working. It answers IN PLACE by calling the new handlers, rather than
// redirecting: a Location built from req.url can come out as http:// or as the
// internal host behind the TLS-terminating nginx, and an http-to-https 301 hop
// turns a POST into a GET, which would lose the answers.
//
//   POST  exactly the new submit path (same checks, same 201 body).
//   GET   the old shape: a bare array of responses, newest first, up to 500
//         (the old unpaged route's take: 500). The new route pages them as
//         { data, nextCursor } with a default page of 50, so this alias asks
//         it for limit=500 explicitly; an old caller gets what it always got.
//
// Delete this file (and its mention in scripts/MIGRATIONS.md) in the release
// after Phase 5 ships.

import { NextRequest, NextResponse } from "next/server";
import { GET as responsesGET, POST as responsesPOST } from "../responses/route";

type Ctx = { params: Promise<{ id: string }> };

/** The old route's row count (HEAD submissions/route.ts: take 500). */
const LEGACY_TAKE = "500";

export async function GET(req: NextRequest, ctx: Ctx) {
  const url = new URL(req.url);
  url.searchParams.set("limit", LEGACY_TAKE);
  url.searchParams.delete("cursor");
  const res = await responsesGET(new NextRequest(url, { headers: req.headers }), ctx);
  if (!res.ok) return res;
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  return NextResponse.json(Array.isArray(body?.data) ? body.data : [], { status: res.status });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return responsesPOST(req, ctx);
}
