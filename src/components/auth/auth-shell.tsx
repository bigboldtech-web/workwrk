// AuthShell (spec-account-auth section 3): the frame of every sign-in page.
// A white left column (24px page padding, a 400px form column, the logo
// lockup at the top, the footer at the bottom) and, above 1024px, the navy
// right column: the proof panel, the /join invitation panel, or nothing.
//
// Every destination the old layout carried stays: the logo goes to the
// marketing home (MARKETING_HOST when set, else "/"), and the footer keeps
// "(c) year WorkwrK" plus Terms, Privacy and Help, absolute on the marketing
// host when it is set so they resolve from the app host.
//
// Server component (reads MARKETING_HOST); pages hand it client children
// and, for /join, a client panel.

import type { ReactNode } from "react";
import { LogoLockup } from "@/components/brand/logo";
import { AuthProofPanel } from "./proof-panel";

export function marketingHref(path: string): string {
  const host = process.env.MARKETING_HOST?.trim();
  if (!host) return path;
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? "http" : "https";
  return `${proto}://${host}${path}`;
}

export function AuthShell({
  panel = "proof",
  children,
  hideFooterLinks = false,
}: {
  /** "proof" (the default), "none", or a node (the /join invitation panel). */
  panel?: "proof" | "none" | ReactNode;
  children: ReactNode;
  /** The staff console sign-in keeps the copyright line only. */
  hideFooterLinks?: boolean;
}) {
  const right = panel === "none" ? null : panel === "proof" ? <AuthProofPanel variant="proof" /> : panel;
  return (
    <div className={`wa-shell${right ? " has-panel" : ""}`}>
      <main className="wa-main">
        <div className="wa-top">
          <a href={marketingHref("/")} className="wa-logo" aria-label="WorkwrK home">
            <LogoLockup size={20} textColor="var(--os-ink)" />
          </a>
        </div>
        <div className="wa-center">
          <div className="wa-col">{children}</div>
        </div>
        <footer className="wa-foot">
          <span>&copy; {new Date().getFullYear()} WorkwrK</span>
          {hideFooterLinks ? null : (
            <nav aria-label="Legal">
              <a href={marketingHref("/terms")}>Terms</a>
              <a href={marketingHref("/privacy")}>Privacy</a>
              <a href={marketingHref("/help-center")}>Help</a>
            </nav>
          )}
        </footer>
      </main>
      {right}
    </div>
  );
}
