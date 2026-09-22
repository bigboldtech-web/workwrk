// /signup: the marketing site's primary CTA target. The sign-up form is at
// /register; this is the door every "Start free" button on the marketing site
// knocks on (src/components/marketing/config.ts `routes.signup`).
//
// A belt-and-braces twin of the `next.config.ts` redirect row, same reasoning
// as (dashboard)/today/route.ts: the config table is read once at server start,
// so a config-only redirect is unverifiable until the next restart and is
// silently absent on any process that predates the edit. This file is in the
// module graph, so it answers under hot reload and can be curled on the spot.
//
// It is a route handler and not a page because a redirect inside a streaming
// page renders the shell first and emits the hop as a client meta tag: a blank
// frame, a 200, and no Location header.
//
// It does NOT use `redirect("/register")`, which would drop the querystring.
// The CTA helpers append ?utm_content= to every button and ?template=tuesday to
// the template deep link, so the query IS the payload here: cloning nextUrl and
// swapping only the pathname carries it through to /register unchanged.
//
// 307 and not 308, per the config row: /signup has to stay reclaimable as a
// real page, and a 308 in a browser cache cannot be withdrawn.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/register";
  return NextResponse.redirect(url, 307);
}
