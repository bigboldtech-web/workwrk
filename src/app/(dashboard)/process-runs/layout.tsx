import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function ProcessRunsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
