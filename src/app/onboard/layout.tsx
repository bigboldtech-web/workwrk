"use client";

// Onboarding shell — self-contained light theme (explicit Tailwind, no
// dependency on the .workwrk-os / os.css tokens, which inherit the app's dark
// default and were rendering the wizard dark + unreadable).

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo";

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-zinc-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  return (
    <div
      className="min-h-screen text-zinc-900 antialiased"
      style={{
        colorScheme: "light",
        background:
          "radial-gradient(1100px 520px at 12% -8%, rgba(124,58,237,0.07), transparent 60%)," +
          "radial-gradient(1000px 520px at 90% 110%, rgba(236,72,153,0.07), transparent 60%)," +
          "#ffffff",
        fontFamily: "Figtree, ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3.5">
          <Link href="/today" aria-label="WorkwrK home" className="flex items-center">
            <LogoLockup size={19} textColor="#181B34" />
          </Link>
          <Link href="/today" className="ml-auto rounded-md px-3 py-1.5 text-[13px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800">
            Skip for now
          </Link>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-57px)] w-full max-w-5xl flex-col px-6 py-10">
        {children}
      </main>
    </div>
  );
}
