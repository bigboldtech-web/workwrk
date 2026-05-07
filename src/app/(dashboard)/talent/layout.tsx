import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function TalentLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
