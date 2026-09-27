"use client";

// The goal page's title-row "..." (spec-goals /okrs/[id]): Edit goal ·
// Assign owner · Copy link · Mark complete · Delete goal, each rendered only
// when the API allows it (GoalRowMoreMenu, the same menu as the /okrs rows).
// Right-click on the Summary card (any element carrying data-goal-hero)
// opens the same menu at the pointer. After a delete the router goes to the
// view the back button names (`afterDelete`), never a bare /okrs.
//
// Also exports GoalEditLink, a text link that opens the Edit modal (the
// Details row's Part of "Add" and the summary's "Add a description").

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { CreateGoalModal, type EditableGoal } from "@/components/okrs/create-goal-modal";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";

export function GoalDetailMenu({ goal, canDelete, canEdit, canAssignOwner, completed, afterDelete }: {
  goal: EditableGoal;
  canDelete: boolean;
  canEdit: boolean;
  canAssignOwner: boolean;
  completed: boolean;
  afterDelete: string;
}) {
  const router = useRouter();
  const menuRef = useRef<ContextMenuHandle>(null);
  const [editing, setEditing] = useState<{ focusOwner?: boolean } | null>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-goal-hero]")) return;
      if (t.closest("a, button, input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      menuRef.current?.openAtPoint(e.clientX, e.clientY);
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  return (
    <>
      <GoalRowMoreMenu
        ref={menuRef}
        goal={{ id: goal.id, title: goal.title }}
        canDelete={canDelete}
        canEdit={canEdit}
        canAssignOwner={canAssignOwner}
        completed={completed}
        showOpen={false}
        onEdit={(opts) => setEditing({ focusOwner: opts?.focusOwner })}
        onChanged={() => router.refresh()}
        onDeleted={() => { router.push(afterDelete); router.refresh(); }}
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
    </>
  );
}

export function GoalEditLink({ goal, label, focusParent = false }: { goal: EditableGoal; label: string; focusParent?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-row text-brand-deep hover:underline">{label}</button>
      {open ? (
        <CreateGoalModal key={`${goal.id}-edit-link`} open level={goal.level} goal={goal} focusParent={focusParent}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />
      ) : null}
    </>
  );
}
