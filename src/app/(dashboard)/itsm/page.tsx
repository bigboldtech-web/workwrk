// /itsm now redirects to the default board (Tickets). See
// src/lib/products/boards.ts for the workwrk-itsm board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function ItsmIndexPage() {
  const board = getDefaultBoardKey("workwrk-itsm") ?? "tickets";
  redirect(`/itsm/${board}`);
}
