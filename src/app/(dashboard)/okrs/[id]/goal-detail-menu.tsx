"use client";

// GoalDetailMenu — the "…" overflow + right-click affordance in the goal
// detail header. Reuses the same GoalRowMoreMenu the OKRs list uses; on a
// successful delete it routes back to /okrs (the goal no longer exists).
// Right-click anywhere on the header (except links/buttons/inputs) opens the
// same menu at the cursor, mirroring the list card's context menu.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { GoalRowMoreMenu } from "@/components/okrs/goal-row-more-menu";
import type { ContextMenuHandle } from "@/components/layout/os/more-portal";

export function GoalDetailMenu({ goalId, title, canDelete }: {
  goalId: string;
  title: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const menuRef = useRef<ContextMenuHandle>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!canDelete) return;
    const head = rootRef.current?.closest(".okrd__head") as HTMLElement | null;
    if (!head) return;
    const onCtx = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a, button, input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      menuRef.current?.openAtPoint(e.clientX, e.clientY);
    };
    head.addEventListener("contextmenu", onCtx);
    return () => head.removeEventListener("contextmenu", onCtx);
  }, [canDelete]);

  if (!canDelete) return null;

  return (
    <span ref={rootRef} className="okrd__menu">
      <GoalRowMoreMenu
        ref={menuRef}
        goal={{ id: goalId, title }}
        canDelete={canDelete}
        onDeleted={() => { router.push("/okrs"); router.refresh(); }}
        triggerClassName="okrd__menu-btn"
      />
    </span>
  );
}
