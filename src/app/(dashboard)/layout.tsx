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
import "./os.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [setupChecked, setSetupChecked] = useState(false);

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

  if (status === "loading" || (status === "authenticated" && !setupChecked)) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: 10,
          background: "#FBFAF7",
          color: "#52525B",
          fontFamily: "var(--font-geist), sans-serif",
          fontSize: 13,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#C8451F",
            animation: "osPulse 1.2s ease-in-out infinite",
          }}
        />
        <span>Loading workspace…</span>
        <style>{`@keyframes osPulse { 0%,100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }`}</style>
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return (
    <ToastProvider>
      <DialogProvider>
        <TourProvider>
          <OsShell>{children}</OsShell>
          <ScreenProtection />
        </TourProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
