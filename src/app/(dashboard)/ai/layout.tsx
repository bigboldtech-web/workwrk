import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function AILayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
