// /welcome retired (spec-account-auth section 0): its three steps saved
// nothing (they posted to a GET-only route) and one asked for a job title,
// a placement field a person may not set for themself. It 308s to /onboard,
// the one wizard, which offers an invited member the way on to Work home.
// Twin of the next.config.ts row, which answers in production before
// routing; this answers under hot reload.
import { NextResponse, type NextRequest } from "next/server";
import { onboardTarget } from "@/lib/nav/auth-redirects";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL(onboardTarget(request.nextUrl.searchParams), request.nextUrl.origin), 308);
}
