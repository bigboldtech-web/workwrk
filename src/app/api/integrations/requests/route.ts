// POST   /api/integrations/requests { key, note?, notify? }  "Request this"
// DELETE /api/integrations/requests?key=                      undo (the toast)
// GET    /api/integrations/requests                           Owner and Admin:
//        the totals per connector, newest request first, for Settings > Apps
//
// Every Member may ask (app key integrations). One row per person per
// connector (unique on organizationId, key, userId), so asking twice is one
// request and the card's count is a count of people. A release deployed
// before the table exists answers a named 503.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { CONNECTOR_BY_KEY, isRequestableConnector } from "@/lib/integrations/registry";

const bodySchema = z.object({
  key: z.string().min(1).max(80),
  note: z.string().trim().max(2000).optional(),
  // Stored for a later "tell me when it exists" mail. Nothing sends that mail
  // yet, so the dialogs no longer offer the switch and the default is false:
  // no row claims an opt-in the person was never asked for.
  notify: z.boolean().optional(),
});

function tableMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist|42P01|P2021/.test(msg);
}

const NOT_READY = () => NextResponse.json({ error: "Requests are not available yet. Try again after the update." }, { status: 503 });

export async function POST(req: Request) {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { key, note, notify } = parsed.data;
  // A free-text "Request a connector" names something not in the catalogue:
  // it is stored under a slug of its name, so the demand is still counted.
  const known = CONNECTOR_BY_KEY[key];
  if (known && !isRequestableConnector(key)) {
    return NextResponse.json({ error: `${known.name} is ready to set up. No request is needed.` }, { status: 400 });
  }
  const slug = known ? key : `custom:${key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)}`;
  if (slug === "custom:") return NextResponse.json({ error: "Name the connector" }, { status: 400 });
  const { viewer } = gate;
  try {
    await prisma.integrationRequest.upsert({
      where: { organizationId_key_userId: { organizationId: viewer.organizationId, key: slug, userId: viewer.userId } },
      create: { organizationId: viewer.organizationId, key: slug, userId: viewer.userId, note: note || null, notify: notify ?? false },
      update: { ...(note ? { note } : {}), ...(notify !== undefined ? { notify } : {}) },
    });
    const count = await prisma.integrationRequest.count({ where: { organizationId: viewer.organizationId, key: slug } });
    return NextResponse.json({ key: slug, requestCount: count, requestedByMe: true });
  } catch (e) {
    if (tableMissing(e)) return NOT_READY();
    throw e;
  }
}

export async function DELETE(req: Request) {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const { viewer } = gate;
  try {
    await prisma.integrationRequest.deleteMany({ where: { organizationId: viewer.organizationId, key, userId: viewer.userId } });
    const count = await prisma.integrationRequest.count({ where: { organizationId: viewer.organizationId, key } });
    return NextResponse.json({ key, requestCount: count, requestedByMe: false });
  } catch (e) {
    if (tableMissing(e)) return NOT_READY();
    throw e;
  }
}

export async function GET() {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  if (!isOwnerOrAdmin(gate.viewer)) return NextResponse.json({ error: "Only workspace Owners and Admins can see request totals." }, { status: 403 });
  try {
    const grouped = await prisma.integrationRequest.groupBy({
      by: ["key"],
      where: { organizationId: gate.viewer.organizationId },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { key: "desc" } },
    });
    return NextResponse.json({
      totals: grouped.map((g) => ({ key: g.key, name: CONNECTOR_BY_KEY[g.key]?.name ?? g.key.replace(/^custom:/, ""), count: g._count._all, lastAt: g._max.createdAt })),
    });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ totals: [] });
    throw e;
  }
}
