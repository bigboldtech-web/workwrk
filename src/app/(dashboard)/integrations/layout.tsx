import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
