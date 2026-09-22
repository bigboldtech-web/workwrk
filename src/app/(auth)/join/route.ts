// /join: the marketing site's secondary CTA target, for someone arriving on an
// invitation rather than starting their own workspace
// (src/components/marketing/config.ts `routes.join`).
//
// It lands on the same form as /signup. /register is both flows already: with a
// ?token it fetches the invitation and renders "Join <org>", without one it
// creates a new organization. So the querystring decides which arm answers,
// which is exactly why this hands the query through untouched rather than
// calling `redirect("/register")`.
//
// See (auth)/signup/route.ts for why this is a route handler, why it is a twin
// of the next.config row, and why the hop is a 307.

import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/register";
  return NextResponse.redirect(url, 307);
}
