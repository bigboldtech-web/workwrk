// /tasks/assigned-to-me — stub redirect to the My Tasks dashboard.
// ClickUp parity: the sidebar exposes this as its own destination but
// for v1 it lands on the main My Tasks page where the "Assigned to me"
// card is already populated by /api/me/items. A dedicated full-page
// list will land in a follow-up slice.

import { redirect } from "next/navigation";

export default function AssignedToMePage(): never {
  redirect("/tasks");
}
