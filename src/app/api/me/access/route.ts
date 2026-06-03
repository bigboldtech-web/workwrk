// GET /api/me/access
//   ?resource=module:team/rollup
//   ?resource=space:ck123abc
//   ?resource=board:ck456def
//   ?resource=item:...
//   ?resource=user:...
//   ?resource=weekly-review:...
//   ?resource=kra:...
//
// Returns the central resolver's decision for the caller against the
// given resource. Useful for support ("why can't this person see X?")
// and for the future client-side `useAccess` hook. No body, no
// side effects — pure read.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAccess, type ModuleName, type ResourceRef } from "@/lib/access";

const MODULE_NAMES: ModuleName[] = [
  "today", "team/alignment", "team/reviews", "team/rollup", "org/admin",
  "spaces", "boards", "kra-kpi", "sops", "people", "settings/org",
];

function parseRef(raw: string | null): ResourceRef | null {
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx < 0) return null;
  const kind = raw.slice(0, idx);
  const rest = raw.slice(idx + 1);
  if (kind === "module") {
    if (!MODULE_NAMES.includes(rest as ModuleName)) return null;
    return { type: "module", name: rest as ModuleName };
  }
  if (kind === "space")          return { type: "space",         id: rest };
  if (kind === "board")          return { type: "board",         id: rest };
  if (kind === "item")           return { type: "item",          id: rest };
  if (kind === "user")           return { type: "user",          id: rest };
  if (kind === "weekly-review")  return { type: "weekly-review", id: rest };
  if (kind === "kra")            return { type: "kra",           id: rest };
  return null;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const ref = parseRef(url.searchParams.get("resource"));
  if (!ref) {
    return NextResponse.json(
      { error: "Pass ?resource=<kind>:<id> — kinds: module / space / board / item / user / weekly-review / kra" },
      { status: 400 },
    );
  }

  const decision = await resolveAccess(
    { userId: u.id, organizationId: u.organizationId, accessLevel: u.accessLevel ?? "EMPLOYEE" },
    ref,
  );
  return NextResponse.json({ resource: ref, decision });
}
