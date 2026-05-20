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
//   - Optionally spawns a Task for each ActionItem (toggle from client).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const ALLOWED_TYPES = ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"] as const;

const inputSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(ALLOWED_TYPES).optional(),
  summary: z.string().max(8000).optional(),
  decisions: z.array(z.string()).optional(),
  attendees: z.array(z.object({
    name: z.string().max(160),
    email: z.string().email().nullable().optional(),
  })).optional(),
  actionItems: z.array(z.object({
    title: z.string().min(1).max(200),
    assigneeName: z.string().max(160).optional(),
    assigneeEmail: z.string().email().nullable().optional(),
    deadlineDays: z.number().int().min(0).max(365).nullable().optional(),
  })).optional(),
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
  async function resolveUserId(name?: string, email?: string | null): Promise<{ userId: string; matched: boolean }> {
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
  let tasksSpawned = 0;
  for (const ai of parsed.data.actionItems ?? []) {
    const { userId: assigneeId } = await resolveUserId(ai.assigneeName, ai.assigneeEmail);
    const deadline = ai.deadlineDays != null
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

    if (parsed.data.spawnTasks) {
      await prisma.task.create({
        data: {
          organizationId: user.organizationId,
          title: ai.title,
          description: `From meeting: ${meeting.title}`,
          priority: "NORMAL",
          date: deadline ?? new Date(),
          assigneeId,
          source: "MANUAL",
        },
      });
      tasksSpawned++;
    }
  }

  return NextResponse.json({
    ok: true,
    meeting,
    counts: {
      attendees: uniqueMatched.length,
      attendeesUnmatched: unmatchedAttendeeLabels.length,
      decisions: (parsed.data.decisions ?? []).length,
      actionItems: createdActionItems.length,
      tasksSpawned,
    },
  });
}
