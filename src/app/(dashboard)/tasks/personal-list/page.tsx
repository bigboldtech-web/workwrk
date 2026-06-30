// Personal List — now a real Item-backed board rendered through the exact same
// BoardCanvas / board-table-view as every other List (one component, one model).
// It's a per-user, space-less PRIVATE board (productSlug="personal-list").

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Lock } from "lucide-react";
import { getOrCreatePersonalBoard } from "@/lib/board";
import { getBoardStatuses, listBoardItems } from "@/lib/board-items";
import { parseBoardSchema } from "@/lib/field-catalog";
import { BoardViewTabs } from "../../boards/[slug]/board-view-tabs";
import { BoardCanvas } from "@/components/board-view/board-canvas";
import { BoardAddTaskButton } from "@/components/board-view/board-add-task-button";

export const dynamic = "force-dynamic";

export default async function PersonalListPage(props: {
  searchParams: Promise<{ view?: string; item?: string }>;
}) {
  const sp = await props.searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const board = await getOrCreatePersonalBoard(u.organizationId, u.id);
  const views = await prisma.view.findMany({
    where: { boardId: board.id },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  const defaultView = views.find((v) => v.isDefault) ?? views[0];
  const activeView = (sp.view ? views.find((v) => v.id === sp.view) : null) ?? defaultView;

  const items = await listBoardItems(board.id);
  const initialFields = parseBoardSchema(board.schema).fields;
  const statuses = getBoardStatuses(board);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb — personal, no Space */}
      <div className="px-4 pt-1.5 pb-1 flex items-center gap-1">
        <span className="text-[14px] text-zinc-500">My Wrk</span>
        <span className="text-zinc-300 text-[14px] px-0.5">/</span>
        <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
          <Lock className="w-4 h-4 text-zinc-500" />
          <span className="truncate">Personal List</span>
        </h1>
      </div>

      <BoardViewTabs
        views={views}
        boardId={board.id}
        boardSlug={board.slug}
        activeViewId={activeView?.id ?? null}
        defaultViewId={defaultView?.id ?? null}
        basePath="/tasks/personal-list"
      />

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <BoardCanvas
          boardId={board.id}
          viewId={activeView?.id ?? null}
          viewType={activeView?.type ?? "TABLE"}
          viewConfig={(activeView?.config as Record<string, unknown> | null) ?? {}}
          initialItems={items}
          initialFields={initialFields}
          statuses={statuses}
          canEdit={true}
          currentUserId={u.id}
          addTaskSlot={
            <BoardAddTaskButton
              boardId={board.id}
              boardSlug={board.slug}
              boardName={board.name}
              spaceId={null}
            />
          }
        />
      </div>
    </div>
  );
}
