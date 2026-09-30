"use client";

// /onboard's client frame (layout.tsx is the server half that carries the
// metadata and the stylesheet): the light-only `.workwrk-auth` token scope shared with
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
import { LayerStackProvider } from "@/components/layout/os/shell-context";

export function OnboardFrame({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=%2Fonboard");
  }, [status, router]);

  return (
    <div className="workwrk-auth">
      {status === "authenticated" ? (
        // The one Esc rule outside the product frame (the Staff console
        // mounts the same provider): an open Picker or dialog closes first.
        <LayerStackProvider>{children}</LayerStackProvider>
      ) : (
        <div className="wz-boot" role="status" aria-label="Opening WorkwrK">
          {status === "loading" ? <Logo width={28} pulsing title="Opening WorkwrK" /> : null}
        </div>
      )}
    </div>
  );
}
