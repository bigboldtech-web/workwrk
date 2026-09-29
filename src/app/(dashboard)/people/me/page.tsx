// /people/me, the employee door. Every user, whatever their access
// level, has this stable personal URL to their own career home: my job
// title and JD, my inherited KRAs with my KPI readings, my goals, my
// reviews, my assets. One canonical profile surface, this route only
// resolves the session and forwards to /people/[id] in self mode.

import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  // Carry the query across the redirect: /people/me?tab=kras is the
  // contract the Work sidebar's "My KRAs & KPIs" row and the KPI Inbox rows
  // link to (spec-goals section 2 `/people/me?tab=kras`), and
  // /people/me?tab=assets opens a Member's own kit (spec-tools-misc 2.2); a
  // dropped ?tab= would land either on the wrong tab.
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) for (const x of v) qs.append(k, x);
  }
  const q = qs.toString();
  redirect(`/people/${user.id}${q ? `?${q}` : ""}`);
}
