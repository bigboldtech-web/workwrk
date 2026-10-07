"use client";

// An AI teammate's tile (docs/plans/ai-teammates.md 5.1): the one EntityTile,
// filled with the teammate's hue (hues.ts hueColor, the --os-status-user-N
// token) with its avatar icon in white, or the first letter of its name. A
// teammate with no hue (an agent made before teammates, not from the
// catalog) wears the neutral tile.
//
//   xs 16   a group's stacked avatars (stacked-avatars.tsx)
//   sm 18   the thread, beside each answer
//   md 20   the chat header
//   lg 36   the list row

import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { hueColor, type TeammateHue } from "@/lib/agents/hues";
import { cn } from "@/lib/utils";

export function TeammateAvatar({
  name,
  hue,
  avatar,
  size,
  className,
}: {
  name: string;
  hue: TeammateHue | null;
  avatar: string | null;
  size: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <EntityTile
      size={size}
      name={name}
      icon={avatar}
      color={hue ? hueColor(hue) : NEUTRAL_TILE.color}
      className={cn(!hue && NEUTRAL_TILE.className, className)}
    />
  );
}
