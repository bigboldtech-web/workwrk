"use client";

// Setup wizard shell — self-contained light theme, mirroring
// src/app/onboard/layout.tsx. Must NOT touch the global .dark class
// (owned by next-themes in components/layout/providers.tsx).

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DotsLoaderScreen } from "@/components/brand/dots-loader";

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

  if (status === "loading") {
    return <DotsLoaderScreen label="Loading workspace" background="#FBFBFC" />;
  }

  if (status === "unauthenticated") return null;

  return (
    <div
      className="min-h-screen bg-[#FBFBFC] text-zinc-900 antialiased"
      style={{ colorScheme: "light" }}
    >
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3.5">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2.5 text-[18px] font-bold tracking-tight text-zinc-900 no-underline"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-[3px] bg-[#0073EA]"
            />
            workwrk
          </Link>
          <span className="border-l border-zinc-200 pl-4 text-[12px] uppercase tracking-wide text-zinc-400">
            Setup your workspace
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
