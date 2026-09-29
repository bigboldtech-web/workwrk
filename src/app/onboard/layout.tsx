"use client";

// /onboard's frame: the light-only `.workwrk-auth` token scope shared with
// the sign-in pages (src/app/(auth)/auth-shell.css), and the one redirect
// the access model allows: not signed in goes to /login?callbackUrl=/onboard.
// While the session resolves, the boot navy screen with the four-dot logo,
// the same one the app shows, so wizard to app is one colour (B19). The
// wizard draws its own header (page.tsx); there is no way "out" through a
// logo link, which was half of the old skip loop.

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import "../(auth)/auth-shell.css";

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=%2Fonboard");
  }, [status, router]);

  return (
    <div className="workwrk-auth">
      {status === "authenticated" ? (
        children
      ) : (
        <div className="wz-boot" role="status" aria-label="Opening WorkwrK">
          {status === "loading" ? <Logo width={28} pulsing title="Opening WorkwrK" /> : null}
        </div>
      )}
    </div>
  );
}
