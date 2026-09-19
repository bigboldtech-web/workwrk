// The /analytics gate.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics):
// "the layout's `requireManagerOrRedirect` becomes `gatePage("view", { type:
// "app", key: "analytics" })`, which 404s in the shell instead of bouncing to
// `/dashboard`".
//
// The old guard asked `isManager`, a hard-coded array of eight access-level
// strings. This asks the access model the one question it has an answer for:
// the `analytics` app key, whose audience (access 5.2.1) is anyone with reports
// over their chain, the People team, Owner and Admin, and never Guests.
//
// A viewer who fails an app rule gets the shell's in-frame 404, never a
// LockedPage: LockedPage always carries "Request access" and belongs to a
// discoverable object with an owner, and there is nobody to ask for a manager
// chain.

import { gatePage } from "@/lib/access/gate";
import { notFound } from "next/navigation";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const { viewer } = await gatePage("view", { type: "app", key: "analytics" }, { callbackUrl: "/analytics" });
  if (viewer.orgRole === "GUEST") notFound();
  return <>{children}</>;
}
