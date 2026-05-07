import { requireManagerOrRedirect } from "@/lib/route-guard";

// Onboarding management (templates, instances, course authoring) is
// manager-only per spec. If we later expose an "as the new hire"
// employee-facing onboarding view, that would live elsewhere or
// move out of this layout's scope.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
