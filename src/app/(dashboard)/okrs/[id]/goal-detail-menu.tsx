"use client";

// The goal page's title-row "..." (spec-goals /okrs/[id]): Edit goal ·
// Assign owner · Copy link · Mark complete · Delete goal, each rendered only
// when the API allows it (GoalRowMoreMenu, the same menu as the /okrs rows).
// Right-click on the Summary card (any element carrying data-goal-hero)
// opens the same menu at the pointer. After a delete the router goes to the
// view the back button names (`afterDelete`), never a bare /okrs.
//
// Also exports GoalEditLink, a text link that opens the Edit modal (the
// Details row's Part of "Add" and the summary's "Add a description", and,
// with `initialRepeat`, the Dates row's "Make this a monthly goal",
// docs/plans/recurring-goals.md A5).
//
// A repeating goal's menu carries Stop repeating (then Keep repeating, and
// Repeat again once it ended) in the Mark complete slot and a delete
// confirm that names its closed periods (A4, final review M6).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import { CreateGoalModal, type EditableGoal, type RepeatContext } from "@/components/okrs/create-goal-modal";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";
import type { RepeatingRowFacts } from "@/lib/goals/goal-form";
import type { GoalCadence } from "@/lib/goals/goal-period";

export function GoalDetailMenu({ goal, canDelete, canEdit, canAssignOwner, completed, afterDelete, repeating = null, recurring = null }: {
  goal: EditableGoal;
  canDelete: boolean;
  canEdit: boolean;
  canAssignOwner: boolean;
  completed: boolean;
  afterDelete: string;
  /** A repeating goal's facts for Stop repeating and the delete confirm. */
  repeating?: (RepeatingRowFacts & { closedPeriods?: number }) | null;
  /** The switch and the workspace's period settings, for the Edit modal. */
  recurring?: RepeatContext | null;
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
        repeating={repeating}
        recurringOn={recurring?.on === true}
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
          recurring={recurring}
          focusOwner={editing.focusOwner}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

export function GoalEditLink({ goal, label, focusParent = false, initialRepeat = null, recurring = null }: {
  goal: EditableGoal;
  label: string;
  focusParent?: boolean;
  /** Open Edit with Repeating chosen at this cadence (A5). */
  initialRepeat?: GoalCadence | null;
  recurring?: RepeatContext | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-row text-brand-deep hover:underline">{label}</button>
      {open ? (
        <CreateGoalModal key={`${goal.id}-edit-link`} open level={goal.level} goal={goal} focusParent={focusParent}
          initialRepeat={initialRepeat} recurring={recurring}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />
      ) : null}
    </>
  );
}
