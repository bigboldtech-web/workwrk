// The "you were given a goal" notice, for every door that gives someone a
// goal (POST /api/okrs, the Ask AI create tool), so the words and the link
// never drift apart between them.

import { prisma } from "@/lib/prisma";

export async function notifyGoalAssigned(userId: string, okr: { id: string; title: string }): Promise<void> {
  await prisma.notification
    .create({ data: { userId, type: "okr_assigned", title: "You were given a goal", message: okr.title, link: `/okrs/${okr.id}` } })
    .catch((err) => console.error("[OKR] Notification failed:", err));
}
