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
 * A connector somebody asked for by name (Request a connector) is a row too,
 * category Other, so the requester can see and withdraw it (see
 * customConnectorRows below).
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
  const query = {
    q: sp.get("q"),
    category: sp.get("category"),
    status: sp.get("status"),
    showUpcoming: sp.get("upcoming") === "1",
    availability: { "google-calendar": isGoogleEnabled() },
  };
  const list = filterConnectors(query, requested);

  // "Request a connector" free text lives under a custom:* key that the
  // registry never lists, so the person who sent it could not see it on the
  // page, nor withdraw it. Each such key the org holds becomes one row here:
  // not built, category Other, requestable and withdrawable through the
  // same footer control as a catalogue card. It answers the page's filters
  // the way a catalogue row does (a category filter hides it, since it has
  // none; Ready hides it; Requested and All show it).
  const customKeys = [...counts.keys()].filter((k) => k.startsWith("custom:"));
  const customRows = customKeys.length && query.status !== "ready" && !query.category
    ? await customConnectorRows(viewer.organizationId, customKeys, query.q)
    : [];

  return jsonSuccess({
    connectors: [
      ...list.map((c) => ({
        key: c.key,
        name: c.name,
        category: c.category as string,
        blurb: c.blurb,
        status: c.kind,
        setupHref: c.setup?.href ?? null,
        canSetUp: c.kind === "ready" ? (c.setup?.by === "member" ? true : admin) : false,
        requestCount: counts.get(c.key) ?? 0,
        requestedByMe: mine.has(c.key),
      })),
      ...customRows.map((r) => ({
        key: r.key,
        name: r.name,
        category: "Other",
        blurb: "Not in the catalogue yet. Asked for by people here.",
        status: "not_built" as const,
        setupHref: null,
        canSetUp: false,
        requestCount: counts.get(r.key) ?? 0,
        requestedByMe: mine.has(r.key),
      })),
    ],
    canConnect: admin,
  });
}

/**
 * The custom:* keys as rows, named as the first person typed them. The name
 * column is read through raw SQL (the schema comment on
 * IntegrationRequest.name says why); a database without it, or the dev
 * server's split client, answers no names and the slug is humanized
 * ("custom:hub-spot" reads "Hub Spot"). The same two helpers live in
 * requests/route.ts: a route file cannot export them and no shared module
 * owns them yet.
 */
async function customConnectorRows(organizationId: string, keys: string[], q: string | null): Promise<{ key: string; name: string }[]> {
  const names = new Map<string, string>();
  try {
    const rows = await prisma.$queryRaw<{ key: string; name: string | null }[]>`SELECT "key", "name" FROM "IntegrationRequest" WHERE "organizationId" = ${organizationId} AND "key" LIKE ${"custom:%"} AND "name" IS NOT NULL ORDER BY "createdAt" ASC`;
    for (const r of rows) if (r.name && !names.has(r.key)) names.set(r.key, r.name);
  } catch {
    // column absent
  }
  const humanize = (key: string) =>
    key.replace(/^custom:/, "").split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const needle = (q ?? "").trim().toLowerCase();
  return keys
    .map((key) => ({ key, name: names.get(key) ?? humanize(key) }))
    .filter((r) => !needle || `${r.name} other`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
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
