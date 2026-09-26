// Any /api path no route owns answers a JSON 404.
//
// Without this, an unknown API path fell through to the dashboard's
// unknown-path page ((dashboard)/[...rest]) and answered 200 with the HTML
// of the in-shell 404, so an old client calling a removed route (the retired
// /api/autopilot/* for one) read success. Next resolves a catch-all last, so
// this can never shadow a real route.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
