import { requireManagerOrRedirect } from "@/lib/route-guard";

// Workforce planning surfaces salary budget data — manager+ only.
// Editing plans is admin-only via the API guard.
export default async function WorkforcePlanningLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
