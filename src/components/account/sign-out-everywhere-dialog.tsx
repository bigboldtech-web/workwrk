"use client";

// Log out everywhere confirm (spec-account-auth): 400px, the copy says this
// device is included, one destructive primary. POST /api/me/sign-out-everywhere
// bumps tokenVersion (every session, this one too), then signOut clears this
// browser and lands on /login?loggedout=1. This browser ends at once; every
// other device ends at its next re-check (REVALIDATE_MS in src/lib/auth.ts,
// 5 minutes), so the copy promises "within 5 minutes", not "now".
//
// AI apps (docs/plans/mcp-server.md 11.2): the route revokes every app the
// person connected at once, and the confirm says so, "and disconnects your
// AI apps" (MCP_LOGOUT_COPY), only when the page knows this WorkwrK offers
// them (disconnectsApps), so no one is told of a feature that is hidden.

import { useState } from "react";
import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";
import { MCP_LOGOUT_COPY } from "@/lib/mcp/mcp-copy";
import { clearAllPerformanceDrafts } from "@/lib/people/draft-keys";
import { AccountDialog, btn, DialogBanner, Pending } from "./account-ui";

export function SignOutEverywhereDialog({ open, onOpenChange, disconnectsApps = false }: { open: boolean; onOpenChange: (v: boolean) => void; disconnectsApps?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch("/api/me/sign-out-everywhere", { method: "POST" });
    if (!r.ok && r.status !== 401) {
      setBusy(false);
      setErr(r.error || "Couldn't log out everywhere. Try again.");
      return;
    }
    clearAllPerformanceDrafts();
    await signOut({ callbackUrl: "/login?loggedout=1" });
  };

  return (
    <AccountDialog
      open={open}
      onOpenChange={(v) => { if (!busy) { setErr(null); onOpenChange(v); } }}
      title="Log out everywhere"
      width={400}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
          <button type="button" className={btn.danger} onClick={() => { void go(); }} disabled={busy} autoFocus>
            {busy ? <Pending label="Logging out" /> : null}
            Log out everywhere
          </button>
        </>
      }
    >
      <p className="text-base text-ink">
        This logs you out on every device, including this one{disconnectsApps ? `, ${MCP_LOGOUT_COPY.alsoDisconnects}` : ""}. Other devices are logged out within five minutes. You will need to log in again.
      </p>
      <DialogBanner>{err}</DialogBanner>
    </AccountDialog>
  );
}
