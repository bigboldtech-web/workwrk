import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { processEmailQueue } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { logActivity } from "@/lib/activity";
import { getUserTagIds } from "@/lib/user-tags";
import {
  parseAnnouncementAudience,
  validateAnnouncementAudience,
  resolveAnnouncementAudienceUserIds,
  resolveAnnouncementAudienceNames,
  viewerInAnnouncementAudience,
  viewerSpaceIds,
  type AnnouncementAudience,
} from "@/lib/announcement-audience";
import {
  canCreateAnnouncement,
  canOpenAnnouncements,
  canReadAnyAnnouncement,
  allowedAudienceKinds,
} from "@/lib/announcement-access";
import { announcementViewer, holdsAnySpaceFullAccess, spaceIdsWithFullAccess } from "@/lib/announcement-server";
import {
  announcementInFeed,
  compareAnnouncements,
  isAnnouncementPriority,
  isAnnouncementType,
  parseAnnouncementSort,
  parseAnnouncementView,
  postedInstant,
  type AnnouncementPriority,
} from "@/lib/announcement-view";
import { inboxRecordOf, inboxRowEnabled } from "@/lib/inbox-notify-keys";

/**
 * The announcements feed (spec-talk.md section 2.3 Data).
 *
 * WHAT CHANGED, and each of these was a real defect:
 *
 *  * `publishedAt` is honoured. The old where clause filtered on `expiresAt`
 *    alone, so a post scheduled for next Monday was readable by its whole
 *    audience the second it was created while its notifications waited for
 *    the cron. Only the author and the oversight readers see a scheduled post
 *    now, and only in the Mine view.
 *  * The oversight read is Owner, Admin, the People team and the author, not
 *    "any legacy manager level" (src/lib/announcement-access.ts explains).
 *  * The 50 row cap is gone. The list pages with a cursor, so a workspace
 *    with 400 announcements can reach all of them.
 *  * Filters, views and sorts are the URL's, answered here rather than by
 *    fetching everything and filtering in the browser.
 *  * A Guest gets 404. Announcements are not a Guest surface.
 *
 * Query: ?view=all|ack|pinned|mine &type= &priority= &audience= &author=
 *        &from= &to= &sort=newest|oldest|priority|expiring &cursor= &limit=
 * Returns { data, next, counts: { toAck } }.
 */

/** One page of cards. The footer's "Load more" asks for the next. */
const PAGE = 20;
const MAX_PAGE = 100;

/**
 * How deep the audience filter may scan. Audience membership cannot be
 * expressed in SQL (a tag audience resolves through two tables), so the route
 * reads a window and filters it, then pages over what survives. The window is
 * generous and bounded: a workspace with more than this many live
 * announcements pages through them, it does not lose them.
 */
const SCAN = 500;

type Row = Awaited<ReturnType<typeof prisma.announcement.findMany>>[number];

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);

  // A Guest never reaches announcements: 404, not 403, so the surface is not
  // confirmed to somebody who has no business knowing it exists.
  if (!canOpenAnnouncements(viewer)) return jsonError("Not found", 404);

  const sp = req.nextUrl.searchParams;
  const view = parseAnnouncementView(sp.get("view"));
  const sort = parseAnnouncementSort(sp.get("sort"));
  const wantTypes = (sp.get("type") ?? "").split(",").map((s) => s.trim()).filter(isAnnouncementType);
  const wantPriorities = (sp.get("priority") ?? "").split(",").map((s) => s.trim()).filter(isAnnouncementPriority);
  const wantAudience = (sp.get("audience") ?? "").trim();
  const wantAuthors = (sp.get("author") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const from = sp.get("from");
  const to = sp.get("to");
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const cursor = Number(sp.get("cursor") ?? "0") || 0;
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(sp.get("limit") ?? PAGE) || PAGE));

  try {
    const now = new Date();
    const oversight = canReadAnyAnnouncement(viewer);

    const where: Prisma.AnnouncementWhereInput = { organizationId: orgId };
    if (wantTypes.length > 0) where.type = { in: wantTypes };
    if (wantPriorities.length > 0) where.priority = { in: wantPriorities };
    if (wantAuthors.length > 0) where.authorId = { in: wantAuthors };
    if (view === "mine") where.authorId = userId;
    if (view === "pinned") where.pinned = true;

    // The posted-date filter reads the instants the pickers wrote.
    const postedRange: Prisma.DateTimeFilter = {};
    if (from && !Number.isNaN(Date.parse(from))) postedRange.gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) postedRange.lte = new Date(to);
    if (postedRange.gte || postedRange.lte) where.publishedAt = postedRange;

    // `Announcement.authorId` carries no Prisma relation, so the authors are
    // one extra query over the page rather than an `include`.
    const rows = await prisma.announcement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SCAN,
    });

    // Audience and lifecycle, in that order, because both need the viewer.
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, departmentId: true, officeId: true },
    });
    const needsTags = rows.some((r) => parseAnnouncementAudience(r.targetAudience).type === "TAGS");
    const needsSpaces = rows.some((r) => parseAnnouncementAudience(r.targetAudience).type === "SPACE");
    const [tagIds, spaceIds] = await Promise.all([
      needsTags ? getUserTagIds(orgId, userId) : Promise.resolve<string[]>([]),
      needsSpaces ? viewerSpaceIds(orgId, userId) : Promise.resolve<string[]>([]),
    ]);

    const inAudience = (a: Row) =>
      Boolean(me) &&
      viewerInAnnouncementAudience(parseAnnouncementAudience(a.targetAudience), me!, tagIds, spaceIds);

    const nowMs = now.getTime();
    const visible = rows.filter((a) => {
      const mine = a.authorId === userId;
      // The audience decides who may read it. Oversight readers and the
      // author read everything.
      if (!(oversight || mine || inAudience(a))) return false;
      if (view === "mine") return true; // drafts, scheduled and expired, all of my own
      // The scheduled and expired rules are announcementInFeed's, shared with
      // /api/search so the two lists cannot answer differently about the same
      // post. Search had NO announcement gate at all and returned every title
      // in the workspace to every member; the fix was to give both callers one
      // function rather than a second copy of this block.
      if (!announcementInFeed(a, { viewerId: userId, oversight, inAudience: inAudience(a), now: nowMs })) return false;
      if (wantAudience) {
        const t = parseAnnouncementAudience(a.targetAudience).type;
        if (wantAudience === "ALL" && t !== "ALL") return false;
        if (wantAudience === "MINE" && t === "ALL") return false;
        if (wantAudience !== "ALL" && wantAudience !== "MINE" && t !== wantAudience) return false;
      }
      if (q && !(`${a.title} ${a.content}`.toLowerCase().includes(q))) return false;
      return true;
    });

    // My own ack state, once for the window rather than once per card.
    const acks = visible.length > 0
      ? await prisma.announcementAcknowledgment.findMany({
          where: { userId, announcementId: { in: visible.map((a) => a.id) } },
          select: { announcementId: true, acknowledgedAt: true },
        })
      : [];
    const ackMap = new Map(acks.map((a) => [a.announcementId, a.acknowledgedAt] as const));

    const toAck = visible.filter((a) => a.mustAcknowledge && !ackMap.has(a.id)).length;

    let scoped = visible;
    if (view === "ack") scoped = visible.filter((a) => a.mustAcknowledge && !ackMap.has(a.id));

    scoped = [...scoped].sort((x, y) =>
      compareAnnouncements(
        sort,
        {
          priority: x.priority as AnnouncementPriority,
          postedAt: postedInstant({ publishedAt: x.publishedAt?.toISOString() ?? null, createdAt: x.createdAt.toISOString() }),
          expiresAt: x.expiresAt?.toISOString() ?? null,
        },
        {
          priority: y.priority as AnnouncementPriority,
          postedAt: postedInstant({ publishedAt: y.publishedAt?.toISOString() ?? null, createdAt: y.createdAt.toISOString() }),
          expiresAt: y.expiresAt?.toISOString() ?? null,
        },
      ),
    );

    const page = scoped.slice(cursor, cursor + limit);
    const next = cursor + limit < scoped.length ? String(cursor + limit) : null;

    // Audience names and authors for the page only, so the meta line reads
    // "Anita Rao - Sales, Marketing" without one lookup per row in the browser.
    const authorIds = [...new Set(page.map((a) => a.authorId).filter(Boolean))];
    const [names, authors] = await Promise.all([
      Promise.all(page.map((a) => resolveAnnouncementAudienceNames(orgId, parseAnnouncementAudience(a.targetAudience)))),
      authorIds.length > 0
        ? prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, firstName: true, lastName: true, avatar: true },
          })
        : Promise.resolve([]),
    ]);
    const authorMap = new Map(authors.map((u) => [u.id, u]));

    const data = page.map((a, i) => ({
      ...a,
      audience: parseAnnouncementAudience(a.targetAudience),
      audienceNames: names[i],
      author: authorMap.get(a.authorId) ?? null,
      ackedByMe: ackMap.has(a.id),
      ackedAt: ackMap.get(a.id) ?? null,
      canEdit: viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || a.authorId === userId,
    }));

    return NextResponse.json(
      { data, next, counts: { toAck, total: scoped.length } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: unknown) {
    console.error("Announcements GET error:", err);
    return jsonError(err instanceof Error ? err.message : "Failed to fetch announcements", 500);
  }
}

/**
 * Post an announcement.
 *
 * The create gate is the one rule the sidebar "+" row, the toolbar button and
 * the palette entry read (src/lib/announcement-access.ts): Owner, Admin, the
 * People team, or somebody holding Full access on a Space, who is capped at
 * the "People in {Space}" audience.
 *
 * TIME. `publishedAt` and `expiresAt` arrive as UTC instants, because the
 * composer converts the viewer's wall clock with src/lib/zoned-time.ts. The
 * old route took a yyyy-mm-dd and appended "T23:59:59.999Z", which is the end
 * of the UTC day and not the end of anybody's day. A yyyy-mm-dd is still
 * accepted for stored links and older clients, and is read as the end of that
 * UTC day exactly as before, so nothing regresses.
 *
 * `expiresAt: null` is accepted now. "No expiry" is a real answer.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const viewer = await announcementViewer(session as never);
  const spaceFull = await holdsAnySpaceFullAccess(orgId, userId);
  if (!canCreateAnnouncement(viewer, spaceFull)) {
    return jsonError("You do not have permission to post announcements", 403);
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Invalid request body", 400);
  const { title, content, type, priority, pinned, expiresAt, targetAudience, publishedAt, mustAcknowledge } = body as {
    title?: string; content?: string; type?: string; priority?: string; pinned?: boolean;
    expiresAt?: string | null; targetAudience?: unknown; publishedAt?: string | null; mustAcknowledge?: boolean;
  };

  if (!title?.trim() || !content?.trim()) return jsonError("Title and content required");

  const expiryDate = parseExpiry(expiresAt);
  if (expiryDate === "invalid") return jsonError("Invalid expiry date");
  if (expiryDate && expiryDate.getTime() <= Date.now()) return jsonError("Expiry date must be in the future");

  let publishAt = new Date();
  let isScheduled = false;
  if (publishedAt) {
    const parsed = new Date(publishedAt);
    if (Number.isNaN(parsed.getTime())) return jsonError("Invalid schedule time");
    if (parsed.getTime() > Date.now()) {
      publishAt = parsed;
      isScheduled = true;
    }
  }
  if (expiryDate && publishAt.getTime() >= expiryDate.getTime()) {
    return jsonError("Publish time must be before the expiry date");
  }

  const audience = parseAnnouncementAudience(targetAudience);
  const kinds = allowedAudienceKinds(viewer, spaceFull);
  if (!kinds.includes(audience.type)) {
    return jsonError("You cannot post to that audience", 403);
  }
  if (audience.type === "SPACE" && !(viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN" || viewer.canCreate)) {
    // A Space Full holder may address THEIR Space, never any Space.
    const mine = await spaceIdsWithFullAccess(orgId, userId);
    if (!audience.ids.every((id) => mine.includes(id))) {
      return jsonError("You do not hold Full access on that Space", 403);
    }
  }
  const audCheck = await validateAnnouncementAudience(orgId, audience);
  if (!audCheck.ok) return jsonError(audCheck.error);

  try {
    const announcement = await prisma.announcement.create({
      data: {
        title: title.trim(),
        content: content.trim(),
        type: type || "INFO",
        priority: priority || "NORMAL",
        pinned: pinned === true,
        mustAcknowledge: mustAcknowledge === true,
        publishedAt: publishAt,
        // Immediate posts fire their fan-out below, so they are marked
        // notified up front. A scheduled post stays NULL until the cron runs.
        notificationsSentAt: isScheduled ? null : new Date(),
        expiresAt: expiryDate,
        targetAudience: audience as unknown as Prisma.InputJsonValue,
        authorId: userId,
        organizationId: orgId,
      },
    });

    await logActivity({
      type: announcement.mustAcknowledge ? "announcement.create.must_ack" : "announcement.create",
      actorId: userId,
      organizationId: orgId,
      description: `Created announcement: ${announcement.title}`,
      targetType: "Announcement",
      targetId: announcement.id,
      metadata: {
        priority: announcement.priority,
        type: announcement.type,
        mustAcknowledge: announcement.mustAcknowledge,
        scheduled: isScheduled,
        audience: audience.type,
      },
    });

    if (isScheduled) {
      return jsonSuccess({ ...announcement, scheduled: true }, 201);
    }

    await notifyAudience({
      orgId,
      authorId: userId,
      announcement: {
        id: announcement.id,
        title: announcement.title,
        content: announcement.content,
        priority: announcement.priority,
        mustAcknowledge: announcement.mustAcknowledge,
      },
      audience,
    });

    return jsonSuccess(announcement, 201);
  } catch (err: unknown) {
    console.error("Announcements POST error:", err);
    return jsonError(err instanceof Error ? err.message : "Failed to create announcement", 500);
  }
}

/**
 * Expiry, from three accepted shapes: null ("No expiry"), a full ISO instant
 * (what the composer sends, already converted from the author's zone), or a
 * bare yyyy-mm-dd (stored links and older clients), read as the end of that
 * UTC day exactly as the previous route did.
 */
export function parseExpiry(raw: string | null | undefined): Date | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T23:59:59.999Z`);
    return Number.isNaN(d.getTime()) ? "invalid" : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * The fan-out, shared with the scheduled-publish cron's contract.
 *
 * Two things the old version did not do:
 *  * a must-acknowledge post writes `announcement_ack`, which the Inbox routes
 *    to Primary; an ordinary post writes `announcement`, which lands in Other
 *    (spec-talk section 4 step 10, inbox-kinds.ts is the routing table);
 *  * the person's own "Announcements" Inbox row is honoured, EXCEPT for a
 *    must-acknowledge post, which is a thing they have to do rather than a
 *    thing they might like to read.
 */
export async function notifyAudience(opts: {
  orgId: string;
  authorId: string;
  announcement: { id: string; title: string; content: string; priority: string; mustAcknowledge: boolean };
  audience: AnnouncementAudience;
}): Promise<number> {
  const { orgId, authorId, announcement, audience } = opts;
  try {
    const audienceIds = (await resolveAnnouncementAudienceUserIds(orgId, audience)).filter((id) => id !== authorId);
    if (audienceIds.length === 0) return 0;

    let recipients = audienceIds;
    if (!announcement.mustAcknowledge) {
      const prefRows = await prisma.userPreference
        .findMany({ where: { userId: { in: audienceIds } }, select: { userId: true, home: true } })
        .catch(() => [] as Array<{ userId: string; home: unknown }>);
      const off = new Set(
        prefRows.filter((r) => !inboxRowEnabled(inboxRecordOf(r.home), "announcements")).map((r) => r.userId),
      );
      recipients = audienceIds.filter((id) => !off.has(id));
    }
    if (recipients.length === 0) return 0;

    const users = await prisma.user.findMany({
      where: { id: { in: recipients } },
      select: { id: true, email: true, firstName: true },
    });
    if (users.length === 0) return 0;

    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: announcement.mustAcknowledge ? "announcement_ack" : "announcement",
        title: announcement.mustAcknowledge ? "Announcement to acknowledge" : "New announcement",
        message: announcement.title,
        // The post, not the list (spec-talk section 2.4).
        link: `/announcements/${announcement.id}`,
      })),
    });

    const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
    const preview = announcement.content.length > 280
      ? `${announcement.content.slice(0, 280)}...`
      : announcement.content;
    const emailLogs = users.map((u) => {
      const { subject, html } = genericNotificationTemplate({
        heading: announcement.mustAcknowledge ? "Announcement to acknowledge" : "New announcement",
        recipientName: u.firstName,
        subjectText: "A new announcement has been posted in your organization.",
        itemTitle: announcement.title,
        itemDetails: announcement.priority !== "NORMAL" ? `Priority: ${announcement.priority}` : undefined,
        actionLabel: "View announcement",
        actionLink: `${baseUrl}/announcements/${announcement.id}`,
        note: preview,
      });
      return {
        to: u.email,
        subject,
        template: "announcement",
        html,
        variables: { title: announcement.title, priority: announcement.priority },
        organizationId: orgId,
        status: "QUEUED" as const,
      };
    });
    if (emailLogs.length > 0) await prisma.emailLog.createMany({ data: emailLogs });
    processEmailQueue().catch((err) => console.error("[Announcement] Queue processing failed:", err));
    return users.length;
  } catch (notifyErr) {
    // The post is already saved. A notification failure must never undo it.
    console.error("[Announcement] Notification step failed (announcement still saved):", notifyErr);
    return 0;
  }
}
