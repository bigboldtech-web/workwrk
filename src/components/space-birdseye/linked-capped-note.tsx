"use client";

// Said when a List has more tasks linked into it than Bird's eye shows
// (LINKED_CAP in src/lib/work/birdseye-linked.ts): the rest are on the List.

import Link from "next/link";
import type { BirdseyeList } from "@/lib/work/birdseye";

export function LinkedCappedNote({ list, className }: { list: Pick<BirdseyeList, "slug" | "name" | "linkedCapped">; className?: string }) {
  if (!list.linkedCapped) return null;
  return (
    <p className={className ?? "px-1 pt-2 text-xs leading-snug text-ink-3"}>
      Some tasks linked into {list.name} aren&rsquo;t shown here.{" "}
      <Link href={`/boards/${list.slug}`} className="font-medium text-brand-deep hover:underline">
        Open the List
      </Link>{" "}
      to see them all.
    </p>
  );
}
