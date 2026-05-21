// /dev now redirects to the default board (Sprints). The product has
// been split into per-board routes (`/dev/sprints`, `/dev/releases`,
// `/dev/roadmap`) — see src/lib/products/boards.ts.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function DevIndexPage() {
  const board = getDefaultBoardKey("workwrk-dev") ?? "sprints";
  redirect(`/dev/${board}`);
}
