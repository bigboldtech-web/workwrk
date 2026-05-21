// /marketing now redirects to the default board (Campaigns). See
// src/lib/products/boards.ts for the workwrk-campaigns board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function MarketingIndexPage() {
  const board = getDefaultBoardKey("workwrk-campaigns") ?? "campaigns";
  redirect(`/marketing/${board}`);
}
