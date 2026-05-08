import { requireManagerOrRedirect } from "@/lib/route-guard";

// Audit trail is manager+. Senior managers and HR look here when
// answering compliance questions; org admins see the same view
// (no extra restrictions in v1).
export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOrRedirect();
  return <>{children}</>;
}
