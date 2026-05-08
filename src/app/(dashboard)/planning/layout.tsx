import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Adaptive Planning is org-admin only — exposes proposed budget
// numbers ahead of approval. Future role tier ("Finance") might
// open it more granularly.
export default async function PlanningLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
