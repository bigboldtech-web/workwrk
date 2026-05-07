import { requireManagerOrRedirect } from "@/lib/route-guard";

export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
