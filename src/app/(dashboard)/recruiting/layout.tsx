import { requireManagerOrRedirect } from "@/lib/route-guard";

// ATS surfaces hold candidate PII. Manager+ only — same gate as
// /people. Public career page applications land in a separate
// unauthenticated route in v2.
export default async function RecruitingLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
