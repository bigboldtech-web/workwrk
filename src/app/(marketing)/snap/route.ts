// /snap redirects to /tuesday (decision 14: "/tuesday is the share route and
// /snap 301s to it").
//
// Two names for one story is one of them going stale, so the story has one
// address and the other one points at it.
//
// A ROUTE HANDLER, AND A LITERAL 301. This was a page calling
// `permanentRedirect`, which answers 308. Both are permanent and both are
// read as a canonical move by every crawler, so nothing was broken, but the
// decision names 301 and a handler can emit exactly that without touching
// next.config.ts, which is a shared file this unit does not own. The
// redirect still lives beside the page it points at, so nobody can separate
// the two by editing something else.
//
// GET only. There is nothing to POST to a share URL, and 301 is the code
// whose method-rewriting behaviour is the reason 308 exists; with no other
// method handled, that distinction cannot bite.

import { NextResponse } from "next/server";

export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/tuesday", request.url), 301);
}
