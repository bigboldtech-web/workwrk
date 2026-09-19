// /boards/[slug], the List page: your tasks, in whichever way you want to
// look at them.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/boards/[slug]`.
//
// WHAT CHANGED HERE:
//   * the title row is the design system's: BackButton (Folder name, else
//     Space name) · tile · name · lock · Share · "…". It had no back control
//     at all (audit High #7) and its "…" is now the one ContainerMenu, whose
//     Copy link writes `/boards/<slug>` rather than `/boards/<id>` on a route
//     that only resolves a slug (audit High #1);
//   * an id in place of the slug 308s to the slug, so every link already in a
//     chat window or a notification resolves (audit High #1, the other half);
//   * private views are honoured. `views` came straight out of the page's own
//     Prisma include with no `isShared` filter, so a view someone marked
//     "Private view" was private in the dialog and public here
//     (audit High #5). The rule is one function, shared with the API route;
//   * the generic "Automate" link becomes the menu's Automations row, scoped
//     to this List, and the bare AskSidekickButton goes: AI is the one slot.

import { notFound, redirect, permanentRedirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Lock } from "lucide-react";
import { parseSprintMeta } from "@/lib/sprint";
import { ShareButton } from "@/components/access/share-button";
import { ContainerMenuTrigger } from "@/components/layout/os/container-menu";
import { BackButton } from "@/components/ui/back-button";
import { EntityTile } from "@/components/ui/entity-tile";
import { viewsForViewer } from "@/lib/work/view-visibility";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { BoardViewTabs } from "./board-view-tabs";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { canEditBoard, canContributeBoard, getBoardForReaderOrFolderGrantee, ensureCoreListViews } from "@/lib/board";
import { hasModule } from "@/lib/space-modules";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { parseBoardSchema } from "@/lib/field-catalog";

export const dynamic = "force-dynamic";

export default async function BoardPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; item?: string; panel?: string }>;
}) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const board = await prisma.board.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      space: { select: { id: true, slug: true, name: true, visibility: true, icon: true, color: true, settings: true } },
      folder: { select: { id: true, name: true, icon: true, color: true } },
      views: { orderBy: [{ displayOrder: "asc" }, { name: "asc" }] },
    },
  });
  // audit spaces-boards High #1: Copy link wrote `/boards/<id>` for years and
  // this route only ever resolved a slug, so every pasted List link was a 404.
  // The menu writes the slug now, and an id still resolves, permanently, so the
  // links already sitting in chat windows and notifications work.
  if (!board) {
    const byId = await prisma.board.findFirst({
      where: { id: slug, organizationId: u.organizationId },
      select: { slug: true },
    });
    if (byId) {
      const qs = new URLSearchParams(
        Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
      ).toString();
      permanentRedirect(`/boards/${byId.slug}${qs ? `?${qs}` : ""}`);
    }
  }
  if (!board || !board.space) notFound();

  // Self-heal: give every task List the full ClickUp view set (Board/Calendar/
  // Gantt) so switching views on the list always shows the same tasks. No-op
  // (no writes) once the views exist. Refetch the view set only if it grew.
  let allViews = board.views;
  const createdViews = await ensureCoreListViews(board.id, u.id);
  if (createdViews > 0) {
    allViews = await prisma.view.findMany({
      where: { boardId: board.id },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  }
  // audit High #5: "Private view" was cosmetic here. The dialog wrote
  // `isShared: false` and `ownerId`, and this page read every row anyway. The
  // filter is `src/lib/work/view-visibility.ts`, the same function
  // `GET /api/boards/[id]/views` applies, so the page and the API cannot
  // disagree about what a person can see.
  const views = viewsForViewer(allViews, u.id);

  // READ GATE — the SAME predicate this page's own endpoints use.
  //
  // It was `canRead(viewer, { type: "board" })`, and that resolver does not
  // consult BoardMember, while every `/api/boards/[id]/...` route this page
  // calls loads the board through `getBoardForReader`, which does. So sharing
  // a PRIVATE List straight to a person (the Share dialog's whole purpose on a
  // List) produced a 404 page over APIs that would have answered 200. The page
  // and the endpoints now agree, by construction: one function, both sides.
  //
  // With ONE addition, because swapping predicates lost a reader in the other
  // direction: `canRead` reached FolderMember through its folder cascade and
  // `getBoardForReader` does not, so a granular folder grantee kept the
  // sidebar rows and the Folder page links into this List and got notFound()
  // on every one of them. `getBoardForReaderOrFolderGrantee` is the strict
  // predicate plus that one branch, so no destination a grant opened is closed.
  const readable = await getBoardForReaderOrFolderGrantee(board.id, u.id, u.accessLevel ?? "EMPLOYEE");
  if (!readable) notFound();

  const defaultView = views.find((v) => v.isDefault) ?? views[0];
  // Active view = ?view=<id> if it matches an existing view; else default.
  // Tab click is a Link that updates this param.
  const activeView =
    (sp.view ? views.find((v) => v.id === sp.view) : null) ?? defaultView;

  // THREE DIFFERENT QUESTIONS, THREE DIFFERENT GATES (audit High #2).
  //   canContribute  = may this person write CONTENT here (tasks, inline edits,
  //                    the "+ Task" primary)? That is `canContributeBoard`, and
  //                    it was `canEditSpace`, which is the MANAGE gate: a Space
  //                    Member who may create tasks was shown a read-only List,
  //                    and a Can view member was shown the blue "+ Task",
  //                    "Statuses", "Fields" and "+ View" on a List where every
  //                    one of those calls answers 403.
  //   canManage      = may they change the List itself (statuses, fields,
  //                    views, delete)? `canEditBoard`.
  //   canDeleteTasks = the same FULL gate DELETE ?hard=1 wants.
  //
  // The content flag is NOT called `canEdit` any more, on purpose. One name
  // covering "may write a task" and "may change the List" is what let the
  // management gate end up on the row controls in the first place.
  const [items, canContribute, canManage] = await Promise.all([
    listBoardItems(board.id),
    canContributeBoard(board.id, u.id, u.accessLevel ?? "EMPLOYEE"),
    canEditBoard(board.id, u.id, u.accessLevel ?? "EMPLOYEE"),
  ]);
  const canDeleteTasks = canManage;
  const initialFields = parseBoardSchema(board.schema).fields;
  // Per-List statuses (backbone #1) — the board's own set, or the
  // canonical default trio when Board.statuses is null.
  const statuses = getBoardStatuses(board);
  // Sprint identity (migration-free) — null for ordinary Lists.
  const sprint = parseSprintMeta(board.settings);

  return (
    <div className="flex flex-col h-full bg-app">
      {/* Location lives in the navy bar and nowhere else (principle 3). The
          in-page Space / Folder / Board row is gone; the crumbs it printed are
          declared here instead, so the bar finally names the Space, the Folder
          and this board. The Space link's destination is that Space crumb (and
          the Work sidebar's Space row); the Folder segment was a span, never a
          link, so no destination is lost. */}
      <Breadcrumb
        items={[
          { label: board.space.name, href: `/spaces/${board.space.slug}`, tile: { icon: board.space.icon, color: board.space.color, name: board.space.name } },
          // The Folder crumb was a span with no href while the Folder had its
          // own route all along (audit High #7's other half).
          ...(board.folder ? [{ label: board.folder.name, href: `/folders/${board.folder.id}` }] : []),
          { label: board.name },
        ]}
      />
      {/* Title row (48) per design-system section 4: back · tile · name · lock
          · Share · "…". The generic "Automate" link and the bare
          AskSidekickButton are gone: Automations is a menu row scoped to THIS
          List, and AI is the one slot the shell owns. */}
      <div className="flex h-12 items-center gap-2 px-6">
        <BackButton
          fallbackHref={board.folder ? `/folders/${board.folder.id}` : `/spaces/${board.space.slug}`}
          label={board.folder?.name ?? board.space.name}
          className="me-0.5"
        />
        <EntityTile
          size="lg"
          icon={board.icon}
          color={board.color}
          name={board.name}
          fallback="list"
        />
        <h1 className="inline-flex min-w-0 items-center gap-1.5 text-xl font-semibold text-ink">
          <span className="truncate" title={board.name}>{board.name}</span>
          {board.visibility === "PRIVATE" ? (
            <Lock className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-label="Restricted" />
          ) : null}
        </h1>

        {/* A refusal has to be readable. Without this, a Can view member met a
            List with no "+ Task", no row menus and no explanation, which reads
            as a broken page rather than as the access they were given. */}
        {!canContribute ? (
          <span
            className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-ink-3"
            title={`You have view access to ${board.name}. Ask a List or Space admin for Can edit to add or change tasks.`}
          >
            View only
          </span>
        ) : null}

        <div className="flex-1" />

        <ShareButton
          target={{
            kind: "list",
            id: board.id,
            name: board.name,
            visibility: board.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
            parentSpaceName: board.space.name,
          }}
          canManage={canManage}
        />
        <ContainerMenuTrigger
          container={{
            kind: "list",
            id: board.id,
            name: board.name,
            slug: board.slug,
            icon: board.icon ?? null,
            color: board.color ?? null,
            visibility: board.visibility as "PRIVATE" | "WORKSPACE" | "ORG",
            description: board.description,
            createdAt: board.createdAt.toISOString(),
            spaceId: board.space.id,
            spaceSlug: board.space.slug,
            spaceName: board.space.name,
            folderId: board.folder?.id ?? null,
            folderName: board.folder?.name ?? null,
            contents: `${items.length} task${items.length === 1 ? "" : "s"}`,
          }}
          role={canManage ? "full" : canContribute ? "edit" : "view"}
        />
      </div>

      {/* View tabs — clicking switches the active view via ?view=<id>.
          Phase 65: tabs were previously inert (always rendered default).

          `canManage` here is the CONTRIBUTE flag on purpose. A view is a saved
          filter, which is content, and the API already agreed: PATCH
          /api/boards/[id]/views/[viewId] gates on canContributeBoard, so a
          Board member could already rename a tab, re-order one and rewrite its
          config. Only CREATE sat on the management ladder, which is backwards
          in risk terms and is exactly the founder's "if I give some access to
          someone they are also not able to make some changes". DELETING a
          shared view stays on the management ladder, in canManageView, because
          that destroys other people's saved work. */}
      <BoardViewTabs
        views={views}
        boardId={board.id}
        boardSlug={board.slug}
        activeViewId={activeView?.id ?? null}
        defaultViewId={defaultView?.id ?? null}
        canManage={canContribute}
      />

      {/* Renderer — its single toolbar row (filters + Statuses/Fields + the
          "+ Task" passed below) is the one concise ClickUp-style toolbar. */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <BoardCanvas
          boardId={board.id}
          viewId={activeView?.id ?? null}
          viewType={activeView?.type ?? "TABLE"}
          viewConfig={(activeView?.config as Record<string, unknown> | null) ?? {}}
          initialItems={items}
          initialFields={initialFields}
          statuses={statuses}
          canContribute={canContribute}
          canManage={canManage}
          canDeleteTasks={canDeleteTasks}
          currentUserId={u.id}
          sprint={sprint}
          addTaskSlot={
            // The one blue primary, and only for people who can use it. It was
            // passed unconditionally, so a Can view member got a "+ Task"
            // button whose POST answers 403 (spec section 1, the read-only row
            // for /boards/[slug]: "the create primary absent").
            //
            // key: this server-created element lands inside BoardCanvas's
            // toolbar children array; RSC-deserialized elements skip jsx-time
            // key validation, so an explicit key keeps React's list check quiet.
            canContribute ? (
              <BoardAddTaskButton
                key="add-task"
                boardId={board.id}
                boardSlug={board.slug}
                boardName={board.name}
                spaceId={board.space.id}
              />
            ) : null
          }
          moduleGating={{
            priority: hasModule(board.space.settings, "PRIORITY"),
            tags: hasModule(board.space.settings, "TAGS"),
            timeTracking: hasModule(board.space.settings, "TIME_TRACKING"),
            customFields: hasModule(board.space.settings, "CUSTOM_FIELDS"),
          }}
        />
      </div>
    </div>
  );
}
