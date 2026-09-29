// RETIRED (spec-account-auth `/onboard` Data, A3). GET/POST /api/setup was
// the old wizards' one write: it rewrote the org's setup keys, installed
// modules, synced (and deleted) departments and minted invitations, checking
// only for a session. Every one of those writes now goes through its own
// gated route, which the one wizard at /onboard calls:
//   workspace name       PATCH /api/settings { section: "general" }
//   mission              PATCH /api/settings { section: "culture" }
//   logo                 POST /api/settings/logo
//   invitations          POST /api/invitations (the level rule, the domain lock)
//   departments          POST /api/departments, DELETE /api/departments/[id]
//                        (per change, never a wholesale replace)
//   Talk and Tables      POST/DELETE /api/products/installations
//   progress             PATCH /api/settings { section: "console" }
// The businessType, industry and teamSize values it stored are kept on the
// org and stay editable on Workspace settings > Identity & culture.
// Both verbs answer 410 Gone and change nothing.
import { NextResponse } from "next/server";

const GONE = {
  error: "This endpoint is retired. Set up a workspace at /onboard.",
  code: "retired",
};

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}
