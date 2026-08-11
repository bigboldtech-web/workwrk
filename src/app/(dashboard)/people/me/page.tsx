// /people/me — the employee door. Every user, whatever their access
// level, has this stable personal URL to their own career home: my job
// title and JD, my inherited KRAs with my KPI readings, my goals, my
// reviews, my assets. One canonical profile surface — this route only
// resolves the session and forwards to /people/[id] in self mode.

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const user = await requireSessionUser();
  redirect(`/people/${user.id}`);
}
