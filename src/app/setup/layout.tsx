"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "@/app/(dashboard)/app-shell.css";

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  if (status === "loading") {
    return (
      <div className="app-loader">
        <span className="app-loader-dot" aria-hidden />
        <span className="app-loader-text">Loading workspace</span>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <div
      className="app-shell"
      style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}
    >
      {/* Ambient background glow */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "-20%",
            left: "-5%",
            width: 520,
            height: 520,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(212,255,46,0.15), transparent 70%)",
            filter: "blur(120px)",
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: "-25%",
            right: "-10%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(74,158,255,0.12), transparent 70%)",
            filter: "blur(120px)",
          }}
        />
      </div>

      {/* Header */}
      <header
        style={{
          position: "relative",
          zIndex: 1,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(10,10,10,0.75)",
          backdropFilter: "blur(16px) saturate(1.1)",
          WebkitBackdropFilter: "blur(16px) saturate(1.1)",
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: "0 auto",
            padding: "18px 32px",
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
              color: "#fafafa",
              textDecoration: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: "#d4ff2e",
                boxShadow: "0 0 12px #d4ff2e",
              }}
            />
            workwrk
          </Link>
          <span
            style={{
              marginLeft: 8,
              paddingLeft: 16,
              borderLeft: "1px solid rgba(255,255,255,0.12)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "#707070",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Setup your workspace
          </span>
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1040,
          margin: "0 auto",
          padding: "40px 32px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
