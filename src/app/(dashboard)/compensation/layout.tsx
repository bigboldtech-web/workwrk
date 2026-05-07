import { requireManagerOrRedirect } from "@/lib/route-guard";

// Compensation surfaces are manager+ only — comp data is the most
// sensitive record class in the org. Subject self-view (my-pay) lands
// in a separate route later, scoped to the current user's APPROVED
// row only.
export default async function CompensationLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
