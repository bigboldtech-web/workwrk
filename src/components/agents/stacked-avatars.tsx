"use client";

// A group chat's teammates as one mark (docs/plans/ai-teammates-phase2.md
// step 4), with a ring in the surface colour so each tile's edge reads.
//
//   row     the list row's 36px box: two 20px tiles corner to corner (the
//           first top-start, the second bottom-end), or three 16px tiles in
//           a triangle, so every tile shows most of itself
//   header  the 44px chat header: up to three 20px tiles in a line, each
//           over the one before by 6px

import type { GroupMemberView } from "@/lib/agents/teammate-thread";
import { cn } from "@/lib/utils";
import { TeammateAvatar } from "./teammate-avatar";

const SHOWN = 3;

/** Where each tile sits in the row's 36px box, by how many there are. */
const ROW_SPOTS: Record<number, string[]> = {
  1: ["start-[8px] top-[8px]"],
  2: ["start-0 top-0", "end-0 bottom-0"],
  3: ["start-0 top-[2px]", "end-0 top-[2px]", "start-[10px] bottom-0"],
};

export function StackedAvatars({ members, variant, className }: { members: readonly GroupMemberView[]; variant: "row" | "header"; className?: string }) {
  const shown = members.slice(0, SHOWN);
  if (variant === "row") {
    const spots = ROW_SPOTS[shown.length] ?? [];
    const size = shown.length >= 3 ? "xs" : "md";
    return (
      <span className={cn("relative h-9 w-9 shrink-0", className)} aria-hidden>
        {shown.map((m, i) => (
          <span key={m.agentId} className={cn("absolute flex rounded-md ring-2 ring-app", spots[i])}>
            <TeammateAvatar name={m.name} hue={m.hue} avatar={m.avatar} size={size} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center", className)} aria-hidden>
      {shown.map((m, i) => (
        <span key={m.agentId} className={cn("flex rounded-md ring-2 ring-app", i > 0 && "-ms-1.5")}>
          <TeammateAvatar name={m.name} hue={m.hue} avatar={m.avatar} size="md" />
        </span>
      ))}
    </span>
  );
}
