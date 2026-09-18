"use client";

// The (dashboard) frame's boot (spec-shell 1.12, 1.7, 2.1).
//
// One call after the session resolves: GET /api/boot. It carries the viewer,
// the visible hubs, the effective preferences, the org culture, the counts,
// the running timer and `setupCompleted`, so the frame paints with the right
// density, chrome and rail on its first frame and nothing below it has to
// fetch its own copy at boot.
//
// Exactly two redirects live here, both about who you are: no session sends
// you to /login?callbackUrl=<current>, and a signed-in person whose org has
// not finished setup goes to /onboard. A failed boot is neither: it renders
// the boot ErrorState on navy with Try again and Log out, and it never
// silently treats itself as "setup complete" the way the old /api/setup
// branch did.

import { OsShell } from "@/components/layout/os/os-shell";
import { BootProvider, type BootPayload } from "@/components/layout/os/boot-context";
import { ToastProvider } from "@/components/ui/toast";
import { DialogProvider } from "@/components/ui/dialog-provider";
import { TourProvider } from "@/components/tour-provider";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { APP_ROOT_ID, SessionExpiredDialog, SessionIdleWarning } from "@/components/layout/os/session-expired-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { currentLoginUrl } from "@/lib/session-expiry";
import "./os.css";

// The boot ground is the navy chrome colour in every chrome variant
// (design-system 5.15): the splash fades out over the same navy, so the
// frame "opens onto the work" with no second colour in between.
const BOOT_BG = "var(--os-nv900, #1B2537)";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [boot, setBoot] = useState<BootPayload | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showMark, setShowMark] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      // Spec-shell 1.10 rule 2: keep where the person was. The login page
      // reads `callbackUrl` and returns there after sign-in.
      router.push(currentLoginUrl());
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let alive = true;
    void apiFetch<BootPayload>("/api/boot", { cache: "no-store" }).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        // 401 has already been announced by apiFetch (the Session-expired
        // dialog owns the screen); anything else is the boot ErrorState.
        if (r.status !== 401) setBootError(r.error || "Couldn't open WorkwrK");
        return;
      }
      if (!r.data.setupCompleted) {
        router.push("/onboard");
        return;
      }
      setBoot(r.data);
    });
    return () => {
      alive = false;
    };
  }, [status, router, attempt]);

  // The old `dark-forced` class and the localStorage density are gone; the
  // preferences arrive with boot and ThemeApplier writes the attributes.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark-forced");
    }
  }, []);

  const ready = status === "authenticated" && boot !== null;

  // The four-dot mark appears only after 200ms of pending, so a fast boot
  // never flashes a loader (design-system 5.15).
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setShowMark(true), 200);
    return () => clearTimeout(t);
  }, [ready]);

  const retry = useCallback(() => {
    setBootError(null);
    setAttempt((n) => n + 1);
  }, []);

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <DialogProvider>
        <TourProvider>
          {/* #app-root is what the Session-expired dialog makes inert
              (spec-shell 2.15); the dialog itself portals outside it. */}
          <div id={APP_ROOT_ID} style={{ display: "contents" }}>
            {ready ? (
              <BootProvider boot={boot}>
                <OsShell>{children}</OsShell>
              </BootProvider>
            ) : (
              <BootScreen error={bootError} showMark={showMark} onRetry={retry} />
            )}
          </div>
          <SessionExpiredDialog />
          <SessionIdleWarning />
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}

// The boot screen: navy, then the logo mark pulsing after 200ms, or the
// ErrorState when /api/boot failed (spec-shell 1.7 "Shell chrome failures").
// Inline styles on purpose: nothing from the frame has painted yet.
function BootScreen({ error, showMark, onRetry }: { error: string | null; showMark: boolean; onRetry: () => void }) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-label={error ? undefined : "Loading"}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BOOT_BG,
        color: "#FFFFFF",
        fontFamily: "var(--os-font, Inter, sans-serif)",
      }}
    >
      {error ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", maxWidth: 360, padding: 24 }}>
          <Logo width={28} />
          <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: "22px", color: "rgba(255,255,255,0.92)" }}>
            Couldn&apos;t open WorkwrK
          </p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: "18px", color: "rgba(255,255,255,0.64)" }}>{error}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
            <button
              type="button"
              onClick={onRetry}
              style={{
                height: 36,
                padding: "0 16px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.24)",
                background: "rgba(255,255,255,0.10)",
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => { void signOut({ callbackUrl: "/login" }); }}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.72)", fontSize: 14, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Log out
            </button>
          </div>
        </div>
      ) : showMark ? (
        <Logo width={28} pulsing title="Loading" />
      ) : null}
    </div>
  );
}
