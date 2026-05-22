// /planning now redirects to the default board (Plans). See
// src/lib/products/boards.ts for the workwrk-fpa board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function PlanningIndexPage() {
  const board = getDefaultBoardKey("workwrk-fpa") ?? "plans";
  redirect(`/planning/${board}`);
}
