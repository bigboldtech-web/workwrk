"use client";

import { OsShell } from "@/components/layout/os/os-shell";
import { ToastProvider } from "@/components/ui/toast";
import { DialogProvider } from "@/components/ui/dialog-provider";
import { ScreenProtection } from "@/components/security/screen-protection";
import { TourProvider } from "@/components/tour-provider";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { applyDensity, getInitialDensity } from "@/lib/density";
import { DotsLoader } from "@/components/brand/dots-loader";
import { MissionSplash } from "@/components/brand/mission-splash";
import { APP_ROOT_ID, SessionExpiredDialog, SessionIdleWarning } from "@/components/layout/os/session-expired-dialog";
import { apiFetch } from "@/lib/api-fetch";
import { currentLoginUrl } from "@/lib/session-expiry";
import "./os.css";

// The dark ground the boot backdrop and MissionSplash share, so the splash
// fades IN over the same colour — no flash of a different loader beneath it.
const BOOT_BG = "radial-gradient(120% 120% at 50% 0%, #22345A 0%, #16233E 55%, #0F1B31 100%)";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [setupChecked, setSetupChecked] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

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
    // Today's first boot call, kept until Phase 1 switches to /api/boot, but
    // through apiFetch: a 401 now surfaces the Session-expired dialog (it
    // used to fall through to /onboard because the HTTP status was never
    // checked). Only a real `setupCompleted: false` answer sends anyone to
    // /onboard. What is NOT yet spec 1.12: a non-401 failure is still
    // treated as "setup complete" exactly as the old catch branch did; the
    // boot ErrorState for that case arrives with the /api/boot switch-over.
    void apiFetch<{ setupCompleted?: boolean }>("/api/setup").then((r) => {
      if (!alive) return;
      if (!r.ok) {
        if (r.status !== 401) setSetupChecked(true);
        return;
      }
      if (r.data && r.data.setupCompleted === false) {
        router.push("/onboard");
      } else {
        setSetupChecked(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [status, router]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark-forced");
    }
    applyDensity(getInitialDensity());
  }, []);

  const ready = status === "authenticated" && setupChecked;

  // Only reveal the little dots as a FALLBACK, and only after a beat: on a
  // normal boot the mission/values splash appears first, so the dots never
  // show (no more dots-screen-THEN-mission double). They surface only if boot
  // runs long, or if the org has no mission/values so the splash stays empty.
  useEffect(() => {
    if (ready) {
      setShowFallback(false);
      return;
    }
    const t = setTimeout(() => setShowFallback(true), 650);
    return () => clearTimeout(t);
  }, [ready]);

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <DialogProvider>
        <TourProvider>
          {/* #app-root is what the Session-expired dialog makes inert
              (spec-shell 2.15); the dialog itself portals outside it. */}
          <div id={APP_ROOT_ID} style={{ display: "contents" }}>
            {ready ? (
              <>
                <OsShell>{children}</OsShell>
                <ScreenProtection />
              </>
            ) : (
              <div
                aria-hidden
                style={{
                  position: "fixed",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: BOOT_BG,
                }}
              >
                {showFallback && <DotsLoader />}
              </div>
            )}
            {/* Mission + a rotating value ARE the loader — one continuous splash
                from first paint through boot, then it fades to reveal the page.
                Always mounted so it never restarts across the boot→ready swap. */}
            <MissionSplash />
          </div>
          <SessionExpiredDialog />
          <SessionIdleWarning />
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
