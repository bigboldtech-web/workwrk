// GET /api/public/tasks/[token]: one task, read only, for anyone with its
// public link (src/lib/task-public-link.ts). No sign-in.
//
// Modelled on /api/public/docs/[token]. The token is `${itemId}.${secret}`;
// the secret is compared timing-safe against the task's own link row. Every
// way a link can be dead answers the same 404 (access invariant 14): no
// such task, no link or another secret, the link turned off or past its
// expiry, the task, its List, a Folder above it or its Space in Trash, or
// the workspace's task links not turned on.
//
// THE PAYLOAD IS FIXED AND SMALL, and nothing else ever rides along: the
// title, status, priority, dates, the description as its Markdown (an older
// HTML one reduced to plain text: never HTML, this page is on the app's own
// domain, see src/lib/html-text.ts markdownOrText), the checklist, its
// subtasks' titles and statuses, and the workspace's name and logo. Only
// when the sharer turned on "Show assignees and comments": the assignees'
// first names and the comments (first name, text, time), never their files.
// Never attachments, activity, custom fields, connected tasks, the List or
// Space it is in, ids, or any email.
//
// GET only, so any write is 405. Opening the link is recorded, sampled
// (src/lib/public-link-audit.ts).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicSecretMatches } from "@/lib/doc-sharing";
import { orgPublicLinksTurnedOn } from "@/lib/public-links";
import { auditPublicLinkUse } from "@/lib/public-link-audit";
import { PRIORITY_OPTIONS, getBoardStatuses, isDoneStatus, makeStatusLookup } from "@/lib/board-items-shared";
import { markdownOrText } from "@/lib/html-text";
import { BOARD_ITEM_ENTITY_TYPE } from "@/lib/item-thread";
import { parseTaskLinkToken, readTaskLink, taskLinkExpired, taskLinkPlace } from "@/lib/task-public-link";
import { localeSettingsOf } from "@/lib/settings/org-policy";

const NOT_FOUND = () => NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/** The most comments one page carries: the latest ones, shown oldest first. */
const COMMENT_CAP = 200;

function checklistOf(metadata: unknown): Array<{ text: string; done: boolean }> {
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).checklist : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { text: string; done?: unknown } => !!x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string")
    .slice(0, 200)
    .map((x) => ({ text: x.text.slice(0, 500), done: !!x.done }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseTaskLinkToken(token);
  if (!parsed) return NOT_FOUND();

  const item = await prisma.item.findUnique({
    where: { id: parsed.itemId },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      startAt: true,
      dueAt: true,
      metadata: true,
      archivedAt: true,
      updatedAt: true,
      organizationId: true,
      boardId: true,
      assigneeIds: true,
      board: { select: { statuses: true } },
      organization: { select: { settings: true, name: true, logo: true } },
    },
  });
  if (!item || item.archivedAt) return NOT_FOUND();
  if (!orgPublicLinksTurnedOn(item.organization?.settings)) return NOT_FOUND();
  const link = await readTaskLink(item.id);
  if (!link || !publicSecretMatches(link.secret, parsed.secret) || taskLinkExpired(link)) return NOT_FOUND();
  if ((await taskLinkPlace(item.boardId)).inTrash) return NOT_FOUND();

  const statuses = getBoardStatuses(item.board);
  const lookup = makeStatusLookup(statuses);
  const statusOf = (value: string | null) => {
    if (!value) return null;
    const s = lookup[value];
    return { label: s?.label ?? value, color: s?.color ?? "#98A2B3", done: isDoneStatus(statuses, value) };
  };
  const commentWhere = { organizationId: item.organizationId, entityType: BOARD_ITEM_ENTITY_TYPE, entityId: item.id, archivedAt: null };
  const [subtasks, latest, commentsTotal] = await Promise.all([
    prisma.item.findMany({
      where: { parentItemId: item.id, boardId: item.boardId, organizationId: item.organizationId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { title: true, status: true },
      take: 200,
    }),
    link.showPeople
      ? prisma.itemUpdate.findMany({
          where: commentWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { authorId: true, body: true, createdAt: true },
          take: COMMENT_CAP,
        })
      : Promise.resolve([] as Array<{ authorId: string | null; body: string; createdAt: Date }>),
    link.showPeople ? prisma.itemUpdate.count({ where: commentWhere }) : Promise.resolve(0),
  ]);
  const comments = latest.slice().reverse();
  // First names only, and only with the sharer's say-so.
  const personIds = link.showPeople ? [...new Set([...item.assigneeIds, ...comments.map((c) => c.authorId).filter((v): v is string => !!v)])] : [];
  const people = personIds.length
    ? await prisma.user.findMany({ where: { id: { in: personIds }, organizationId: item.organizationId }, select: { id: true, firstName: true } })
    : [];
  const firstName = new Map(people.map((p) => [p.id, p.firstName?.trim() || null]));
  const assignees = link.showPeople ? item.assigneeIds.map((pid) => firstName.get(pid)).filter((n): n is string => !!n) : [];
  const priority = PRIORITY_OPTIONS.find((p) => p.value === item.priority) ?? null;

  void auditPublicLinkUse({ organizationId: item.organizationId, targetType: "BOARD_ITEM", targetId: item.id, title: item.title });

  return NextResponse.json(
    {
      title: item.title,
      status: statusOf(item.status),
      priority: priority ? { label: priority.label, color: priority.color } : null,
      startAt: item.startAt ? item.startAt.toISOString() : null,
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      description: markdownOrText((item.metadata as Record<string, unknown> | null)?.description).slice(0, 50_000),
      checklist: checklistOf(item.metadata),
      subtasks: subtasks.map((s) => ({ title: s.title, status: statusOf(s.status) })),
      assignees,
      comments: comments
        .map((c) => ({ author: (c.authorId && firstName.get(c.authorId)) || "Someone", text: markdownOrText(c.body).slice(0, 10_000), at: c.createdAt.toISOString() }))
        .filter((c) => c.text),
      // How many there are, so the page can say when it shows only the
      // latest: only when the window really cut some off.
      commentsTotal,
      commentsMore: latest.length === COMMENT_CAP && commentsTotal > COMMENT_CAP,
      updatedAt: item.updatedAt.toISOString(),
      // Dates read as the workspace reads them: its time zone and formats.
      locale: (() => {
        const l = localeSettingsOf(item.organization?.settings);
        return { timezone: l.timezone, dateFormat: l.dateFormat, timeFormat: l.timeFormat };
      })(),
      org: { name: item.organization?.name ?? "", logo: item.organization?.logo ?? null },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
