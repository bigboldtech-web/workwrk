// POST   /api/integrations/requests { key, note?, notify? }  "Request this"
// DELETE /api/integrations/requests?key=                      undo (the toast)
// GET    /api/integrations/requests                           Owner and Admin:
//        the totals per connector, most asked first, with who asked and
//        what they wrote, for Settings > Apps & modules
//
// Every Member may ask (app key integrations). One row per person per
// connector (unique on organizationId, key, userId), so asking twice is one
// request and the card's count is a count of people. A release deployed
// before the table exists answers a named 503.

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isOwnerOrAdmin, requireApp } from "@/lib/app-gate";
import { CONNECTOR_BY_KEY, CONNECTORS, isRequestableConnector } from "@/lib/integrations/registry";

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

const CUSTOM_PREFIX = "custom:";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * What a request body's `key` means. Three shapes arrive here:
 *   a catalogue key ("slack")   from the card's Request this
 *   a stored custom key         from Request this on a custom row the
 *                               catalogue now lists (custom:hub-spot);
 *                               re-slugging it would have made a second key,
 *                               custom:custom-hub-spot, and split the count
 *   free text ("HubSpot")       from Request a connector; kept as the row's
 *                               `name`, grouped under its slug
 * Free text that names a catalogue connector ("slack", "Slack ") lands on
 * that connector's key, so two people asking for the same thing through two
 * doors are one count, and asking for a ready one gets the same answer the
 * card would give.
 */
function resolveRequestKey(raw: string): { key: string; name: string | null } {
  const typed = raw.trim().replace(/\s+/g, " ");
  if (CONNECTOR_BY_KEY[typed]) return { key: typed, name: null };
  const byName = CONNECTORS.find((c) => c.name.toLowerCase() === typed.toLowerCase());
  if (byName) return { key: byName.key, name: null };
  if (typed.startsWith(CUSTOM_PREFIX)) {
    const rest = typed.slice(CUSTOM_PREFIX.length);
    if (rest && slugify(rest) === rest) return { key: typed, name: null };
  }
  return { key: `${CUSTOM_PREFIX}${slugify(typed)}`, name: typed };
}

/** "custom:walk-addons-connector" reads "Walk Addons Connector" when no typed name survived. */
function humanizeCustomKey(key: string): string {
  return key
    .replace(/^custom:/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function POST(req: Request) {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { key, note, notify } = parsed.data;
  const resolved = resolveRequestKey(key);
  const known = CONNECTOR_BY_KEY[resolved.key];
  if (known && !isRequestableConnector(resolved.key)) {
    return NextResponse.json({ error: `${known.name} is ready to set up. No request is needed.` }, { status: 400 });
  }
  const slug = resolved.key;
  if (slug === CUSTOM_PREFIX) return NextResponse.json({ error: "Name the connector" }, { status: 400 });
  const { viewer } = gate;
  try {
    await prisma.integrationRequest.upsert({
      where: { organizationId_key_userId: { organizationId: viewer.organizationId, key: slug, userId: viewer.userId } },
      create: { organizationId: viewer.organizationId, key: slug, userId: viewer.userId, note: note || null, notify: notify ?? false },
      update: { ...(note ? { note } : {}), ...(notify !== undefined ? { notify } : {}) },
    });
    if (resolved.name) {
      // The typed name, through raw SQL: the generated client predates the
      // column (see the schema comment) and a database without it must not
      // fail the request, only forget the spelling.
      try {
        await prisma.$executeRaw`UPDATE "IntegrationRequest" SET "name" = ${resolved.name} WHERE "organizationId" = ${viewer.organizationId} AND "key" = ${slug} AND "userId" = ${viewer.userId}`;
      } catch {
        // column absent: the slug is humanized on read
      }
    }
    const count = await prisma.integrationRequest.count({ where: { organizationId: viewer.organizationId, key: slug } });
    return NextResponse.json({ key: slug, name: known?.name ?? resolved.name ?? humanizeCustomKey(slug), requestCount: count, requestedByMe: true });
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

/**
 * The typed name per custom key in one org, earliest row first so the name
 * does not flip when a second person asks with different capitals. Raw SQL
 * for the reason in the schema comment; a database without the column (or
 * the dev server's split client) answers an empty map, and the reader
 * humanizes the slug instead.
 */
async function customNames(organizationId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const rows = await prisma.$queryRaw<{ key: string; name: string | null }[]>`SELECT "key", "name" FROM "IntegrationRequest" WHERE "organizationId" = ${organizationId} AND "key" LIKE ${`${CUSTOM_PREFIX}%`} AND "name" IS NOT NULL ORDER BY "createdAt" ASC`;
    for (const r of rows) if (r.name && !names.has(r.key)) names.set(r.key, r.name);
  } catch {
    // column absent
  }
  return names;
}

export async function GET() {
  const gate = await requireApp("integrations");
  if ("error" in gate) return gate.error;
  if (!isOwnerOrAdmin(gate.viewer)) return NextResponse.json({ error: "Only workspace Owners and Admins can see request totals." }, { status: 403 });
  const organizationId = gate.viewer.organizationId;
  try {
    const [grouped, rows, names] = await Promise.all([
      prisma.integrationRequest.groupBy({
        by: ["key"],
        where: { organizationId },
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _count: { key: "desc" } },
      }),
      prisma.integrationRequest.findMany({
        where: { organizationId },
        select: { key: true, userId: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      customNames(organizationId),
    ]);
    // Who asked, by name. userId carries no relation (offboarding must not
    // erase demand), so a person who has left reads as "Someone who left".
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const askedBy = new Map<string, { name: string; note: string | null; at: Date }[]>();
    for (const r of rows) {
      const list = askedBy.get(r.key) ?? [];
      if (list.length < 10) list.push({ name: userName.get(r.userId) ?? "Someone who left", note: r.note, at: r.createdAt });
      askedBy.set(r.key, list);
    }
    return NextResponse.json({
      totals: grouped.map((g) => ({
        key: g.key,
        name: CONNECTOR_BY_KEY[g.key]?.name ?? names.get(g.key) ?? humanizeCustomKey(g.key),
        // Free text is not in the catalogue: Settings says so, since nobody
        // can look it up on /integrations by category.
        custom: !CONNECTOR_BY_KEY[g.key],
        count: g._count._all,
        lastAt: g._max.createdAt,
        askedBy: askedBy.get(g.key) ?? [],
      })),
      total: rows.length,
    });
  } catch (e) {
    if (tableMissing(e)) return NextResponse.json({ totals: [], total: 0 });
    throw e;
  }
}
