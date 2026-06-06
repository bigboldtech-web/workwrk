// /tasks/today-overdue — stub redirect to the My Tasks dashboard.
// Dedicated full-page Today + Overdue list lands in a follow-up.

import { redirect } from "next/navigation";

export default function TodayOverduePage(): never {
  redirect("/tasks");
}
