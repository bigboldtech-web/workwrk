// /register: the old name for both sign-up flows (spec-account-auth
// section 0). /register?token=X 308s to /join?token=X (an invitation email
// already in someone's inbox keeps working) and bare /register 308s to
// /signup; the rest of the query rides along either way.
//
// Twin of the two next.config.ts rows, which answer in production before
// routing; this answers under hot reload. A route handler, not a page, so
// the hop is a real 308 with a Location header, never a painted frame.

import { NextResponse, type NextRequest } from "next/server";
import { registerTarget } from "@/lib/nav/auth-redirects";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL(registerTarget(request.nextUrl.searchParams), request.nextUrl.origin), 308);
}
