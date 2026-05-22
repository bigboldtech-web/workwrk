// /helpdesk now redirects to the default board (Tickets). See
// src/lib/products/boards.ts for the workwrk-help board list.

import { redirect } from "next/navigation";
import { getDefaultBoardKey } from "@/lib/products/boards";

export default function HelpdeskIndexPage() {
  const board = getDefaultBoardKey("workwrk-help") ?? "tickets";
  redirect(`/helpdesk/${board}`);
}
