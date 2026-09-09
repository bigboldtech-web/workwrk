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
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/setup")
        .then((res) => res.json())
        .then((data) => {
          if (!data.setupCompleted) {
            router.push("/onboard");
          } else {
            setSetupChecked(true);
          }
        })
        .catch(() => setSetupChecked(true));
    }
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
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
