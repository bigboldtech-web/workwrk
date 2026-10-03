// /api/items/[id]/public-link: a task's public, view-only link.
//
//   GET     what the share dialog shows: whether the workspace allows task
//           links, whether this viewer may turn this one on or off, whether
//           it may be turned on here (a live task in a live place, not a
//           Personal List), whether it is on, its settings, and its address
//           (only for those who may share)
//   POST    turn it on { expiresInDays?: 7 | 30 | 90 | null, showPeople?: boolean }
//           (the same address and settings if it already is)
//   PATCH   change its settings { expiresInDays?, showPeople? }, same address
//   DELETE  turn it off (the address stops working for good)
//
// Readable task first (gateItem "view": 404 names nothing otherwise), then
// the one rule for who may share (src/lib/task-public-link.ts). Turning it
// on also needs the workspace switch and a live task in a live place outside
// a Personal List; changing or turning it off never does, so a link can
// always be withdrawn or shortened. Every change writes the task's activity
// and the workspace's audit row in its own transaction.
//
// Refusals carry a plain `message` the dialog shows as it is.

import { NextResponse } from "next/server";
import { gateItem, itemCtx, itemServerError } from "@/lib/item-gate";
import { prisma } from "@/lib/prisma";
import { orgPublicLinksTurnedOn } from "@/lib/public-links";
import {
  TASK_SHARE_PATH,
  changeTaskLink,
  expiryFromDays,
  mayShareTaskPublicly,
  readTaskLink,
  taskLinkExpired,
  taskLinkPlace,
  taskLinkToken,
  turnOffTaskLink,
  turnOnTaskLink,
  type TaskLinkRow,
  type TaskLinkSettings,
} from "@/lib/task-public-link";

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Where the task is, as the link reads it: in Trash itself, its place in Trash, or live. */
type InTrash = "task" | "place" | null;

async function standing(id: string, c: Ctx) {
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return { error: gate.error } as const;
  const item = gate.item;
  const [org, canManage, place] = await Promise.all([
    prisma.organization.findUnique({ where: { id: c.organizationId }, select: { settings: true } }),
    mayShareTaskPublicly(c, { boardId: item.boardId, organizationId: item.organizationId }),
    taskLinkPlace(item.boardId),
  ]);
  const allowed = orgPublicLinksTurnedOn(org?.settings);
  const inTrash: InTrash = item.archivedAt ? "task" : place.inTrash ? "place" : null;
  return { item, allowed, canManage, personal: place.personal, inTrash } as const;
}

type Standing = Exclude<Awaited<ReturnType<typeof standing>>, { error: NextResponse }>;

function answer(s: Standing, link: TaskLinkRow | null) {
  const on = !!link;
  return NextResponse.json(
    {
      allowed: s.allowed,
      canManage: s.canManage,
      // May it be turned on from here: the right, the switch, a live task in
      // a live place, and not a Personal List.
      canTurnOn: s.canManage && s.allowed && !s.inTrash && !s.personal,
      personal: s.personal,
      inTrash: s.inTrash,
      on,
      // The address only for people who may share it, like a Doc's.
      url: link && s.canManage ? `${TASK_SHARE_PATH}${taskLinkToken(s.item.id, link.secret)}` : null,
      since: link ? link.createdAt.toISOString() : null,
      expiresAt: link?.expiresAt ? link.expiresAt.toISOString() : null,
      expired: link ? taskLinkExpired(link) : false,
      showPeople: link ? link.showPeople : false,
    },
    { headers: NO_STORE },
  );
}

function refuse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

const CANNOT_SHARE = "Only someone who can add tasks to this task's List, or a workspace admin, can share it publicly.";
const BAD_SETTINGS = "Choose how long the link lasts: 7, 30 or 90 days, or no end date.";

/** The settings in a request body: a key not sent stays out, "bad" for a value the dialog never sends. */
async function settingsFrom(req: Request): Promise<Partial<TaskLinkSettings> | "bad"> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Partial<TaskLinkSettings> = {};
  if ("expiresInDays" in body) {
    const at = expiryFromDays(body.expiresInDays);
    if (at === undefined) return "bad";
    out.expiresAt = at;
  }
  if ("showPeople" in body) {
    if (typeof body.showPeople !== "boolean") return "bad";
    out.showPeople = body.showPeople;
  }
  return out;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    return answer(s, await readTaskLink(s.item.id));
  } catch (err) {
    return itemServerError(err, `GET /api/items/${id}/public-link`);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    if (!s.canManage) return refuse(403, "no_access", CANNOT_SHARE);
    const settings = await settingsFrom(req);
    if (settings === "bad") return refuse(400, "bad_settings", BAD_SETTINGS);
    const existing = await readTaskLink(s.item.id);
    if (existing) return answer(s, existing);
    if (!s.allowed) {
      return refuse(409, "public_links_off", "Public links are turned off for this workspace. A workspace admin can turn them on in Settings, Access.");
    }
    if (s.personal) return refuse(409, "personal_list", "A task in a Personal List is yours alone, so it can't be shared publicly.");
    if (s.inTrash === "task") return refuse(409, "item_archived", "This task is in Trash, so it can't be shared.");
    if (s.inTrash === "place") return refuse(409, "place_archived", "This task's List, Folder or Space is in Trash, so it can't be shared.");
    const row = await turnOnTaskLink(s.item.id, c.organizationId, c.userId, {
      expiresAt: settings.expiresAt ?? null,
      showPeople: settings.showPeople ?? false,
    });
    return answer(s, row);
  } catch (err) {
    return itemServerError(err, `POST /api/items/${id}/public-link`);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    if (!s.canManage) return refuse(403, "no_access", CANNOT_SHARE);
    const settings = await settingsFrom(req);
    if (settings === "bad") return refuse(400, "bad_settings", BAD_SETTINGS);
    const row = await changeTaskLink(s.item.id, c.organizationId, c.userId, settings);
    if (!row) return refuse(409, "link_off", "This task's public link is off. Turn it on first.");
    return answer(s, row);
  } catch (err) {
    return itemServerError(err, `PATCH /api/items/${id}/public-link`);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const s = await standing(id, c);
    if ("error" in s) return s.error;
    if (!s.canManage) return refuse(403, "no_access", CANNOT_SHARE);
    await turnOffTaskLink(s.item.id, c.organizationId, c.userId);
    return answer(s, null);
  } catch (err) {
    return itemServerError(err, `DELETE /api/items/${id}/public-link`);
  }
}
