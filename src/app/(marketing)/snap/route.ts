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
//
// A RELATIVE Location. Behind nginx, request.url is the upstream address the
// proxy called (http://localhost:3002/snap), so an absolute URL built from it
// sent every shared workwrk.com/snap link to localhost, which does not load.
// "/tuesday" is resolved by the browser against the address it asked for, so
// it is right on the marketing host, the app host and a local server alike.
// NextResponse.redirect() only takes an absolute URL, hence the plain response.

import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return new NextResponse(null, { status: 301, headers: { Location: "/tuesday" } });
}
