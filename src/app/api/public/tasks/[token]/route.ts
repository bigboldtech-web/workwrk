// GET /api/public/tasks/[token]: one task, read only, for anyone with its
// public link (src/lib/task-public-link.ts). No sign-in.
//
// Modelled on /api/public/docs/[token]. The token is `${itemId}.${secret}`;
// the secret is compared timing-safe against the task's own link row. Every
// way a link can be dead answers the same 404 (access invariant 14): no
// such task, no link or another secret, the link turned off, the task or its
// List in Trash, or the workspace's public links switched off (toggle 10).
//
// THE PAYLOAD IS FIXED AND SMALL, and nothing else ever rides along: the
// title, status, priority, dates, the description as its Markdown text (an
// older HTML one reduced to plain text: never HTML, this page is on the
// app's own domain, see src/lib/html-text.ts), the checklist, its subtasks'
// titles and statuses, and the assignees' first names. Never comments, attachments, activity, custom fields, connected
// tasks, the List or Space it is in, ids of people, or any email.
//
// GET only, so any write is 405. Opening the link is recorded, sampled
// (src/lib/public-link-audit.ts).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicSecretMatches } from "@/lib/doc-sharing";
import { orgPublicLinksTurnedOn } from "@/lib/public-links";
import { auditPublicLinkUse } from "@/lib/public-link-audit";
import { PRIORITY_OPTIONS, getBoardStatuses, isDoneStatus, makeStatusLookup } from "@/lib/board-items-shared";
import { htmlToText } from "@/lib/html-text";
import { parseTaskLinkToken, readTaskLink } from "@/lib/task-public-link";

const NOT_FOUND = () => NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

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
      board: { select: { statuses: true, archivedAt: true } },
      organization: { select: { settings: true, name: true, logo: true } },
    },
  });
  if (!item || item.archivedAt || item.board?.archivedAt) return NOT_FOUND();
  if (!orgPublicLinksTurnedOn(item.organization?.settings)) return NOT_FOUND();
  const link = await readTaskLink(item.id);
  if (!link || !publicSecretMatches(link.secret, parsed.secret)) return NOT_FOUND();

  const statuses = getBoardStatuses(item.board);
  const lookup = makeStatusLookup(statuses);
  const statusOf = (value: string | null) => {
    if (!value) return null;
    const s = lookup[value];
    return { label: s?.label ?? value, color: s?.color ?? "#98A2B3", done: isDoneStatus(statuses, value) };
  };
  const [subtasks, people] = await Promise.all([
    prisma.item.findMany({
      where: { parentItemId: item.id, boardId: item.boardId, organizationId: item.organizationId, archivedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { title: true, status: true },
      take: 200,
    }),
    item.assigneeIds.length
      ? prisma.user.findMany({ where: { id: { in: item.assigneeIds }, organizationId: item.organizationId }, select: { id: true, firstName: true } })
      : Promise.resolve([] as Array<{ id: string; firstName: string | null }>),
  ]);
  const firstNames = item.assigneeIds
    .map((pid) => people.find((p) => p.id === pid)?.firstName?.trim())
    .filter((n): n is string => !!n);
  const priority = PRIORITY_OPTIONS.find((p) => p.value === item.priority) ?? null;

  void auditPublicLinkUse({ organizationId: item.organizationId, targetType: "BOARD_ITEM", targetId: item.id, title: item.title });

  return NextResponse.json(
    {
      title: item.title,
      status: statusOf(item.status),
      priority: priority ? { label: priority.label, color: priority.color } : null,
      startAt: item.startAt ? item.startAt.toISOString() : null,
      dueAt: item.dueAt ? item.dueAt.toISOString() : null,
      description: htmlToText((item.metadata as Record<string, unknown> | null)?.description).slice(0, 50_000),
      checklist: checklistOf(item.metadata),
      subtasks: subtasks.map((s) => ({ title: s.title, status: statusOf(s.status) })),
      assignees: firstNames,
      updatedAt: item.updatedAt.toISOString(),
      org: { name: item.organization?.name ?? "", logo: item.organization?.logo ?? null },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
