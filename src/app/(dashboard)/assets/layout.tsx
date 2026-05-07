import { requireManagerOrRedirect } from "@/lib/route-guard";

// /assets directory listing is manager-only. Employees can already
// see their assigned assets through their own profile (per the
// `assets.viewOwn: true` permission); a dedicated employee-facing
// `/my-assets` view can be added later if needed.
export default async function AssetsLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
