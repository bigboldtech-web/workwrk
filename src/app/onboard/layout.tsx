"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "@/app/(dashboard)/app-shell.css";

// Onboarding v2 layout — same auth gating as /setup but designed for
// the new Phase B3 wizard. Light background, centered content, no
// header text (the step component owns its own heading).

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
      <div className="app-loader">
        <span className="app-loader-dot" aria-hidden />
        <span className="app-loader-text">Loading…</span>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <div className="app-shell" style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Ambient background glow — muted vs /setup which uses lime */}
      <div
        aria-hidden
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}
      >
        <span
          style={{
            position: "absolute",
            top: "-15%",
            left: "10%",
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(167,139,250,0.20), transparent 70%)",
            filter: "blur(120px)",
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: "-20%",
            right: "5%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(244,114,182,0.15), transparent 70%)",
            filter: "blur(120px)",
          }}
        />
      </div>

      <header
        style={{
          position: "relative",
          zIndex: 1,
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(16px) saturate(1.1)",
          WebkitBackdropFilter: "blur(16px) saturate(1.1)",
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "16px 32px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#1a1a1a",
              textDecoration: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: "#7c3aed",
                boxShadow: "0 0 8px rgba(124,58,237,0.5)",
              }}
            />
            workwrk
          </Link>
        </div>
      </header>

      <main
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1080,
          margin: "0 auto",
          padding: "60px 32px 80px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
