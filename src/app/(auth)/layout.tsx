// The (auth) segment's root: the light-only `.workwrk-auth` token scope, the
// noindex robots rule and the cookie consent banner. Each page renders its
// own AuthShell (src/components/auth/auth-shell.tsx) so it can choose its
// right-hand panel: the proof panel on /login, /signup, /forgot-password,
// /reset-password and /verify-email, the invitation panel on /join.

import type { Metadata } from "next";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { ConsentProvider } from "@/components/layout/consent-provider";
import "./auth-shell.css";

// Sign-in pages are never search results (spec-account-auth B28): they hold
// no content of their own, and an indexed /reset-password or /join invites
// phishing look-alikes. robots.ts also disallows the private app paths.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="workwrk-auth">
      {children}
      {/* Cookie consent lives on the marketing and auth hosts only
          (spec-shell 1.13); the app never mounts the banner. */}
      <ConsentProvider>
        <ConsentBanner />
      </ConsentProvider>
    </div>
  );
}
