"use client";

// A signed-out visit to a Staff console deep link (a company link pasted
// from a support ticket) signs in and comes back to THAT page, not Overview
// (spec-admin-backoffice section 1: /login?callbackUrl=<current>). A layout
// cannot read the request path, so this reads it in the browser. Only a
// console path is ever sent back: anything else falls back to /admin.

import { useEffect } from "react";

export function consoleCallbackUrl(pathname: string, search: string): string {
  const own = pathname === "/admin" || pathname.startsWith("/admin/");
  // A protocol-relative or backslash path is never a callback.
  if (!own || pathname.startsWith("//") || pathname.includes("\\")) return "/admin";
  return pathname + search;
}

export function SignedOutRedirect() {
  useEffect(() => {
    const cb = consoleCallbackUrl(window.location.pathname, window.location.search);
    window.location.replace(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-app text-base text-ink-2" role="status">
      Taking you to sign in.
    </div>
  );
}
