// Root 404 (spec-shell 2.5): an unmatched path outside every route group.
// Signed-in app paths never reach it: (dashboard)/[...rest] catches every
// unknown path and renders the in-shell 404 inside the frame (or sends a
// signed-out person to /login with the path as callbackUrl), and the
// marketing host renders its own 404 through the proxy rewrite. What is
// left for this file is a notFound() thrown outside those groups (onboard,
// setup, the embeds). The same sentence as the in-shell page, "Log in" as
// its ONE link, no chrome, no hint about what the path was. Stays a server
// component so `metadata` keeps working.

import type { Metadata } from "next";
import Link from "next/link";
import { DotsArt } from "@/components/ui/dots-art";

export const metadata: Metadata = {
  title: "Not found · WorkwrK",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    // Inline colours on purpose: this page renders outside the dashboard
    // stylesheet, so no --os-* token reaches it (the same rule as
    // global-error.tsx). The values are the sRGB of the light tokens.
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px", background: "#FFFFFF", color: "#1F2430", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ display: "flex", maxWidth: 420, flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <DotsArt arrangement="row" stroke="#D0D5DD" sheet="#F6F7F9" />
        <p style={{ margin: "16px 0 0", fontSize: 15, lineHeight: "22px", color: "#5C6779" }}>We couldn&apos;t find that page</p>
        <div style={{ marginTop: 12, fontSize: 14, fontWeight: 500 }}>
          <Link href="/login" style={{ color: "#0B5FC2" }}>Log in</Link>
        </div>
      </div>
    </div>
  );
}
