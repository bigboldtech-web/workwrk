// /setup retired (spec-account-auth section 0): two wizards wrote one flag.
// /onboard is the survivor; this 308s there with the query. Twin of the
// next.config.ts row, which answers in production before routing.
import { NextResponse, type NextRequest } from "next/server";
import { onboardTarget } from "@/lib/nav/auth-redirects";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL(onboardTarget(request.nextUrl.searchParams), request.nextUrl.origin), 308);
}
