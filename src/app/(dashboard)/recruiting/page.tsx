// /recruiting now redirects to the default board (Jobs). See
// src/lib/products/boards.ts for the workwrk-recruit board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function RecruitingIndexPage() {
  const board = getDefaultBoardKey("workwrk-recruit") ?? "jobs";
  redirect(`/recruiting/${board}`);
}
