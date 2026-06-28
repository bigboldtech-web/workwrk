// /calendar is retired. The calendar is now the personal Planner (time-grid)
// at /planner; team visibility lives in each Space's Team view, so the old
// My/Team/By-person calendar is gone. Redirect any old links to the Planner.

import { redirect } from "next/navigation";

export default function CalendarRedirect() {
  redirect("/planner");
}
