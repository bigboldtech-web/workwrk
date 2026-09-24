// ONE gate for every /api/items/[id]* route, on the ITEM ref.
//
// spec-task-detail.md section 4 step 2. Three things this file exists to fix,
// all of them today's behaviour and none of them cosmetic:
//
//   1. ASSIGNEES WERE 403'd ON WRITE AND 404'd ON COMMENT. `GET
//      /api/items/[id]` short-circuited to `canEdit: true` for an owner or an
//      assignee, while `PATCH`'s own loader had no assignee branch and 403'd
//      them, and the updates and activity routes resolved a SPACE first. Rule
//      9 gives an assignee EDIT on the task, so all of it resolves here, once.
//
//   2. PERSONAL-LIST TASKS HAD NO COMMENT THREAD AT ALL. The updates and
//      activity routes 404'd when `!item.board.spaceId`, and the personal
//      board has no `spaceId` by construction, so every comment and every
//      activity row on a personal task was unreachable. Gating on the item
//      ref is the whole fix: there is nothing to migrate and no new column.
//
//   3. READS NEVER 403 ABOUT A TASK. A task is never discoverable (access rule
//      14 gives discoverability to a findable Space, to a container the viewer
//      holds a role inside, and to the List holding a task assigned to them -
//      an Item is none of those). So "no role" and "does not exist" are one
//      state, answered 404. A 403 is reserved for the role-too-low WRITE.
//
// WHY THIS IS NOT `requireCan` YET. The access engine under src/lib/access is
// still INERT: spec section 4 step 2 says so itself, and says the assignee
// branch and the item-ref move "ship as the interim fix" until access steps 0
// and 1 land, with `canEdit` computed once and returned as `decision.role`.
// That is exactly what this file does. The signals come from the existing
// board helpers, which already delegate through parity.ts's one transcription,
// so no helper is flipped to `can()` here. The SHAPE is `ItemDecision`, which
// is the shape the engine will produce, so the day it is switched on only this
// file changes and nothing above it does.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canContributeBoard, canEditBoard, getBoardForReader } from "@/lib/board";
import { isOrgAdminAccessLevel } from "@/lib/space";
import { getBoardStatuses } from "@/lib/board-items-shared";
import { parseBoardSchema } from "@/lib/field-catalog";
import { readWatchers } from "@/lib/item-watchers";
import { linkedListsOf, listReader } from "@/lib/list-links-server";
import {
  allowsItemAction,
  decideItem,
  denialStatusFor,
  type ItemAction,
  type ItemDecision,
} from "@/lib/item-role";

export interface ItemCtx {
  userId: string;
  accessLevel: string;
  organizationId: string;
  userName: string | null;
}

/** The named not-found. Mirrored by src/lib/task-load-failure.ts on the client. */
export type ItemMissingReason = "legacy_task_not_migrated";

/**
 * A 500 that says WHY, for every item route.
 *
 * Before this, a thrown Prisma error left the App Router to answer its own
 * 500 with an empty body, and the client collapsed that into "Couldn't load
 * this task". The founder's report of production was those four words and
 * nothing else. The first line of the error is the thing a person on the box
 * needs (it is what `pm2 logs` would show), and the two database shapes this
 * release is known to be able to meet, a column or a table the SQL manifest
 * did not add, get a hint that names the fix. Nothing secret is in a Prisma
 * message: it names columns and tables, never data or credentials.
 */
export function itemServerError(err: unknown, where: string): NextResponse {
  const raw = err instanceof Error ? err.message : String(err);
  // Prisma prefixes a multi-line "Invalid `prisma.x()` invocation" block; the
  // line that names the problem is the last non-empty one.
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const detail = (lines[lines.length - 1] ?? raw).slice(0, 300);
  const schemaBehind = /column .* does not exist|relation .* does not exist|Unknown (argument|field)|does not exist in the current database/i.test(raw);
  const hint = schemaBehind
    ? "The database is behind the code: a file in prisma/sql has not been applied to this environment. See prisma/sql/README.md."
    : null;
  console.error(`[items] ${where} failed: ${raw}`);
  return NextResponse.json(
    { error: "server_error", where, detail, ...(hint ? { hint } : {}) },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

/** Session unwrap, shared by every item route so the 401 body is one body. */
export async function itemCtx(): Promise<{ error: NextResponse } | ItemCtx> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string; name?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return {
    userId: u.id,
    accessLevel: u.accessLevel ?? "EMPLOYEE",
    organizationId: u.organizationId,
    userName: u.name ?? null,
  };
}

const ITEM_INCLUDE = {
  board: {
    select: {
      id: true,
      slug: true,
      name: true,
      spaceId: true,
      folderId: true,
      organizationId: true,
      schema: true,
      statuses: true,
      // The List's own sharing state, so the task hosts can open the one share
      // dialog at List scope ("…" > Share) without a second round trip, and so
      // the read-only banner can name the List owner rather than saying "the
      // list owner" (spec-task-detail section 1, Access case 3).
      visibility: true,
      ownerId: true,
      // Phase 5b: a task whose home List is archived drops out of every List
      // it is linked into, so the linked-list rule below has to see this.
      archivedAt: true,
    },
  },
} as const;

export type GatedItem = Awaited<ReturnType<typeof loadItem>>;

async function loadItem(itemId: string) {
  return prisma.item.findUnique({ where: { id: itemId }, include: ITEM_INCLUDE });
}

/** Rule 5: the creator, read back from the CREATED activity row. */
async function creatorIdOf(organizationId: string, itemId: string): Promise<string | null> {
  try {
    const row = await prisma.itemActivity.findFirst({
      where: { organizationId, entityType: "BOARD_ITEM", entityId: itemId, action: "CREATED" },
      orderBy: { createdAt: "asc" },
      select: { actorId: true },
    });
    return row?.actorId ?? null;
  } catch {
    // A missing activity row means "creator unknown", which costs the viewer
    // FULL and never grants it. Failing closed is the right direction here.
    return null;
  }
}

export interface ItemGateOk {
  item: NonNullable<Awaited<ReturnType<typeof loadItem>>>;
  decision: ItemDecision;
  creatorId: string | null;
  /** Rule 5, resolved for the viewer, because `delete` needs it. */
  isCreator: boolean;
  watcherIds: string[];
  unwatcherIds: string[];
  /**
   * Phase 5b: the readable List the task is linked into that gave this
   * viewer VIEW, when that is the only thing they hold on the task; null
   * otherwise. It is resolved only when nothing else grants a role, so a home
   * reader pays no extra query for it.
   */
  viaLinkedList: { id: string; name: string } | null;
}

export type ItemGateResult = { error: NextResponse } | ItemGateOk;

function denial(decision: ItemDecision, action: ItemAction): NextResponse {
  const status = denialStatusFor(decision, action);
  if (status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Spec section 1: the 403 body is the role-too-low case, and the client
  // turns `requestAccess` into one toast with a door, never a dead end.
  return NextResponse.json(
    { error: "no_access", reason: "role_too_low", role: decision.role, requestAccess: true },
    { status: 403 },
  );
}

/**
 * The one gate. Resolves the viewer's role on the task, then answers the
 * action.
 *
 * Every item route calls this and nothing else: there is no second place where
 * a task decides who may read it, which is what makes the three fixes above
 * stay fixed.
 */
export async function gateItem(
  itemId: string,
  c: ItemCtx,
  action: ItemAction,
): Promise<ItemGateResult> {
  let item = await loadItem(itemId);

  // A LEGACY TASK ID STILL OPENS ITS TASK.
  //
  // Phase 2 W4 (spec-work-home section 4). Ids from before the Task -> Item
  // migration are stored in places this product does not own and cannot
  // rewrite: doc blocks people embedded, emails, bookmarks, Slack messages,
  // the ICS feed. `scripts/migrate-legacy-tasks.ts` wrote a permanent
  // forwarding address for every one of them, and resolving it HERE means
  // every /api/items/[id]* route inherits it rather than each caller learning
  // about the old world.
  //
  // It costs nothing on the normal path: the lookup only runs when there is no
  // Item with that id at all. The forwarding row is org-scoped, so a legacy id
  // from another workspace stays a 404 and never becomes a hint that the id is
  // real. A missing LegacyRedirect table degrades this to the same 404 the
  // caller would have had anyway.
  if (!item) {
    const forwarded = await prisma.legacyRedirect
      .findUnique({
        where: {
          organizationId_kind_legacyId: { organizationId: c.organizationId, kind: "task", legacyId: itemId },
        },
        select: { target: true },
      })
      .catch(() => null);
    const migratedId = forwarded?.target?.startsWith("/item/") ? forwarded.target.slice("/item/".length) : null;
    if (migratedId) item = await loadItem(migratedId);
  }

  // Org scope first, and a cross-org id answers exactly like a missing one.
  if (!item || item.organizationId !== c.organizationId) {
    // THE ONE NOT-FOUND A READER CAN ACT ON, named. When the id is a row on
    // the legacy `Task` table in THIS org, with no forwarding address, the
    // task is real and unreached: scripts/migrate-legacy-tasks.ts has not
    // run (or failed) on this workspace. Saying "not found" to that reader
    // sent the founder looking for a deleted task that was sitting in the old
    // table the whole time. The answer is still 404, still org-scoped, and
    // only given to the people the old page showed that row to (its assignee,
    // its creator, an org admin), so nothing becomes discoverable that was
    // not already. A missing `Task` table degrades to the plain 404.
    if (!item) {
      const legacy = await prisma.task
        .findFirst({
          where: { id: itemId, organizationId: c.organizationId },
          select: { assigneeId: true, createdById: true },
        })
        .catch(() => null);
      const mine = legacy && (legacy.assigneeId === c.userId || legacy.createdById === c.userId);
      if (legacy && (mine || isOrgAdminAccessLevel(c.accessLevel))) {
        return {
          error: NextResponse.json(
            {
              error: "Not found",
              reason: "legacy_task_not_migrated" satisfies ItemMissingReason,
              detail:
                "This id is a task on the old task list. It has not been moved onto the new task model yet: " +
                "scripts/migrate-legacy-tasks.ts has not run, or did not finish, for this workspace.",
            },
            { status: 404 },
          ),
        };
      }
    }
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const assignee = item.ownerId === c.userId || item.assigneeIds.includes(c.userId);
  const orgAdmin = isOrgAdminAccessLevel(c.accessLevel);

  // Rule 10: what the parent List gives this viewer. The three legacy helpers
  // are the source, in descending order, and each one already delegates
  // through parity.ts. An org admin skips the queries entirely, and gets
  // listRole "none", not a fabricated FULL: rule 4 is what makes them FULL, and
  // stamping a synthetic List grant here made `decision.via` say "list" and
  // `viaObject` name a List the admin holds no grant on, which is a lie the
  // header chip and support would both repeat.
  let listRole: ItemDecision["role"] = "none";
  if (!orgAdmin) {
    const board = await getBoardForReader(item.boardId, c.userId, c.accessLevel);
    if (board) {
      if (await canEditBoard(item.boardId, c.userId, c.accessLevel)) listRole = "FULL";
      else if (await canContributeBoard(item.boardId, c.userId, c.accessLevel)) listRole = "EDIT";
      else listRole = "VIEW";
    }
  }

  // Rule 5, one indexed query. It is resolved on EVERY call rather than only
  // when it can change the role, because `creatorId` is also what the task body
  // renders "Created by {name}" from (spec section 2), and skipping it for the
  // viewers who hold FULL is how that line came back null for every org admin.
  const creatorId = await creatorIdOf(c.organizationId, itemId);

  // Phase 5b, tasks in more than one List: a reader of a List the task (or
  // its top-level ancestor on the same home) is linked into may READ it. Only
  // asked when nothing above grants anything, and never while the home List is
  // archived, because an archived List's tasks drop out of every union.
  const holdsNothing = !orgAdmin && listRole === "none" && !assignee && !(creatorId && creatorId === c.userId);
  let viaLinkedList: { id: string; name: string } | null = null;
  if (holdsNothing && !item.board.archivedAt) {
    const { links } = await linkedListsOf(item);
    const reader = listReader(c);
    for (const l of links) {
      const b = await reader.row(l.boardId);
      if (b) {
        viaLinkedList = { id: b.id, name: b.name };
        break;
      }
    }
  }

  const decision = decideItem({
    orgAdmin,
    // There is no org-level GUEST rung in this product's AccessLevel enum; a
    // board- or space-level GUEST is already read-only through the helpers
    // above, so it arrives here as listRole VIEW and needs no second cap.
    guest: false,
    agent: c.accessLevel === "AGENT",
    creator: !!creatorId && creatorId === c.userId,
    assignee,
    listRole,
    archived: !!item.archivedAt,
    list: { id: item.board.id, name: item.board.name },
    linkedList: viaLinkedList,
  });

  const isCreator = !!creatorId && creatorId === c.userId;
  if (!allowsItemAction(decision, action, { creator: isCreator, agent: c.accessLevel === "AGENT" })) {
    return { error: denial(decision, action) };
  }

  const { watchers, unwatchers } = readWatchers(item.metadata);
  return { item, decision, creatorId, isCreator, watcherIds: watchers, unwatcherIds: unwatchers, viaLinkedList };
}

// ── Breadcrumb ────────────────────────────────────────────────────

export interface ItemBreadcrumb {
  space: { id: string; slug: string; name: string; icon: string | null; readable: boolean } | null;
  folder: { id: string; name: string; readable: boolean } | null;
  list: { id: string; slug: string; name: string; readable: boolean };
}

/**
 * The Space / Folder / List trail for the task page's top bar.
 *
 * `readable` is what turns a crumb into a link: an assignee-only viewer sees
 * the names as grey labels, because they can open the task without being able
 * to open its List (access example B). A Personal List task has no Space and
 * no Folder, and both come back null.
 */
export async function itemBreadcrumb(
  item: ItemGateOk["item"],
  c: ItemCtx,
  opts: { listReadable: boolean },
): Promise<ItemBreadcrumb> {
  const [space, folder] = await Promise.all([
    item.board.spaceId
      ? prisma.space
          .findFirst({
            where: { id: item.board.spaceId, organizationId: c.organizationId },
            select: { id: true, slug: true, name: true, icon: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    item.board.folderId
      ? prisma.folder
          .findFirst({
            where: { id: item.board.folderId, organizationId: c.organizationId },
            select: { id: true, name: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  // A viewer who cannot read the List cannot read its ancestors either, which
  // is the whole of the assignee-only case. A viewer who CAN read the List
  // reached it through the Space or through a direct grant, and either way the
  // crumb is a link they will not be bounced from.
  const readable = opts.listReadable;
  return {
    space: space ? { ...space, readable } : null,
    folder: folder ? { ...folder, readable } : null,
    list: { id: item.board.id, slug: item.board.slug, name: item.board.name, readable },
  };
}

/** Can the viewer open the task's List page? (Drives every crumb's link.) */
export async function listIsReadable(item: ItemGateOk["item"], c: ItemCtx): Promise<boolean> {
  if (isOrgAdminAccessLevel(c.accessLevel)) return true;
  return Boolean(await getBoardForReader(item.boardId, c.userId, c.accessLevel));
}

/** The board context every task host renders from (fields + status palette). */
export function boardContext(item: ItemGateOk["item"]) {
  return {
    id: item.board.id,
    slug: item.board.slug,
    name: item.board.name,
    spaceId: item.board.spaceId,
    folderId: item.board.folderId,
    fields: parseBoardSchema(item.board.schema).fields,
    statuses: getBoardStatuses(item.board),
    // A client that predates these two reads `undefined` and degrades to the
    // behaviour it had: no Share row, "the list owner" in the banner.
    visibility: item.board.visibility,
    ownerId: item.board.ownerId,
  };
}
