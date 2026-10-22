"use client";

// /onboard's client frame (layout.tsx is the server half that carries the
// metadata and the stylesheet): the light-only `.workwrk-auth` token scope shared with
// the sign-in pages (src/app/(auth)/auth-shell.css), and the one redirect
// the access model allows: not signed in (confirmed by the session route)
// goes to /login?callbackUrl=/onboard.
// While the session resolves, the boot navy screen with the four-dot logo,
// the same one the app shows, so wizard to app is one colour (B19). The
// wizard draws its own header (page.tsx); there is no way "out" through a
// logo link, which was half of the old skip loop.
// A failed session read (offline as a laptop wakes, a deploy's reload)
// leaves next-auth holding no session with the cookie still good, so the
// wizard stays mounted until the session route says the session is gone,
// as the dashboard frame does (src/app/(dashboard)/layout.tsx): what was
// typed is kept.

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import { useConfirmedSignOut } from "@/hooks/use-confirmed-sign-out";
import { LayerStackProvider } from "@/components/layout/os/shell-context";

export function OnboardFrame({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  // Only once the session route confirms there is no session: a failed
  // session read is not a log out (useConfirmedSignOut).
  const signedOut = useConfirmedSignOut(status);

  useEffect(() => {
    if (signedOut) router.replace("/login?callbackUrl=%2Fonboard");
  }, [signedOut, router]);

  const keep = status === "authenticated" || (status === "unauthenticated" && !signedOut);

  return (
    <div className="workwrk-auth">
      {keep ? (
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
