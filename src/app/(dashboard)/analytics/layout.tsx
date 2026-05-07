import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
