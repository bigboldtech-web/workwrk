// /my-work/personal: your own private List.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2
// (/my-work/personal): a MOVE from `/tasks/personal-list`, not a rebuild. That
// page was already the only `/tasks/*` route on the Item model, a real,
// per-user, space-less PRIVATE board rendered through the same `BoardCanvas`
// as every other List. What changes is the URL, the `basePath` the view tabs
// build their links from, and the header, which used to read "My Wrk /
// Personal List" in a hand-rolled breadcrumb carrying a name the product has
// retired.
//
// It lives under My work because "My work" is one group with one URL prefix:
// `/my-work` is everything assigned to you, `/my-work/personal` is the List
// for the things that belong to no project.
//
// `ensureCoreListViews` still runs. spec-spaces-lists section 4 step 6 retires
// that self-heal, and this page is named in its risk note as the second caller
// that has to move in the SAME release, until it does, removing it here alone
// would take the Board, Calendar and Gantt tabs off the personal List with
// nothing to replace them.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gatePage } from "@/lib/access/gate";
import { getOrCreatePersonalBoard, ensureCoreListViews } from "@/lib/board";
import { listViewsForViewer } from "@/lib/work/default-view";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { parseBoardSchema } from "@/lib/field-catalog";
import { canSaveView } from "@/lib/work/view-visibility";
import { BoardViewTabs } from "../../boards/[slug]/board-view-tabs";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";
import { OsPageHeader } from "@/components/layout/os/page-header";

export const dynamic = "force-dynamic";

export default async function PersonalListPage(props: {
  searchParams: Promise<{ view?: string; item?: string }>;
}) {
  const sp = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=%2Fmy-work%2Fpersonal");

  const { viewer } = await gatePage("view", { type: "app", key: "home" }, { callbackUrl: "/my-work/personal" });
  // A Guest has no personal List: they are in the workspace for one List that
  // somebody shared with them, not for a private planner. The sidebar row does
  // not render for them either, so this is the belt to that braces.
  if (viewer.orgRole === "GUEST") notFound();

  const board = await getOrCreatePersonalBoard(viewer.organizationId, viewer.userId);
  await ensureCoreListViews(board.id, viewer.userId);
  const rows = await prisma.view.findMany({
    where: { boardId: board.id },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  // The same resolver as every List (decision 8): the owner's pin, else Board.
  // The views come back with that default first, so the strip's first tab is
  // the view this bare URL opens.
  const { views, defaultView, pinned } = listViewsForViewer(rows, viewer.userId);
  const activeView = (sp.view ? views.find((v) => v.id === sp.view) : null) ?? defaultView;

  // Projected for its owner like every List read (no reserved key, their own
  // connect values). No union: a Personal List is never a link target, so no
  // task is ever shown here through a link.
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  const items = await listBoardItems(board.id, {
    view: { viewer: { userId: viewer.userId, organizationId: viewer.organizationId, accessLevel }, contextBoardId: board.id },
  });
  const initialFields = parseBoardSchema(board.schema).fields;
  const statuses = getBoardStatuses(board);

  return (
    <>
      <OsPageHeader
        title="Personal list"
        // The Space icon catalog has no lock, and a Server Component cannot
        // hand a component across the RSC boundary, so the tile is the List
        // glyph (it IS a List) and the privacy is stated in words beside it
        // rather than left to an icon nobody can be sure of.
        tile={{ fallback: "list", name: "Personal list" }}
        actions={
          // Where the role chip sits on a shared List. A personal List has no
          // grants and no owner row to show, so it says what it is instead.
          <span className="text-xs font-medium text-ink-2">Private to you</span>
        }
      />

      <BoardViewTabs
        views={views}
        boardId={board.id}
        boardSlug={board.slug}
        activeViewId={activeView?.id ?? null}
        defaultViewId={defaultView?.id ?? null}
        defaultPinned={pinned}
        personalList
        basePath="/my-work/personal"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <BoardCanvas
          boardId={board.id}
          viewId={activeView?.id ?? null}
          viewType={activeView?.type ?? "TABLE"}
          viewConfig={(activeView?.config as Record<string, unknown> | null) ?? {}}
          initialItems={items}
          initialFields={initialFields}
          statuses={statuses}
          canContribute={true}
          // A Personal List is its owner's own surface: they hold full access
          // on it, so the row menu's Delete is theirs (the API agrees, the
          // creator branch of `tasks.delete` clears for every task here).
          canDeleteTasks={true}
          // Its owner saves its views (the views route answers a space-less
          // List's owner as a contributor).
          canSaveView={activeView ? canSaveView(activeView, viewer.userId, true) : false}
          // Private to its owner, so its tasks are never offered for another
          // List: the row menu has no Add to another List here.
          personalList
          currentUserId={viewer.userId}
          addTaskSlot={
            <BoardAddTaskButton
              key="add-task"
              boardId={board.id}
              boardSlug={board.slug}
              boardName={board.name}
              spaceId={null}
            />
          }
        />
      </div>
    </>
  );
}
