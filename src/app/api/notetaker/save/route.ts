// POST /api/notetaker/save
//
// Persists an extracted meeting + its attendees + action items. Called
// after the user reviews + (optionally) edits the extraction in the UI.
//
// Resolution rules:
//   - Attendees: matched by email against org users → MeetingAttendee
//     rows. Unmatched go into Meeting.notes as a "(could not match)"
//     suffix so they're not lost.
//   - Action items: assigneeEmail > assigneeName fuzzy match against
//     org users. Falls back to the calling user. ActionItem.assigneeId
//     is required (non-null), so we always need someone.
//   - Optionally creates an ITEM (the ClickUp-chassis task) for each
//     ActionItem (toggle from client). With `listId` the Items land in that
//     List, through the same createBoardItem path POST /api/boards/[id]/items
//     uses, after the same Can-edit check; without it they land on each
//     assignee's Personal list. Never the legacy Task table (critic #3).
//   - Action items and attendees are the EDITED values the person saved,
//     including owners chosen in the picker (assigneeId wins over the name).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createPersonalTask } from "@/lib/work/personal-task";
import { canContributeBoard, getBoardForReader } from "@/lib/board";
import { createBoardItem } from "@/lib/board-items";
import { getBoardStatuses } from "@/lib/board-items-shared";

const ALLOWED_TYPES = ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"] as const;

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(ALLOWED_TYPES).optional(),
  summary: z.string().max(8000).optional(),
  decisions: z.array(z.string()).optional(),
  attendees: z.array(z.object({
    name: z.string().max(160),
    email: z.string().email().nullable().optional(),
    /** A directory match the person confirmed in the picker. */
    userId: z.string().max(64).nullable().optional(),
  })).optional(),
  actionItems: z.array(z.object({
    title: z.string().min(1).max(200),
    assigneeName: z.string().max(160).optional(),
    assigneeEmail: z.string().email().nullable().optional(),
    /** The owner chosen in the picker; wins over the name and email. */
    assigneeId: z.string().max(64).nullable().optional(),
    deadlineDays: z.number().int().min(0).max(365).nullable().optional(),
    /** An explicit due date (ISO), from the date picker; wins over deadlineDays. */
    dueAt: z.string().datetime().nullable().optional(),
  })).optional(),
  /** The List the action items become tasks in. Needs Can edit on it. */
  listId: z.string().max(64).nullable().optional(),
  scheduledAt: z.string().optional(),       // ISO; defaults to now
  duration: z.number().int().min(1).max(720).optional(),
  spawnTasks: z.boolean().optional(),
  transcript: z.string().max(120000).optional(), // optional, stored in notes
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "no organization" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });

  // Helper: resolve a User in this org by email (preferred) or name
  // (case-insensitive contains on firstName / lastName / email).
  async function resolveUserId(name?: string, email?: string | null, chosenId?: string | null): Promise<{ userId: string; matched: boolean }> {
    if (chosenId) {
      const u = await prisma.user.findFirst({
        where: { id: chosenId, organizationId: user!.organizationId },
        select: { id: true },
      });
      if (u) return { userId: u.id, matched: true };
    }
    if (email) {
      const u = await prisma.user.findFirst({
        where: { email, organizationId: user!.organizationId },
        select: { id: true },
      });
      if (u) return { userId: u.id, matched: true };
    }
    if (name) {
      const u = await prisma.user.findFirst({
        where: {
          organizationId: user!.organizationId,
          OR: [
            { firstName: { contains: name.split(" ")[0] ?? name, mode: "insensitive" } },
            { lastName: { contains: name.split(" ").slice(-1)[0] ?? name, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (u) return { userId: u.id, matched: true };
    }
    return { userId: user!.id, matched: false };
  }

  // 1. Resolve attendees + build unmatched list for the notes footer.
  const matchedAttendees: { userId: string }[] = [];
  const unmatchedAttendeeLabels: string[] = [];
  for (const a of parsed.data.attendees ?? []) {
    if (a.userId) {
      const u = await prisma.user.findFirst({
        where: { id: a.userId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (u) {
        matchedAttendees.push({ userId: u.id });
        continue;
      }
    }
    if (a.email) {
      const u = await prisma.user.findFirst({
        where: { email: a.email, organizationId: user.organizationId },
        select: { id: true },
      });
      if (u) {
        matchedAttendees.push({ userId: u.id });
        continue;
      }
    }
    if (a.name) {
      const u = await prisma.user.findFirst({
        where: {
          organizationId: user.organizationId,
          OR: [
            { firstName: { contains: a.name.split(" ")[0] ?? a.name, mode: "insensitive" } },
            { lastName: { contains: a.name.split(" ").slice(-1)[0] ?? a.name, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (u) {
        matchedAttendees.push({ userId: u.id });
        continue;
      }
    }
    unmatchedAttendeeLabels.push(a.name + (a.email ? ` <${a.email}>` : ""));
  }
  // Dedupe — same user can show up twice if the model overshares
  const uniqueMatched = Array.from(new Map(matchedAttendees.map((m) => [m.userId, m])).values());

  // 2. Compose notes — summary + decisions + transcript + unmatched attendees
  const notesParts: string[] = [];
  if (parsed.data.summary) notesParts.push(parsed.data.summary);
  if (unmatchedAttendeeLabels.length > 0) notesParts.push(`\nAttendees not matched to users: ${unmatchedAttendeeLabels.join(", ")}`);
  if (parsed.data.transcript) notesParts.push(`\n\n--- TRANSCRIPT ---\n${parsed.data.transcript}`);
  const notes = notesParts.join("\n").slice(0, 30000) || null;

  const decisionsStr = (parsed.data.decisions ?? []).length > 0
    ? (parsed.data.decisions ?? []).map((d) => `• ${d}`).join("\n")
    : null;

  // 2b. The destination List, checked BEFORE anything is written so a List
  // shared away between opening the page and saving refuses the whole save
  // with the one denial toast, rather than writing a meeting whose tasks then
  // vanish (spec-docs-knowledge section 2, /notetaker: "re-checks can(viewer,
  // create_child, list)"; canContributeBoard is that check's delegate today).
  let listBoard: { id: string; statuses?: unknown } | null = null;
  if (parsed.data.spawnTasks && parsed.data.listId) {
    const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
    const board = await getBoardForReader(parsed.data.listId, user.id, accessLevel);
    if (!board) return NextResponse.json({ error: "That list no longer exists" }, { status: 404 });
    if (!(await canContributeBoard(parsed.data.listId, user.id, accessLevel))) {
      return NextResponse.json({ error: "You need Can edit on that list. Ask its owner." }, { status: 403 });
    }
    listBoard = board as { id: string; statuses?: unknown };
  }

  // 3. Persist meeting
  const meeting = await prisma.meeting.create({
    data: {
      organizationId: user.organizationId,
      title: parsed.data.title,
      type: parsed.data.type ?? "ADHOC",
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date(),
      duration: parsed.data.duration ?? 30,
      notes,
      decisions: decisionsStr,
    },
    select: { id: true, title: true, scheduledAt: true },
  });

  // 4. Attendees
  if (uniqueMatched.length > 0) {
    await prisma.meetingAttendee.createMany({
      data: uniqueMatched.map((m) => ({ meetingId: meeting.id, userId: m.userId, attended: true })),
      skipDuplicates: true,
    });
  }

  // 5. Action items + optional Tasks
  const createdActionItems: { id: string; title: string; assigneeId: string }[] = [];
  const createdItems: { id: string; boardId: string }[] = [];
  let tasksSpawned = 0;
  for (const ai of parsed.data.actionItems ?? []) {
    const { userId: assigneeId } = await resolveUserId(ai.assigneeName, ai.assigneeEmail, ai.assigneeId);
    const deadline = ai.dueAt
      ? new Date(ai.dueAt)
      : ai.deadlineDays != null
        ? new Date(Date.now() + ai.deadlineDays * 86400000)
        : null;
    const created = await prisma.actionItem.create({
      data: {
        meetingId: meeting.id,
        title: ai.title,
        assigneeId,
        deadline,
      },
      select: { id: true, title: true, assigneeId: true },
    });
    createdActionItems.push(created);

    if (parsed.data.spawnTasks && listBoard) {
      // The chosen List: the same code path as POST /api/boards/[id]/items,
      // opening in the List's own first active status. A failure must not lose
      // the action items already written, so it is caught and counted.
      const statuses = getBoardStatuses(listBoard);
      const opening = statuses.length > 0 ? (statuses.find((st) => st.group === "ACTIVE") ?? statuses[0]).value : undefined;
      const spawned = await createBoardItem({
        organizationId: user.organizationId,
        boardId: listBoard.id,
        title: ai.title.slice(0, 280),
        status: opening,
        ownerId: assigneeId,
        assigneeIds: [assigneeId],
        dueAt: deadline,
        priority: "NORMAL",
        metadata: { description: `From meeting: ${meeting.title}`, legacyTask: { source: "MEETING", sourceRef: meeting.id } },
        actorId: user.id,
      }).catch(() => null);
      if (spawned) { tasksSpawned++; createdItems.push({ id: spawned.id, boardId: listBoard.id }); }
    } else if (parsed.data.spawnTasks) {
      // Phase 2 W4. This wrote the legacy `Task` table, whose UI is deleted in
      // this release, so "+ N tasks spawned" named work nobody could open. The
      // task lands on the assignee's Personal list now, which is what /my-work
      // reads. A failure here must not lose the action items already written
      // above, so it is caught and reflected in the count the caller is shown.
      const spawned = await createPersonalTask({
        organizationId: user.organizationId,
        assigneeId,
        title: ai.title,
        description: `From meeting: ${meeting.title}`,
        priority: "NORMAL",
        dueAt: deadline ?? new Date(),
        legacy: { source: "MEETING", sourceRef: meeting.id },
        actorId: user.id,
      }).catch(() => null);
      if (spawned) { tasksSpawned++; createdItems.push({ id: spawned.id, boardId: spawned.boardId }); }
    }
  }

  return NextResponse.json({
    ok: true,
    meeting,
    items: createdItems,
    counts: {
      attendees: uniqueMatched.length,
      attendeesUnmatched: unmatchedAttendeeLabels.length,
      decisions: (parsed.data.decisions ?? []).length,
      actionItems: createdActionItems.length,
      tasksSpawned,
    },
  });
}
