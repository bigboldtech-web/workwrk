"use client";

// "You are logged in as {email}" at the top of /login and /signup for a
// visitor who already has a session (spec-account-auth section 1 Access).
// No silent redirect: a person switching accounts must still reach the
// form, so the page stays and offers the two ways on.

import { signOut, useSession } from "next-auth/react";
import { AuthBanner } from "./auth-card";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";

export function SignedInStrip({ continueHref = WORK_HOME_HREF, logoutCallback }: { continueHref?: string; logoutCallback?: string }) {
  const { data, status } = useSession();
  const email = data?.user?.email;
  if (status !== "authenticated" || !email) return null;
  return (
    <AuthBanner tone="info" strip>
      <p>
        You are logged in as <strong>{email}</strong>.{" "}
        <a className="wa-link" href={continueHref}>
          Continue to WorkwrK
        </a>{" "}
        or{" "}
        <button type="button" className="wa-link" onClick={() => void signOut({ callbackUrl: logoutCallback ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/login") })}>
          Log out
        </button>
      </p>
    </AuthBanner>
  );
}
