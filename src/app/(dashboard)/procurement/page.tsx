// /procurement now redirects to the default board (Purchase orders). See
// src/lib/products/boards.ts for the workwrk-procurement board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function ProcurementIndexPage() {
  const board = getDefaultBoardKey("workwrk-procurement") ?? "pos";
  redirect(`/procurement/${board}`);
}
