import { requireManagerOr404 } from "@/lib/route-guard";

export default async function ProcessRunsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOr404();
  return <>{children}</>;
}
