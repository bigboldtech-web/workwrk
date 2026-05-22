// /legal now redirects to the default board (Contracts). See
// src/lib/products/boards.ts for the workwrk-contracts board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function LegalIndexPage() {
  const board = getDefaultBoardKey("workwrk-contracts") ?? "contracts";
  redirect(`/legal/${board}`);
}
