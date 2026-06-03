"use client";

// BoardCanvas — the client wrapper that picks a view renderer, mounts
// the shared BoardItemDrawer, and owns the FieldShelf state. Sits
// inside the server-rendered /boards/[slug] page so the page can stay
// SSR while all interactivity (drawer state, field shelf, row clicks)
// lives here.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import type { ViewType } from "@/generated/prisma";
import type { BoardItemRow } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { BoardTableView } from "./board-table-view";
import { BoardKanbanView } from "./board-kanban-view";
import { BoardItemDrawer } from "./board-item-drawer";
import { FieldShelf } from "./field-shelf";

interface BoardCanvasProps {
  boardId: string;
  viewType: ViewType;
  initialItems: BoardItemRow[];
  initialFields: FieldDef[];
  canEdit: boolean;
  /** Threaded through to the drawer so the comments thread can gate
   *  "delete my own comment" without an extra session fetch. */
  currentUserId: string | null;
}

export function BoardCanvas({ boardId, viewType, initialItems, initialFields, canEdit, currentUserId }: BoardCanvasProps) {
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  // Local mirrors so drawer/shelf edits sync into the active renderer
  // without a full router.refresh().
  const [items, setItems] = useState<BoardItemRow[]>(initialItems);
  const [fields, setFields] = useState<FieldDef[]>(initialFields);

  const handleItemChanged = useCallback((updated: BoardItemRow) => {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }, []);

  const handleItemArchived = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    setOpenItemId(null);
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShelfOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Fields {fields.length > 0 ? <span className="text-xs text-zinc-500">({fields.length})</span> : null}
        </button>
      </div>

      {viewType === "TABLE" ? (
        <BoardTableView
          boardId={boardId}
          initialItems={items}
          initialFields={fields}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : viewType === "KANBAN" ? (
        <BoardKanbanView
          boardId={boardId}
          initialItems={items}
          canEdit={canEdit}
          onOpenItem={(id) => setOpenItemId(id)}
        />
      ) : (
        <div className="border border-zinc-200 rounded-xl px-8 py-16 text-center bg-white">
          <div className="text-base font-medium mb-1">
            {viewType} renderer coming next
          </div>
          <p className="text-sm text-zinc-500 max-w-[460px] mx-auto">
            TABLE and KANBAN are live; CALENDAR / GANTT / FORM / TIMELINE / WORKLOAD / MAP / DOC / DASHBOARD follow.
            Add a List or Board view via the "+ View" tab to use the rendered surface today.
          </p>
        </div>
      )}

      <BoardItemDrawer
        itemId={openItemId}
        canEdit={canEdit}
        currentUserId={currentUserId}
        fields={fields}
        onClose={() => setOpenItemId(null)}
        onItemChanged={handleItemChanged}
        onItemArchived={handleItemArchived}
      />

      <FieldShelf
        boardId={boardId}
        open={shelfOpen}
        canEdit={canEdit}
        fields={fields}
        onClose={() => setShelfOpen(false)}
        onFieldsChanged={setFields}
      />
    </>
  );
}
