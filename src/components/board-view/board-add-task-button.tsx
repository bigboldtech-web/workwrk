"use client";

// BoardAddTaskButton — the "+ Task" button on the board page toolbar.
// Opens the shell-level CreateTaskModal with this board preselected as
// the destination list (the page itself is a server component, so this
// tiny island bridges to the shell context).

import { Plus } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

interface BoardAddTaskButtonProps {
  boardId: string;
  boardSlug: string;
  boardName: string;
  spaceId: string | null;
}

export function BoardAddTaskButton({ boardId, boardSlug, boardName, spaceId }: BoardAddTaskButtonProps) {
  const { openCreateTask } = useOsShell();
  return (
    <button
      type="button"
      onClick={() => openCreateTask({ id: boardId, slug: boardSlug, name: boardName, spaceId })}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-white"
      style={{ background: "var(--os-brand)" }}
      title="Add task"
    >
      <Plus className="w-3.5 h-3.5" />
      Task
    </button>
  );
}
