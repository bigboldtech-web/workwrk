// PATCH / DELETE /api/calendar/events/[id] - edit or remove ONE personal
// calendar entry.
//
// spec-planner.md section 2 `/planner`, the Event popover: each field
// autosaves through PATCH, and Delete is a destructive ghost with an inline
// confirm.
//
// OWNER ONLY, AND THE MISS IS A 404. `findFirst({ id, userId })` and then a
// 404 when it answers nothing: a 403 would confirm that an event with that
// id exists and belongs to somebody, which is a leak on a table whose whole
// point is that the rows are private. There is no Admin read-around: an
// Admin looking at a team calendar sees "Busy", which is all the calendar
// read sends them.
//
// A GOOGLE ROW IS NOT EDITABLE HERE. `externalSource` is set on a row the
// sync cron owns; the next sync would overwrite any edit, so the edit is
// refused with the sentence that says why rather than accepted and lost. The
// same row can be DELETED, because removing it locally is a real thing to
// want and the sync's own reconciliation brings it back only if it still
// exists in Google.
//
// The table may be absent for a release (the SQL file is deploy-order free),
// so every query is wrapped and answers the one honest sentence.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { normaliseEventKind, resolveEventEnd, resolveEventTitle } from "@/lib/calendar-event";

const NOT_SET_UP =
  "Events are not set up on this workspace yet. Ask an admin to finish the calendar setup.";

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function readOwn(id: string, userId: string) {
  return prisma.calendarEvent.findFirst({
    where: { id, userId },
    select: {
      id: true, title: true, kind: true, startAt: true, endAt: true,
      allDay: true, description: true, externalSource: true,
    },
  });
}

/**
 * GET - the one row, for the Event popover's Description field.
 *
 * The grid feed deliberately does NOT carry descriptions: it is a range read
 * and a paragraph per block would be most of the payload for text nothing on
 * the grid draws. So the popover reads the row it is about, which is also
 * what let the description stop being write-only (the New event modal has
 * always saved one and no surface in the unit ever read it back).
 *
 * Same ownership rule as the two writes below: a miss is a 404, never a 403.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const event = await readOwn(id, u.id);
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ event });
  } catch {
    return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send a JSON body" }, { status: 400 });
  }

  let existing: Awaited<ReturnType<typeof readOwn>>;
  try {
    existing = await readOwn(id, u.id);
  } catch {
    return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
  }
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.externalSource) {
    return NextResponse.json(
      { error: "This event comes from Google Calendar. Edit it there and it updates here." },
      { status: 409 },
    );
  }

  // Only what was SENT is written. A popover autosaving one field must not
  // silently reset the other five to whatever the client last rendered.
  const data: Record<string, unknown> = {};
  const kind = "kind" in body ? normaliseEventKind(body.kind) : normaliseEventKind(existing.kind);
  if ("kind" in body) data.kind = kind;
  if ("title" in body) data.title = resolveEventTitle(body.title, kind);
  if ("description" in body) {
    data.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 5000)
        : null;
  }

  const allDay = "allDay" in body ? body.allDay === true : existing.allDay;
  if ("allDay" in body) data.allDay = allDay;

  const nextStart = "startAt" in body ? parseDate(body.startAt) : existing.startAt;
  if ("startAt" in body && !nextStart) {
    return NextResponse.json({ error: "startAt must be a date" }, { status: 400 });
  }
  const sentEnd = "endAt" in body ? parseDate(body.endAt) : null;
  if ("startAt" in body || "endAt" in body || "allDay" in body) {
    const start = nextStart ?? existing.startAt;
    data.startAt = start;
    // The move gesture on the grid sends both ends, so the previous end is
    // only a fallback for the popover's single-field saves.
    data.endAt = resolveEventEnd(start, sentEnd ?? ("endAt" in body ? null : existing.endAt), allDay);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ event: existing });
  }

  try {
    const event = await prisma.calendarEvent.update({
      where: { id },
      data,
      select: { id: true, title: true, kind: true, startAt: true, endAt: true, allDay: true, description: true },
    });
    return NextResponse.json({ event });
  } catch {
    return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existing = await readOwn(id, u.id);
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.calendarEvent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: NOT_SET_UP }, { status: 503 });
  }
}
