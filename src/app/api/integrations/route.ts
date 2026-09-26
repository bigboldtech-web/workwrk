import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { filterConnectors } from "@/lib/integrations/registry";
import { isGoogleEnabled } from "@/services/googleCalendar";

/**
 * GET /api/integrations: the connector catalogue (spec-tools-misc 2.6).
 *
 *   ?q=           name, category or sentence contains
 *   ?category=    one of the registry categories
 *   ?status=      ready | not_built | requested
 *   ?upcoming=1   include the rows behind Show upcoming features
 *   ?records=1    Owner and Admin: the org's legacy Integration rows, WITHOUT
 *                 their config (API keys never leave the server)
 *
 * { connectors: [{ key, name, category, blurb, status, setupHref, canSetUp,
 *   requestCount, requestedByMe }], canConnect }
 *
 * Every Member reads (app key integrations). The old body of this GET
 * returned every Integration row with its `config`, which holds API keys, to
 * any signed-in person, and had no caller in the app; that is gone.
 */
export async function GET(req: NextRequest) {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const sp = new URL(req.url).searchParams;
  const admin = isOwnerOrAdmin(viewer);

  if (sp.get("records") === "1") {
    if (!admin) return jsonError("Only workspace Owners and Admins can see connected records.", 403);
    const rows = await prisma.integration.findMany({
      where: { organizationId: viewer.organizationId },
      select: { id: true, name: true, type: true, status: true, lastSyncAt: true, createdAt: true, _count: { select: { syncLogs: true } } },
      orderBy: { createdAt: "desc" },
    });
    return jsonSuccess(rows);
  }

  // Demand, counted in people. A release deployed before the table exists
  // reads zero counts rather than failing (42P01).
  let counts = new Map<string, number>();
  let mine = new Set<string>();
  try {
    const [grouped, own] = await Promise.all([
      prisma.integrationRequest.groupBy({ by: ["key"], where: { organizationId: viewer.organizationId }, _count: { _all: true } }),
      prisma.integrationRequest.findMany({ where: { organizationId: viewer.organizationId, userId: viewer.userId }, select: { key: true } }),
    ]);
    counts = new Map(grouped.map((g) => [g.key, g._count._all]));
    mine = new Set(own.map((r) => r.key));
  } catch {
    // table absent: zero counts
  }

  const requested = new Set([...counts.keys()]);
  const list = filterConnectors(
    {
      q: sp.get("q"),
      category: sp.get("category"),
      status: sp.get("status"),
      showUpcoming: sp.get("upcoming") === "1",
      availability: { "google-calendar": isGoogleEnabled() },
    },
    requested,
  );

  return jsonSuccess({
    connectors: list.map((c) => ({
      key: c.key,
      name: c.name,
      category: c.category,
      blurb: c.blurb,
      status: c.kind,
      setupHref: c.setup?.href ?? null,
      canSetUp: c.kind === "ready" ? (c.setup?.by === "member" ? true : admin) : false,
      requestCount: counts.get(c.key) ?? 0,
      requestedByMe: mine.has(c.key),
    })),
    canConnect: admin,
  });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  if (!isManager(session)) {
    return jsonError("Insufficient permissions", 403);
  }

  const body = await req.json();
  const { name, type, config } = body;

  if (!name || !type) {
    return jsonError("Name and type are required");
  }

  const orgId = getOrgId(session);

  // Check if integration of this type already exists
  const existing = await prisma.integration.findUnique({
    where: { type_organizationId: { type, organizationId: orgId } },
  });

  if (existing) {
    // Update existing
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: { name, config: config || {}, status: "ACTIVE" },
    });
    return jsonSuccess(updated);
  }

  const integration = await prisma.integration.create({
    data: {
      name,
      type,
      config: config || {},
      status: "ACTIVE",
      organizationId: orgId,
    },
  });

  return jsonSuccess(integration, 201);
}
