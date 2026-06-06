// /tasks/personal-list — stub redirect to the My Tasks dashboard.
// Dedicated Personal List surface lands in a follow-up.

import { redirect } from "next/navigation";

export default function PersonalListPage(): never {
  redirect("/tasks");
}
