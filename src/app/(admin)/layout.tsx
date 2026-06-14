// Server-side gate for the cross-tenant back-office (bbtadmin.workwrk.com).
//
// Platform STAFF only — resolved from the PlatformAdmin allowlist, NOT from
// tenant `User.accessLevel`. A customer's own SUPER_ADMIN is an admin of THEIR
// org, not of WorkwrK, and must never reach this surface or other tenants'
// data/ARR. The matching API routes (/api/admin/*) gate on the same check, so
// security does not depend on this UI layer alone.
//
// LOOP SAFETY: on the admin host the proxy bounces every non-/admin path back
// to /admin. So we must NEVER redirect to a relative app path from here —
// unauthenticated users go to the APP host login (absolute URL); non-staff get
// a rendered dead-end page, not a redirect.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminSession } from "@/lib/platform-admin";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");

  if (!session?.user) {
    redirect(appUrl ? `${appUrl}/login` : "/login");
  }

  const allowed = await isPlatformAdminSession(session);
  if (!allowed) {
    const email = (session.user as { email?: string | null }).email ?? "unknown";
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Restricted — WorkwrK staff only
          </h1>
          <p style={{ fontSize: 14, color: "#a0a0a0", lineHeight: 1.55, margin: "0 0 10px" }}>
            This back-office is limited to the WorkwrK platform-staff allowlist.
          </p>
          <p style={{ fontSize: 13, color: "#808080", margin: "0 0 22px" }}>
            Signed in as <span style={{ color: "#d4ff2e" }}>{email}</span>
          </p>
          {appUrl ? (
            <a href={appUrl} style={{ color: "#fafafa", fontSize: 13, textDecoration: "underline" }}>
              ← Back to the app
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  const email = (session.user as { email?: string | null }).email ?? null;
  return <AdminShell email={email}>{children}</AdminShell>;
}
