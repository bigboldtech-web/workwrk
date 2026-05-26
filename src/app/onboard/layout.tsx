"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
// Reuse the dashboard's OS design tokens. Importing the stylesheet
// brings in every `.workwrk-os` / `.os-*` class — we wrap the page in
// `.workwrk-os` below to scope them.
import "@/app/(dashboard)/os.css";

export default function OnboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", gap: 10,
          background: "#FFFFFF", color: "#676879", fontFamily: "Figtree, sans-serif", fontSize: 13,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#0073EA", animation: "osPulse 1.2s ease-in-out infinite" }} />
        <span>Loading…</span>
        <style>{`@keyframes osPulse { 0%,100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }`}</style>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <div className="workwrk-os">
      <div className="os-onboard">
        <header className="os-onboard__nav">
          <div className="os-onboard__nav-inner">
            <Link href="/today" className="os-onboard__logo">
              <span className="os-onboard__logo-mark" aria-hidden>w</span>
              <span>workwrk</span>
            </Link>
            <Link href="/today" className="os-onboard__nav-skip">
              Skip for now
            </Link>
          </div>
        </header>

        <main className="os-onboard__main">
          {children}
        </main>
      </div>
    </div>
  );
}
