"use client";

// GoalDetailMenu — the "…" overflow + right-click affordance in the goal
// detail header. Reuses the same GoalRowMoreMenu the OKRs list uses (Open is
// hidden — you're already here) and hosts the shared create/edit goal modal
// so Edit / Assign owner work from the detail page too. On a successful
// delete it routes back to /okrs; after an edit it router.refresh()es so the
// server-rendered header repaints with the new values. Right-click anywhere
// on the header (except links/buttons/inputs) opens the same menu at the
// cursor, mirroring the list card's context menu.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { CreateGoalModal, type EditableGoal } from "@/components/okrs/create-goal-modal";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";

export function GoalDetailMenu({ goal, canDelete, canEdit }: {
  goal: EditableGoal;
  /** canDeleteGoal — mirrors DELETE /api/okrs/[id]. */
  canDelete: boolean;
  /** canEditOkrOwner — mirrors PATCH /api/okrs. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const menuRef = useRef<ContextMenuHandle>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState<{ focusOwner?: boolean } | null>(null);

  useEffect(() => {
    const head = rootRef.current?.closest(".okrd__head") as HTMLElement | null;
    if (!head) return;
    const onCtx = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a, button, input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      menuRef.current?.openAtPoint(e.clientX, e.clientY);
    };
    head.addEventListener("contextmenu", onCtx);
    return () => head.removeEventListener("contextmenu", onCtx);
  }, []);

  return (
    <span ref={rootRef} className="okrd__menu">
      <GoalRowMoreMenu
        ref={menuRef}
        goal={{ id: goal.id, title: goal.title }}
        canDelete={canDelete}
        canEdit={canEdit}
        showOpen={false}
        onEdit={(opts) => setEditing({ focusOwner: opts?.focusOwner })}
        onDeleted={() => { router.push("/okrs"); router.refresh(); }}
        triggerClassName="okrd__menu-btn"
      />
      {editing !== null && (
        <CreateGoalModal
          key={goal.id}
          open
          level={goal.level}
          goal={goal}
          focusOwner={editing.focusOwner}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </span>
  );
}
