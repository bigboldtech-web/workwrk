// /financials now redirects to the default board (Chart of accounts). See
// src/lib/products/boards.ts for the workwrk-books board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function FinancialsIndexPage() {
  const board = getDefaultBoardKey("workwrk-books") ?? "accounts";
  redirect(`/financials/${board}`);
}
