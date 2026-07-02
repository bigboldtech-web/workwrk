// GET  /api/me/pins — hydrated top-pinned favorites (any kind) → chips
// POST /api/me/pins { kind, id, on } — toggle a top pin
//
// The "Top" destination of the ClickUp-style Favorite (space/folder/board/
// table/doc/whiteboard). Sidebar favorites stay in favorite<Kind>Ids.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePreferences, setUserPreference } from "@/lib/preferences";
import { prisma } from "@/lib/prisma";

type Pin = { kind: string; id: string };
type PinChip = { kind: string; id: string; label: string; href: string; icon: string | null; color: string | null };

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const pins: Pin[] = Array.isArray(effective?.home?.topPins) ? (effective.home!.topPins as Pin[]) : [];
  if (pins.length === 0) return NextResponse.json({ pins: [] });

  const orgId = u.organizationId;
  const ids = (k: string) => pins.filter((p) => p.kind === k).map((p) => p.id);

  const [spaces, boards, folders, tables, docs, whiteboards] = await Promise.all([
    ids("space").length ? prisma.space.findMany({ where: { organizationId: orgId, id: { in: ids("space") }, archivedAt: null }, select: { id: true, name: true, slug: true, icon: true, color: true } }) : Promise.resolve([]),
    ids("board").length ? prisma.board.findMany({ where: { organizationId: orgId, id: { in: ids("board") } }, select: { id: true, name: true, slug: true, icon: true, color: true } }) : Promise.resolve([]),
    ids("folder").length ? prisma.folder.findMany({ where: { organizationId: orgId, id: { in: ids("folder") } }, select: { id: true, name: true, icon: true, color: true, space: { select: { slug: true } } } }) : Promise.resolve([]),
    ids("table").length ? prisma.dataTable.findMany({ where: { organizationId: orgId, id: { in: ids("table") } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ids("doc").length ? prisma.doc.findMany({ where: { organizationId: orgId, id: { in: ids("doc") } }, select: { id: true, title: true } }) : Promise.resolve([]),
    ids("whiteboard").length ? prisma.whiteboard.findMany({ where: { organizationId: orgId, id: { in: ids("whiteboard") } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  const map = new Map<string, PinChip>();
  for (const s of spaces) map.set(`space:${s.id}`, { kind: "space", id: s.id, label: s.name, href: `/spaces/${s.slug ?? s.id}`, icon: s.icon, color: s.color });
  for (const b of boards) map.set(`board:${b.id}`, { kind: "board", id: b.id, label: b.name, href: `/boards/${b.slug ?? b.id}`, icon: b.icon, color: b.color });
  for (const f of folders) map.set(`folder:${f.id}`, { kind: "folder", id: f.id, label: f.name, href: f.space?.slug ? `/spaces/${f.space.slug}` : "#", icon: f.icon, color: f.color });
  for (const t of tables) map.set(`table:${t.id}`, { kind: "table", id: t.id, label: t.name, href: `/tables/${t.id}`, icon: null, color: null });
  for (const d of docs) map.set(`doc:${d.id}`, { kind: "doc", id: d.id, label: d.title || "Untitled doc", href: `/docs/${d.id}`, icon: null, color: null });
  for (const w of whiteboards) map.set(`whiteboard:${w.id}`, { kind: "whiteboard", id: w.id, label: w.name || "Whiteboard", href: `/whiteboards/${w.id}`, icon: null, color: null });

  // Keep pin order; drop any that no longer resolve.
  const chips = pins.map((p) => map.get(`${p.kind}:${p.id}`)).filter((c): c is PinChip => !!c);
  return NextResponse.json({ pins: chips });
}

const bodySchema = z.object({ kind: z.string().min(1), id: z.string().min(1), on: z.boolean() });

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const effective = await getEffectivePreferences(u.id, u.organizationId);
  const current: Pin[] = Array.isArray(effective?.home?.topPins) ? (effective.home!.topPins as Pin[]) : [];
  const filtered = current.filter((p) => !(p.kind === parsed.data.kind && p.id === parsed.data.id));
  const next = parsed.data.on ? [...filtered, { kind: parsed.data.kind, id: parsed.data.id }] : filtered;
  await setUserPreference(u.id, { home: { ...(effective?.home ?? {}), topPins: next } });
  return NextResponse.json({ topPins: next });
}
