// Space bookmarks — a team's shared shelf of links for a Space. Stored in
// Space.settings.bookmarks (JSON, no migration). The client unfurls a pasted
// URL via /api/link-preview first, then POSTs the resolved {url,title,favicon}
// here to persist. Read access = any Space reader; add/remove = canEditSpace.
//
//   POST   { url, title?, favicon? }  → add, returns { bookmark, bookmarks }
//   DELETE { bookmarkId }             → remove, returns { bookmarks }

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canEditSpace, getSpaceForReader, mutateSpaceSettings } from "@/lib/space";

const MAX_BOOKMARKS = 50;

export interface SpaceBookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  addedById: string;
  addedAt: string;
}

async function ctx() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

/** The bookmarks array off a Space.settings JSON, tolerant of any shape. */
function readBookmarks(settings: unknown): SpaceBookmark[] {
  if (!settings || typeof settings !== "object") return [];
  const raw = (settings as Record<string, unknown>).bookmarks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is SpaceBookmark =>
      !!b && typeof b === "object" && typeof (b as SpaceBookmark).id === "string" && typeof (b as SpaceBookmark).url === "string",
  );
}

/** Only http(s) links; blocks javascript:/data: and other schemes. */
function normalizeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditSpace(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to add bookmarks here." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const url = normalizeUrl(body?.url);
  if (!url) return NextResponse.json({ error: "Enter a valid web link." }, { status: 400 });

  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : new URL(url).hostname;
  const favicon = typeof body?.favicon === "string" && /^https?:\/\//i.test(body.favicon) ? body.favicon.slice(0, 500) : null;

  const bookmark: SpaceBookmark = {
    id: crypto.randomUUID(),
    url,
    title,
    favicon,
    addedById: c.userId,
    addedAt: new Date().toISOString(),
  };
  // The list is read and written under the Space row's lock. Reading it from
  // the gate's copy and writing it back wholesale lost a bookmark whenever two
  // people added one at once, and wiped any other settings key (a pin, a
  // module toggle) saved in between.
  const r = await mutateSpaceSettings(id, (locked) => {
    const bookmarks = readBookmarks(locked);
    if (bookmarks.length >= MAX_BOOKMARKS) return { patch: null, result: null };
    const next = [bookmark, ...bookmarks];
    return { patch: { bookmarks: next }, result: next };
  });
  if (!r.found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!r.result) {
    return NextResponse.json({ error: `A Space can hold up to ${MAX_BOOKMARKS} bookmarks.` }, { status: 400 });
  }
  return NextResponse.json({ bookmark, bookmarks: r.result });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const space = await getSpaceForReader(id, c.userId, c.accessLevel);
  if (!space || space.organizationId !== c.organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canEditSpace(id, c.userId, c.accessLevel))) {
    return NextResponse.json({ error: "You don't have permission to remove bookmarks here." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const bookmarkId = typeof body?.bookmarkId === "string" ? body.bookmarkId : null;
  if (!bookmarkId) return NextResponse.json({ error: "Missing bookmarkId" }, { status: 400 });

  const r = await mutateSpaceSettings(id, (locked) => {
    const next = readBookmarks(locked).filter((b) => b.id !== bookmarkId);
    return { patch: { bookmarks: next }, result: next };
  });
  if (!r.found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ bookmarks: r.result });
}
